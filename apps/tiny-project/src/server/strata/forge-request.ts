import type { StrataAnalogContext, StrataAnalogRequest } from '@strata-sc/analog';
import type { ServerEnv } from '../api/runtime';

/**
 * The Cloudflare bindings Nitro's `cloudflare-pages` preset puts on the event context
 * (`event.context.cloudflare.env`), read back from Strata's context snapshot. `undefined` off
 * Cloudflare (local dev, Node) — exactly what the H3 routes pass to `getServerRuntime` there.
 * Bindings are declared by `wrangler.toml`, not validated at runtime, so narrowing to `ServerEnv`
 * is the same trust the H3 routes place in `event.context.cloudflare?.env`.
 */
export function readCloudflareEnv(context: StrataAnalogContext): ServerEnv | undefined {
  const cloudflare = context['cloudflare'];
  if (typeof cloudflare !== 'object' || cloudflare === null || !('env' in cloudflare)) {
    return undefined;
  }
  const env: unknown = cloudflare.env;
  return typeof env === 'object' && env !== null ? (env as ServerEnv) : undefined;
}

/**
 * `@strata-sc/analog@0.1.0`'s `StrataAnalogRequest` exposes no Web Standard `Request`, only its
 * parts, so this rebuilds one for Forge's handlers. Bodyless and without an `AbortSignal`, which is
 * sufficient **only for bodyless reads** such as `handleList`: it reads the method (CSRF is a no-op
 * for GET), the `authorization`/`cookie`/`accept-language` headers and the query string, never the
 * body, the signal, or the URL's origin. Strata's `url` falls back to an `http://localhost` origin
 * when Nitro has no web request, so this must not back a mutating route, whose CSRF check compares
 * `Origin` against `request.url`'s origin.
 */
export function toForgeRequest(request: StrataAnalogRequest): Request {
  return new Request(request.url, { method: request.method, headers: request.headers });
}
