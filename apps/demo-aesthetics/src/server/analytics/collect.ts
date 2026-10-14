import {
  AnalyticsEngineWriter,
  NoopAnalyticsWriter,
  sanitizeCountry,
  sanitizePathname,
  sanitizeReferrerHost,
  sanitizeSiteId,
  type AnalyticsEngineDataset
} from '@forge-cms/cloudflare';

/** The bindings and variables the collector reads. `ANALYTICS` is optional on purpose: no binding, no-op. */
export interface AnalyticsCollectEnv {
  ANALYTICS?: AnalyticsEngineDataset;
  FORGE_ANALYTICS_SITE_ID?: string;
}

export interface CollectPageviewInput {
  /** The parsed JSON body, whatever it is. Only `pathname` and `referrer` are ever read from it. */
  body: unknown;
  env: AnalyticsCollectEnv | undefined;
  /** Host of the request itself, so same-site referrers are dropped. */
  requestHost: string;
  /** The `CF-IPCountry` request header. */
  countryHeader: string | undefined;
}

/**
 * Records one pageview. Everything but `pathname`/`referrer` is derived on the server: the country from
 * Cloudflare's header, the site id from configuration. No IP, email, user id, cookie, visitor id,
 * query string or hash is read or stored.
 */
export function collectPageview(input: CollectPageviewInput): void {
  const body = (typeof input.body === 'object' && input.body !== null ? input.body : {}) as {
    pathname?: unknown;
    referrer?: unknown;
  };
  const env = input.env;
  const writer = env?.ANALYTICS
    ? new AnalyticsEngineWriter().init({ ANALYTICS: env.ANALYTICS })
    : new NoopAnalyticsWriter();

  writer.recordPageview({
    siteId: sanitizeSiteId(env?.FORGE_ANALYTICS_SITE_ID),
    pathname: sanitizePathname(body.pathname),
    referrerHost: sanitizeReferrerHost(body.referrer, input.requestHost),
    country: sanitizeCountry(input.countryHeader)
  });
}
