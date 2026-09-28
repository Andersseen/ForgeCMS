import { test } from '@playwright/test';

/**
 * Gives one spec file its own write-throttle bucket.
 *
 * The demo's spending guard allows 12 writes a minute per IP (`src/server/api/demo-limits.ts`), and a
 * logged-in e2e test spends several (login, logout, a create, a publish). Locally every request comes
 * from the same address, so a full run tripped the guard and failed with "Login failed". The guard
 * reads `cf-connecting-ip` first, which only Cloudflare sets, so this header changes nothing when
 * deployed; the throttle itself is covered by `src/tests/demo-limits.test.ts`.
 */
export function useOwnThrottleBucket(name: string): void {
  test.use({ extraHTTPHeaders: { 'x-forwarded-for': `e2e-${name}` } });
}
