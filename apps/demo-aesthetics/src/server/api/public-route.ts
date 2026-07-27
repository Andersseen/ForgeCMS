import { defineEventHandler, setResponseHeader } from 'h3';
import type { H3Event } from 'h3';
import type { ForgeCmsRuntime } from '@forge-cms/runtime';
import { getServerRuntime, type ServerEnv } from './runtime';
import { PUBLIC_CACHE_SECONDS, cachedRead } from './demo-limits';

/**
 * Defines a public site endpoint: resolve the runtime, serve the payload from a short-lived cache,
 * and tell the browser and the edge they may reuse it.
 *
 * The public site is identical for every visitor, so recomputing it per request is pure waste — and
 * on a free-tier demo it is the difference between a few hundred D1 reads a day and a few hundred
 * thousand. A minute of staleness is invisible on a clinic's website; publishing still feels
 * immediate because the admin never reads through this path.
 */
export function definePublicSiteRoute<T>(
  load: (runtime: ForgeCmsRuntime<ServerEnv>, event: H3Event) => Promise<T>
) {
  return defineEventHandler(async (event) => {
    const runtime = await getServerRuntime(event.context.cloudflare?.env);

    setResponseHeader(
      event,
      'cache-control',
      `public, max-age=${PUBLIC_CACHE_SECONDS}, s-maxage=${PUBLIC_CACHE_SECONDS}`
    );

    // Keyed by path, so `/api/site/services/laser` and `/api/site/services/peel` are separate
    // entries. A loader that throws (a 404, say) stores nothing.
    const data = await cachedRead(event.path ?? 'site', () => load(runtime, event));

    return { data };
  });
}
