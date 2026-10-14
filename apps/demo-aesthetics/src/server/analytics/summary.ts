import {
  ANALYTICS_DATE_RANGES,
  AnalyticsEngineQueryClient,
  sanitizeSiteId,
  type AnalyticsDateRange,
  type AnalyticsSummaryResult
} from '@forge-cms/cloudflare';

/** Must match the `dataset` declared for the `ANALYTICS` binding in wrangler.toml. */
export const ANALYTICS_DATASET = 'forge_analytics_demo';

export interface AnalyticsSummaryEnv {
  FORGE_ANALYTICS_SITE_ID?: string;
  /** Server-only secrets for the Analytics Engine SQL API (query side only; writes need none). */
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_ANALYTICS_TOKEN?: string;
}

export type AnalyticsSummaryResponse =
  | { status: 400; message: string }
  | { status: 200; data: { configured: false } }
  | { status: 200; data: { configured: true } & Omit<AnalyticsSummaryResult, never> };

const EMPTY_SUMMARY: Omit<AnalyticsSummaryResult, 'range'> = {
  totals: { pageviews: 0, previousPageviews: 0, changePct: null },
  timeline: [],
  topPages: [],
  referrers: [],
  countries: []
};

interface QueryClientLike {
  getSummary(siteId: string, range: AnalyticsDateRange): Promise<AnalyticsSummaryResult>;
}

export interface GetAnalyticsSummaryInput {
  /** The raw `range` query value. */
  range: unknown;
  env: AnalyticsSummaryEnv | undefined;
  /** Test seam; defaults to the real Analytics Engine SQL API client. */
  createClient?: (options: {
    accountId: string;
    apiToken: string;
    dataset: string;
  }) => QueryClientLike;
}

function isValidRange(value: unknown): value is AnalyticsDateRange {
  return typeof value === 'string' && (ANALYTICS_DATE_RANGES as string[]).includes(value);
}

/**
 * The admin summary. The CALLER must have verified the user is an admin before calling this; the SQL API
 * must never be reachable for an unauthenticated request.
 */
export async function getAnalyticsSummary(
  input: GetAnalyticsSummaryInput
): Promise<AnalyticsSummaryResponse> {
  if (!isValidRange(input.range)) return { status: 400, message: 'Invalid or missing range' };

  const accountId = input.env?.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = input.env?.CLOUDFLARE_ANALYTICS_TOKEN;
  if (!accountId || !apiToken) return { status: 200, data: { configured: false } };

  const create = input.createClient ?? ((options) => new AnalyticsEngineQueryClient(options));
  const client = create({ accountId, apiToken, dataset: ANALYTICS_DATASET });
  try {
    const summary = await client.getSummary(
      sanitizeSiteId(input.env?.FORGE_ANALYTICS_SITE_ID),
      input.range
    );
    return { status: 200, data: { configured: true, ...summary } };
  } catch {
    // Valid credentials but the query failed - most likely the dataset has never been written to yet
    // (Analytics Engine creates it on the first write). That is "no traffic yet", not a server error.
    return { status: 200, data: { configured: true, ...EMPTY_SUMMARY, range: input.range } };
  }
}
