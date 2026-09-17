import type { AnalyticsEngineDataPoint } from './bindings.js';

/**
 * The one place that knows what each Analytics Engine blob/double/index position means. A datapoint
 * only carries `blobN`/`doubleN`/`index1` at read time — everything downstream (the writer and every
 * SQL query builder) reads positions from here so a future added field can't silently collide with an
 * existing one.
 */
export const ANALYTICS_SCHEMA = {
  index: { siteId: 1 },
  blob: { eventType: 1, pathname: 2, referrerHost: 3, country: 4, deviceCategory: 5 },
  double: { count: 1 }
} as const;

export const ANALYTICS_MAX_LENGTHS = {
  pathname: 256,
  referrerHost: 253,
  country: 2,
  /** Kept well under Analytics Engine's index-value budget, with headroom to spare. */
  siteId: 96
} as const;

/** A country Cloudflare reports for a request with no real geography — never worth keeping. */
const UNRESOLVED_COUNTRY_CODES = new Set(['XX', 'T1']);

export interface AnalyticsPageviewInput {
  siteId: string;
  pathname: string;
  /** Hostname only, `''` when there is none or it is same-origin. Never a full URL. */
  referrerHost: string;
  /** 2-letter ISO country code, `''` when unknown. */
  country: string;
}

/** Strips query string and fragment, ensures a leading slash, caps length. Never empty. */
export function sanitizePathname(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0) return '/';
  const withoutHash = raw.split('#')[0] ?? '';
  const withoutQuery = withoutHash.split('?')[0] ?? '';
  const withLeadingSlash = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
  const trimmed = withLeadingSlash.slice(0, ANALYTICS_MAX_LENGTHS.pathname);
  return trimmed.length > 0 ? trimmed : '/';
}

/**
 * Reduces a referrer to its hostname — never the full URL, never the path/query. `''` for a missing,
 * unparseable, or same-origin referrer (a visitor arriving from the site's own pages isn't a useful
 * "referrer" for this purpose).
 */
export function sanitizeReferrerHost(raw: unknown, requestHost?: string): string {
  if (typeof raw !== 'string' || raw.length === 0) return '';
  try {
    const url = new URL(raw);
    if (requestHost !== undefined && url.hostname === requestHost) return '';
    return url.hostname.slice(0, ANALYTICS_MAX_LENGTHS.referrerHost);
  } catch {
    return '';
  }
}

/** Uppercases and validates a 2-letter ISO country code; `''` for anything else (incl. XX/T1). */
export function sanitizeCountry(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const upper = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper) || UNRESOLVED_COUNTRY_CODES.has(upper)) return '';
  return upper;
}

/**
 * Falls back to `'default'` — single-site deployments never need to configure this. Restricted to a
 * safe identifier charset (not just length-capped): this value is interpolated into a SQL string
 * literal by the query builders, and a restricted charset can never contain the quote/backslash
 * characters that would matter there, closing that off at the source rather than relying solely on
 * `escapeLiteral`'s own quote-escaping.
 */
export function sanitizeSiteId(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0) return 'default';
  const safe = raw.slice(0, ANALYTICS_MAX_LENGTHS.siteId).replace(/[^A-Za-z0-9._-]/g, '');
  return safe.length > 0 ? safe : 'default';
}

/** Builds the exact `writeDataPoint()` argument from {@link ANALYTICS_SCHEMA}'s positions. */
export function toPageviewDataPoint(input: AnalyticsPageviewInput): AnalyticsEngineDataPoint {
  const blobs: string[] = [];
  blobs[ANALYTICS_SCHEMA.blob.eventType - 1] = 'pageview';
  blobs[ANALYTICS_SCHEMA.blob.pathname - 1] = input.pathname;
  blobs[ANALYTICS_SCHEMA.blob.referrerHost - 1] = input.referrerHost;
  blobs[ANALYTICS_SCHEMA.blob.country - 1] = input.country;
  blobs[ANALYTICS_SCHEMA.blob.deviceCategory - 1] = '';

  const doubles: number[] = [];
  doubles[ANALYTICS_SCHEMA.double.count - 1] = 1;

  return { indexes: [input.siteId], blobs, doubles };
}
