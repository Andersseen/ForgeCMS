import { D1DatabaseAdapter } from '@forge-cms/cloudflare';
import { DatabaseAuthThrottle, type AuthAttemptThrottle } from '@forge-cms/runtime';
import type { ServerEnv } from './runtime';

let limiter: Promise<DatabaseAuthThrottle> | undefined;

/**
 * Spec 106: login/signup attempt limits on the deployed demo (Cloudflare Pages + D1). Pages Functions have
 * no Rate Limiting binding, so the portable `DatabaseAuthThrottle` keeps its counters in the demo's own D1,
 * keyed by Cloudflare's `cf-connecting-ip` (10 logins per client, 30 per account, 10 signups per client,
 * per minute). Local development and the e2e suites run on the in-memory database from one client
 * address, so they stay unthrottled (`undefined`); D1 behaviour is covered by `@forge-cms/cloudflare`'s
 * workers tests.
 */
export async function authThrottleFor(env?: ServerEnv): Promise<AuthAttemptThrottle | undefined> {
  if (!env?.DB) return undefined;
  limiter ??= (async () => {
    const throttle = new DatabaseAuthThrottle({
      database: new D1DatabaseAdapter().init(env),
      clientKey: (request) => request.headers.get('cf-connecting-ip') ?? 'unknown'
    });
    await throttle.syncSchema();
    return throttle;
  })();
  try {
    return (await limiter).throttle;
  } catch (error) {
    limiter = undefined; // a failed schema sync is retried by the next request, never cached
    throw error;
  }
}
