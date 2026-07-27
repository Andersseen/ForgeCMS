/**
 * What keeps a **public demo with published admin credentials** from becoming someone's free
 * database — or from burning the Cloudflare free tier, which is what actually pays for it.
 *
 * The numbers to respect (Workers/D1/R2 free plan, per account):
 *   - 100,000 Worker requests per day
 *   - 100,000 D1 rows written and 5,000,000 read per day
 *   - 10 GB in R2 and 1,000,000 class A (write) operations per month
 *
 * The strategy, in order of how much it saves:
 *   1. **Cache reads.** The public site is the same for everybody, so it is served from memory for a
 *      minute at a time and most visits never reach D1 at all.
 *   2. **Cap what can exist.** Collections have a ceiling; going over prunes the oldest rows rather
 *      than refusing, so the demo keeps working while staying bounded.
 *   3. **Throttle writes per IP.** Not per person — that needs accounts — but enough that a loop
 *      from one machine stops being interesting.
 *   4. **Keep the demo intact.** The seeded content cannot be deleted below a floor, and user
 *      accounts cannot be created or removed at all.
 *
 * Everything here is deliberately in-memory and per-isolate: no KV, no extra D1 writes, nothing that
 * costs quota to enforce quota. That makes the throttle *leaky* — a distributed attacker gets one
 * bucket per Cloudflare location — which is why the caps in the content model are the real backstop.
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
  site_settings: 1
};

/** Uploads: R2 storage is the one limit measured in gigabytes rather than operations. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/** Anything larger than this is not a content payload, it is someone probing. */
export const MAX_BODY_BYTES = 256 * 1024;

// --- Throttling ----------------------------------------------------------------------------------

/** Writes allowed from one IP per window. */
const WRITES_PER_IP = 12;
const WINDOW_MS = 60_000;

/** Last-resort circuit breaker: total writes this isolate will accept per window. */
const WRITES_PER_ISOLATE = 240;

/** Bounded so the map itself cannot be used to exhaust memory. */
const MAX_TRACKED_IPS = 5_000;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let globalBucket: Bucket = { count: 0, resetAt: 0 };

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

/** Records a write attempt from `ip` and says whether it may proceed. */
export function throttleWrite(ip: string, now = Date.now()): ThrottleResult {
  const global = hit(globalBucket, WRITES_PER_ISOLATE, now);
  if (!global.allowed) return global;

  if (buckets.size >= MAX_TRACKED_IPS) {
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(key);
    }
    // Still full: every bucket is live, which is itself the attack. Shed the oldest.
    if (buckets.size >= MAX_TRACKED_IPS) {
      const oldest = buckets.keys().next().value;
      if (oldest !== undefined) buckets.delete(oldest);
    }
  }

  const bucket = buckets.get(ip) ?? { count: 0, resetAt: 0 };
  buckets.set(ip, bucket);
  return hit(bucket, WRITES_PER_IP, now);
}

/** Test seam. */
export function resetThrottle(): void {
  buckets.clear();
  globalBucket = { count: 0, resetAt: 0 };
}

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
