import { ANALYTICS_SCHEMA } from './analytics-schema.js';

export type AnalyticsDateRange = '24h' | '7d' | '30d' | '90d';

export const ANALYTICS_DATE_RANGES: readonly AnalyticsDateRange[] = ['24h', '7d', '30d', '90d'];

export interface AnalyticsQueryClientOptions {
  accountId: string;
  apiToken: string;
  dataset: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface AnalyticsSummaryResult {
  range: AnalyticsDateRange;
  totals: { pageviews: number; previousPageviews: number; changePct: number | null };
  timeline: { bucket: string; pageviews: number }[];
  topPages: { path: string; pageviews: number }[];
  referrers: { host: string; pageviews: number }[];
  countries: { country: string; pageviews: number }[];
}

interface RangeConfig {
  amount: number;
  unit: 'HOUR' | 'DAY';
  bucket: 'hour' | 'day';
}

const RANGE_CONFIG: Record<AnalyticsDateRange, RangeConfig> = {
  '24h': { amount: 24, unit: 'HOUR', bucket: 'hour' },
  '7d': { amount: 7, unit: 'DAY', bucket: 'day' },
  '30d': { amount: 30, unit: 'DAY', bucket: 'day' },
  '90d': { amount: 90, unit: 'DAY', bucket: 'day' }
};

function escapeLiteral(value: string): string {
  // Analytics Engine's SQL dialect is ClickHouse-family, which also honors backslash escapes inside
  // single-quoted strings — escape both, not just the quote.
  return value.replace(/\\/g, '\\\\').replace(/'/g, "''");
}

function baseWhere(dataset: string, siteId: string): string {
  return `FROM ${dataset} WHERE index1 = '${escapeLiteral(siteId)}' AND blob${ANALYTICS_SCHEMA.blob.eventType} = 'pageview'`;
}

export function buildTimelineQuery(
  dataset: string,
  siteId: string,
  range: AnalyticsDateRange
): string {
  const { amount, unit, bucket } = RANGE_CONFIG[range];
  return (
    `SELECT DATE_TRUNC('${bucket}', timestamp) AS bucket, SUM(_sample_interval) AS pageviews ` +
    `${baseWhere(dataset, siteId)} AND timestamp >= NOW() - INTERVAL '${amount}' ${unit} ` +
    `GROUP BY bucket ORDER BY bucket ASC`
  );
}

export function buildPreviousTotalQuery(
  dataset: string,
  siteId: string,
  range: AnalyticsDateRange
): string {
  const { amount, unit } = RANGE_CONFIG[range];
  return (
    `SELECT SUM(_sample_interval) AS pageviews ${baseWhere(dataset, siteId)} ` +
    `AND timestamp >= NOW() - INTERVAL '${amount * 2}' ${unit} ` +
    `AND timestamp < NOW() - INTERVAL '${amount}' ${unit}`
  );
}

export function buildTopPagesQuery(
  dataset: string,
  siteId: string,
  range: AnalyticsDateRange
): string {
  const { amount, unit } = RANGE_CONFIG[range];
  return (
    `SELECT blob${ANALYTICS_SCHEMA.blob.pathname} AS path, SUM(_sample_interval) AS pageviews ` +
    `${baseWhere(dataset, siteId)} AND timestamp >= NOW() - INTERVAL '${amount}' ${unit} ` +
    `GROUP BY path ORDER BY pageviews DESC LIMIT 10`
  );
}

export function buildReferrersQuery(
  dataset: string,
  siteId: string,
  range: AnalyticsDateRange
): string {
  const { amount, unit } = RANGE_CONFIG[range];
  return (
    `SELECT blob${ANALYTICS_SCHEMA.blob.referrerHost} AS host, SUM(_sample_interval) AS pageviews ` +
    `${baseWhere(dataset, siteId)} AND timestamp >= NOW() - INTERVAL '${amount}' ${unit} ` +
    `GROUP BY host ORDER BY pageviews DESC LIMIT 10`
  );
}

export function buildCountriesQuery(
  dataset: string,
  siteId: string,
  range: AnalyticsDateRange
): string {
  const { amount, unit } = RANGE_CONFIG[range];
  return (
    `SELECT blob${ANALYTICS_SCHEMA.blob.country} AS country, SUM(_sample_interval) AS pageviews ` +
    `${baseWhere(dataset, siteId)} AND timestamp >= NOW() - INTERVAL '${amount}' ${unit} ` +
    `GROUP BY country ORDER BY pageviews DESC LIMIT 10`
  );
}

/**
 * Reads aggregated pageviews via Cloudflare's Analytics Engine SQL API — an external HTTPS call, not
 * a Worker binding, so this takes credentials directly rather than an `init(env)`-style adapter.
 */
export class AnalyticsEngineQueryClient {
  private readonly accountId: string;
  private readonly apiToken: string;
  private readonly dataset: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AnalyticsQueryClientOptions) {
    this.accountId = options.accountId;
    this.apiToken = options.apiToken;
    this.dataset = options.dataset;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async runQuery<T>(sql: string): Promise<T[]> {
    const response = await this.fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/analytics_engine/sql`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiToken}` },
        body: sql
      }
    );
    if (!response.ok) {
      throw new Error(`Analytics Engine SQL API request failed: ${response.status}`);
    }
    const body = (await response.json()) as { data?: T[] };
    return body.data ?? [];
  }

  async getSummary(siteId: string, range: AnalyticsDateRange): Promise<AnalyticsSummaryResult> {
    const [timelineRows, previousRows, pageRows, referrerRows, countryRows] = await Promise.all([
      this.runQuery<{ bucket: string; pageviews: number | null }>(
        buildTimelineQuery(this.dataset, siteId, range)
      ),
      this.runQuery<{ pageviews: number | null }>(
        buildPreviousTotalQuery(this.dataset, siteId, range)
      ),
      this.runQuery<{ path: string; pageviews: number | null }>(
        buildTopPagesQuery(this.dataset, siteId, range)
      ),
      this.runQuery<{ host: string; pageviews: number | null }>(
        buildReferrersQuery(this.dataset, siteId, range)
      ),
      this.runQuery<{ country: string; pageviews: number | null }>(
        buildCountriesQuery(this.dataset, siteId, range)
      )
    ]);

    const timeline = timelineRows.map((row) => ({
      bucket: row.bucket,
      pageviews: Number(row.pageviews ?? 0)
    }));
    const pageviews = timeline.reduce((sum, row) => sum + row.pageviews, 0);
    const previousPageviews = Number(previousRows[0]?.pageviews ?? 0);
    const changePct =
      previousPageviews > 0
        ? Math.round(((pageviews - previousPageviews) / previousPageviews) * 1000) / 10
        : null;

    return {
      range,
      totals: { pageviews, previousPageviews, changePct },
      timeline,
      topPages: pageRows.map((row) => ({ path: row.path, pageviews: Number(row.pageviews ?? 0) })),
      referrers: referrerRows.map((row) => ({
        host: row.host || 'Direct',
        pageviews: Number(row.pageviews ?? 0)
      })),
      countries: countryRows.map((row) => ({
        country: row.country || 'Unknown',
        pageviews: Number(row.pageviews ?? 0)
      }))
    };
  }
}
