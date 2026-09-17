import { createError, defineEventHandler, getRequestHeader, getRequestURL, readBody } from 'h3';
import {
  AnalyticsEngineWriter,
  NoopAnalyticsWriter,
  sanitizeCountry,
  sanitizePathname,
  sanitizeReferrerHost,
  sanitizeSiteId
} from '@forge-cms/cloudflare';
import type { ServerEnv } from '../../../api/runtime';

/**
 * Forge Analytics (spec 057, experimental) — the public pageview collector. Public and anonymous by
 * design, so this is a bespoke route rather than generic CRUD (same reasoning as
 * `site/bookings.post.ts`): pageviews aren't a CMS collection and must never require auth.
 *
 * Only `pathname`/`referrer` are accepted from the body — everything else (country, site id) is
 * derived server-side, and no IP, email, or ForgeCMS user id is ever read or stored.
 */
export default defineEventHandler(async (event) => {
  const env = event.context.cloudflare?.env as ServerEnv | undefined;

  let parsed: unknown;
  try {
    parsed = await readBody(event);
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON body' });
  }
  // `readBody` returns `undefined` for an empty body and `null` for a literal JSON `null` — neither
  // is a parse error h3 throws on, so both must be handled here rather than assumed away by the type.
  const body = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as {
    pathname?: unknown;
    referrer?: unknown;
  };

  const requestHost = getRequestURL(event).hostname;
  const writer = env?.ANALYTICS ? new AnalyticsEngineWriter().init(env) : new NoopAnalyticsWriter();

  writer.recordPageview({
    siteId: sanitizeSiteId(env?.FORGE_ANALYTICS_SITE_ID),
    pathname: sanitizePathname(body.pathname),
    referrerHost: sanitizeReferrerHost(body.referrer, requestHost),
    country: sanitizeCountry(getRequestHeader(event, 'cf-ipcountry'))
  });

  return new Response(null, { status: 204 });
});
