/**
 * What keeps a **public demo with published admin credentials** from becoming someone's free
 * database or object store — and from spending the account's free allowances, which is what
 * actually pays for it.
 *
 * This file holds every number; `demo-policy.ts` turns them into decisions. Nothing here encodes a
 * provider price or allowance: the budgets below were chosen by measuring how many D1 operations one
 * allowed action really costs (see `demo-policy.test.ts`) and staying orders of magnitude under the
 * provider's published free allowances, which can change.
 *
 * The strategy, in order of how much it saves:
 *   1. **Cache reads.** The public site is the same for everybody, so it is served from memory for a
 *      minute at a time and most visits never reach D1 at all.
 *   2. **A mutation allowlist** (shared public demo only, `FORGE_PUBLIC_DEMO=1`). Only the localized
 *      notices can be edited, bookings can be submitted, and visitors can sign in. Everything else
 *      that mutates is refused: creates, deletes, uploads and accounts.
 *   3. **A global daily budget** per mutation class, kept in D1 (`demo-policy.ts`). Ceilings bound how
 *      many rows exist, not how often rows are written: create-then-prune forever keeps a collection
 *      constant while consuming writes. The budget bounds the *operations*, across every isolate.
 *   4. **Cap what can exist.** Collections have a ceiling; going over prunes the oldest *disposable*
 *      rows. The seeded rows are never pruned (`SEEDED_DOCUMENTS`).
 *   5. **Throttle per IP.** In memory and per isolate, so deliberately leaky — a distributed client
 *      gets a bucket per Cloudflare location. It is the fast first layer; the D1 budget is the backstop
 *      that holds globally.
 *
 * None of this is a guarantee of zero cost against arbitrary distributed traffic: requests still
 * reach the Functions runtime before application code can refuse them. A zone-level WAF rule on a
 * custom domain would reject earlier (documented as an owner follow-up, not claimed as active).
 */

// --- What may exist ------------------------------------------------------------------------------

/** Ceilings per collection. Beyond these, the oldest rows are pruned on the next write. */
export const MAX_DOCUMENTS: Record<string, number> = {
  bookings: 200,
  media: 40,
  testimonials: 60,
  posts: 40,
  services: 40,
  service_categories: 20,
  staff: 20,
  promotions: 20,
  notices: 20,
  pages: 10
};

/**
 * Floors that protect the seeded demo. A delete that would drop a collection below its floor is
 * refused, so nobody can empty the treatment menu and leave the site looking broken.
 */
export const MIN_DOCUMENTS: Record<string, number> = {
  services: 6,
  service_categories: 4,
  staff: 3,
  pages: 1,
  notices: 1,
  site_settings: 1
};

/**
 * How many documents `seedContent` creates per collection. Seeded rows are always the oldest by
 * `created_at`, so pruning skips the first N of a collection and only ever deletes what visitors (or
 * a maintainer) added afterwards. A test seeds a fresh runtime and fails if these drift from the seed.
 */
export const SEEDED_DOCUMENTS: Record<string, number> = {
  media: 9,
  service_categories: 4,
  services: 8,
  staff: 3,
  testimonials: 4,
  promotions: 2,
  posts: 3,
  bookings: 2,
  pages: 1,
  notices: 2,
  site_settings: 1
};

/** A write that prunes never removes more than this: bounds the amplification of one create. */
export const MAX_PRUNE_PER_WRITE = 5;

/** Uploads: R2 storage is the one limit measured in gigabytes rather than operations. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/** Anything larger than this is not a content payload, it is someone probing. */
export const MAX_BODY_BYTES = 256 * 1024;

// --- Throttling ----------------------------------------------------------------------------------

const WINDOW_MS = 60_000;

/** Bounded so a limiter's key map cannot itself be used to exhaust memory. */
const MAX_TRACKED_IPS = 5_000;

interface Bucket {
  count: number;
  resetAt: number;
}

export interface ThrottleResult {
  allowed: boolean;
  /** Seconds until the caller may try again. Only meaningful when `allowed` is false. */
  retryAfter: number;
}

