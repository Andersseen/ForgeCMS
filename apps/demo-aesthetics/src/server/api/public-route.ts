import { defineEventHandler, setResponseHeader } from 'h3';
import type { H3Event } from 'h3';
import { getServerRuntime, type DemoRuntime } from './runtime';
import { PUBLIC_CACHE_SECONDS, cachedRead } from './demo-limits';

/**
 * Defines a public site endpoint: resolve the runtime, serve the payload from a short-lived cache,
 * and tell shared caches they may reuse it.
 *
 * The public site is identical for every visitor, so recomputing it per request is pure waste — and
 * on a free-tier demo it is the difference between a few hundred D1 reads a day and a few hundred
 * thousand. A write clears the cache of the isolate that handled it, so an editor who publishes and
 * reloads normally sees the change at once. Another isolate, or a shared cache honouring `s-maxage`,
 * can still serve the old payload for up to a minute. The browser is told not to keep its own copy
 * (`max-age=0`): it used to keep one for a minute, which made an editor's own reload show the page as
 * it was before Publish.
 */
export function definePublicSiteRoute<T>(
  load: (runtime: DemoRuntime, event: H3Event) => Promise<T>
) {
  return defineEventHandler(async (event) => {
    const runtime = await getServerRuntime(event.context.cloudflare?.env);

    setResponseHeader(
      event,
      'cache-control',
      `public, max-age=0, s-maxage=${PUBLIC_CACHE_SECONDS}`
    );

    // Keyed by path, so `/api/site/services/laser` and `/api/site/services/peel` are separate
    // entries. A loader that throws (a 404, say) stores nothing.
    const data = await cachedRead(event.path ?? 'site', () => load(runtime, event));

    return { data };
  });
}
