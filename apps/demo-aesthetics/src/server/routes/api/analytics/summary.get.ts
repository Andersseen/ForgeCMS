import { createError, defineEventHandler, getQuery } from 'h3';
import { requireAdminAuth } from '../../../api/auth-request';
import type { ServerEnv } from '../../../api/runtime';
import { getAnalyticsSummary } from '../../../analytics/summary';

/**
 * Forge Analytics (spec 057, experimental) - admin-only query endpoint. Reuses the same
 * `requireAdminAuth()` every other admin-only route calls; the SQL API is never reached for an
 * unauthorized caller. The logic lives in `analytics/summary.ts` (tested, and embedded in the guide).
 */
export default defineEventHandler(async (event) => {
  await requireAdminAuth(event);

  const env = event.context.cloudflare?.env as ServerEnv | undefined;
  const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env['CLOUDFLARE_ACCOUNT_ID'];
  const apiToken = env?.CLOUDFLARE_ANALYTICS_TOKEN ?? process.env['CLOUDFLARE_ANALYTICS_TOKEN'];
  const result = await getAnalyticsSummary({
    range: getQuery(event)['range'],
    env: {
      ...(env?.FORGE_ANALYTICS_SITE_ID !== undefined && {
        FORGE_ANALYTICS_SITE_ID: env.FORGE_ANALYTICS_SITE_ID
      }),
      ...(accountId !== undefined && { CLOUDFLARE_ACCOUNT_ID: accountId }),
      ...(apiToken !== undefined && { CLOUDFLARE_ANALYTICS_TOKEN: apiToken })
    }
  });
  if (result.status === 400) throw createError({ statusCode: 400, statusMessage: result.message });
  return { data: result.data };
});