function hit(bucket: Bucket, limit: number, now: number): ThrottleResult {
  if (now >= bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + WINDOW_MS;
  }
  bucket.count += 1;

  return bucket.count <= limit
    ? { allowed: true, retryAfter: 0 }
    : { allowed: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
}

/**
 * A per-key fixed-window limiter with an isolate-wide circuit breaker, entirely in memory. Each
 * request class gets its own instance, so pageview beacons never spend the content-edit budget.
 */
export interface Limiter {
  hit(key: string, now?: number): ThrottleResult;
  reset(): void;
}

export function createLimiter(perKey: number, perIsolate: number): Limiter {
  const buckets = new Map<string, Bucket>();
  let global: Bucket = { count: 0, resetAt: 0 };

  return {
    hit(key, now = Date.now()) {
      const isolate = hit(global, perIsolate, now);
      if (!isolate.allowed) return isolate;

      if (buckets.size >= MAX_TRACKED_IPS) {
        for (const [tracked, bucket] of buckets) {
          if (now >= bucket.resetAt) buckets.delete(tracked);
        }
        // Still full: every bucket is live, which is itself the attack. Shed the oldest.
        if (buckets.size >= MAX_TRACKED_IPS) {
          const oldest = buckets.keys().next().value;
          if (oldest !== undefined) buckets.delete(oldest);
        }
      }

      const bucket = buckets.get(key) ?? { count: 0, resetAt: 0 };
      buckets.set(key, bucket);
      return hit(bucket, perKey, now);
    },
    reset() {
      buckets.clear();
      global = { count: 0, resetAt: 0 };
    }
  };
}

/** Full (maintainer / e2e) mode: one generic write limiter, as before. */
const writeLimiter = createLimiter(12, 240);

/** Records a write attempt from `ip` and says whether it may proceed. */
export function throttleWrite(ip: string, now = Date.now()): ThrottleResult {
  return writeLimiter.hit(ip, now);
}

/**
 * Shared public demo: one limiter per request class, per IP per minute then per isolate per minute.
 * Deliberately low for the classes that reach D1; a person editing a notice never gets near them.
 */
export const PUBLIC_LIMITERS = {
  CONTENT_UPDATE: createLimiter(6, 60),
  // Above the daily budget on purpose: this only breaks a burst; the budget is what ends the day.
  BOOKING_CREATE: createLimiter(3, 45),
  AUTH_LOGIN: createLimiter(10, 120),
  // Several pageviews per minute are normal SPA navigation; no D1 is involved, so this is generous.
  ANALYTICS_COLLECT: createLimiter(40, 2_000),
  // Scripts, not people: a human browsing the admin stays far below it.
  API_READ: createLimiter(180, 3_000)
} as const;

/** Test seam. */
export function resetThrottle(): void {
  writeLimiter.reset();
  for (const limiter of Object.values(PUBLIC_LIMITERS)) limiter.reset();
}

// --- Public-demo global budgets ------------------------------------------------------------------

/**
 * Persistent actions allowed **per UTC day across every isolate**, by class. These are the numbers
 * that bound D1 writes, so they are chosen from measured amplification (a notice update, with its
 * version snapshot, and a booking, with its prune, each cost a handful of row writes — asserted in
 * `demo-policy.test.ts`), then kept tiny next to any provider allowance. Uploads have no budget
 * because they are refused outright: the hosted example does not need strangers' bytes in object
 * storage to prove that Forge supports upload.
 */
export const PUBLIC_DAILY_BUDGETS = {
  CONTENT_UPDATE: 150,
  BOOKING_CREATE: 30
} as const;

/** Public mode accepts far smaller bodies than full mode: a notice is a few hundred characters. */
export const PUBLIC_MAX_BODY_BYTES = 16 * 1024;

// --- Read caching --------------------------------------------------------------------------------

/** How long a public payload is reused. Short enough that publishing still feels immediate. */
export const PUBLIC_CACHE_SECONDS = 60;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const readCache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 200;

/**
 * Memoises a public read for {@link PUBLIC_CACHE_SECONDS}.
 *
 * Per-isolate rather than the Cache API, because it also protects against the case the Cache API
 * does not: many requests arriving at the same isolate faster than the edge cache can be populated.
 * The `cache-control` header the routes send handles the rest.
 */
export async function cachedRead<T>(
  key: string,
  load: () => Promise<T>,
  now = Date.now()
): Promise<T> {
  const hit = readCache.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;

  const value = await load();

  if (readCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = readCache.keys().next().value;
    if (oldest !== undefined) readCache.delete(oldest);
  }
  readCache.set(key, { value, expiresAt: now + PUBLIC_CACHE_SECONDS * 1000 });

  return value;
}

export function clearReadCache(): void {
  readCache.clear();
}
