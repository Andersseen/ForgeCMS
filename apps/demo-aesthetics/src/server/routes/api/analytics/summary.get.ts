import { createError, defineEventHandler, getQuery } from 'h3';
import {
  ANALYTICS_DATE_RANGES,
  AnalyticsEngineQueryClient,
  sanitizeSiteId,
  type AnalyticsDateRange,
  type AnalyticsSummaryResult
} from '@forge-cms/cloudflare';
import { requireAdminAuth } from '../../../api/auth-request';
import type { ServerEnv } from '../../../api/runtime';

/** Must match the `dataset` name declared for the `ANALYTICS` binding in wrangler.toml. */
const ANALYTICS_DATASET = 'forge_analytics_demo';

const EMPTY_SUMMARY: Omit<AnalyticsSummaryResult, 'range'> = {
  totals: { pageviews: 0, previousPageviews: 0, changePct: null },
  timeline: [],
  topPages: [],
  referrers: [],
  countries: []
};

function isValidRange(value: unknown): value is AnalyticsDateRange {
  return typeof value === 'string' && (ANALYTICS_DATE_RANGES as string[]).includes(value);
}

/**
 * Forge Analytics (spec 057, experimental) — admin-only query endpoint. Reuses the same
 * `requireAdminAuth()` every other admin-only demo route calls; the SQL API is never reached for an
 * unauthorized caller.
 */
export default defineEventHandler(async (event) => {
  await requireAdminAuth(event);

  const range = getQuery(event)['range'];
  if (!isValidRange(range)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid or missing range' });
  }

  const env = event.context.cloudflare?.env as ServerEnv | undefined;
  const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env['CLOUDFLARE_ACCOUNT_ID'];
  const apiToken = env?.CLOUDFLARE_ANALYTICS_TOKEN ?? process.env['CLOUDFLARE_ANALYTICS_TOKEN'];

  if (!accountId || !apiToken) {
    return { data: { configured: false } };
  }

  const siteId = sanitizeSiteId(env?.FORGE_ANALYTICS_SITE_ID);
  const client = new AnalyticsEngineQueryClient({
    accountId,
    apiToken,
    dataset: ANALYTICS_DATASET
  });

  try {
    const summary = await client.getSummary(siteId, range);
    return { data: { configured: true, ...summary } };
  } catch {
    // Credentials are valid but the SQL API call itself failed — most likely the dataset has never
    // received a write yet (Analytics Engine only creates it on first `writeDataPoint()`), which is a
    // normal "no traffic yet" state, not a server error worth a 500/retry-button experience.
    return { data: { configured: true, ...EMPTY_SUMMARY, range } };
  }
});
