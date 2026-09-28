import type { StrataAnalogContext, StrataAnalogRequest } from '@strata-sc/analog';
import type { ApiContext } from '@forge-cms/api';
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

const BODYLESS_READ_METHODS = new Set(['GET', 'HEAD']);

/**
 * **READ-ONLY / BODYLESS.** Builds the Forge `ApiContext` for a Strata read controller.
 *
 * `@strata-sc/analog@0.1.0`'s `StrataAnalogRequest` exposes no Web Standard `Request`, only its parts,
 * so this rebuilds one from `url`/`method`/`headers`: no body, no `AbortSignal`, and an origin that is
 * synthetic (`http://localhost`) whenever Nitro has no web request. That is enough for `handleList` and
 * `handleRead`, which read only the method, the `authorization`/`cookie`/`accept-language` headers, the
 * query string and the route params. It is **not** enough for a mutation: writes need the body, and
 * CSRF compares `Origin` with the request URL's origin. So any other method throws here rather than
 * quietly producing a context that looks usable. Mutating routes stay on H3 until Strata exposes the
 * canonical request.
 */
export function createForgeReadContext(
  request: StrataAnalogRequest,
  params: Record<string, string>
): ApiContext<ServerEnv | undefined> {
  const method = request.method.toUpperCase();
  if (!BODYLESS_READ_METHODS.has(method)) {
    throw new Error(`createForgeReadContext is read-only; refusing ${method} ${request.path}`);
  }
  return {
    request: new Request(request.url, { method, headers: request.headers }),
    params,
    env: readCloudflareEnv(request.context)
  };
}
