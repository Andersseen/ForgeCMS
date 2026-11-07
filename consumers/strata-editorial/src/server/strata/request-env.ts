import type { StrataAnalogRequest } from '@strata-sc/analog';

import { nodeEnv } from '../../app/cms/runtime';
import type { EditorialEnv } from '../../app/cms/runtime';

/**
 * The deployment configuration for one controller request: Cloudflare passes its bindings on the H3
 * event context (`context.cloudflare.env`), Node reads its process environment. Never a global.
 */
export function editorialEnvFor(request: StrataAnalogRequest): EditorialEnv {
  const cloudflare = request.context['cloudflare'] as { env?: EditorialEnv } | undefined;
  return cloudflare?.env ?? nodeEnv();
}

/**
 * The request's real URL for origin checks. Strata's `request.url` is built from the H3 event and, on the
 * Node `node-server` preset, carries a placeholder origin (`http://localhost`) whatever host and port the
 * request reached (finding S-1 in ADOPTION-REPORT.md). An origin comparison against it would refuse every
 * legitimate same-origin mutation. Rebuild it the way H3's `getRequestURL` does for ForgeCMS's native
 * routes: the `Host` header, and `https` when a TLS-terminating proxy says so.
 */
export function originRequest(request: StrataAnalogRequest): Request {
  const host = request.headers.get('host');
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = forwarded === 'https' || request.url.protocol === 'https:' ? 'https' : 'http';
  const url = host
    ? new URL(`${request.url.pathname}${request.url.search}`, `${protocol}://${host}`)
    : request.url;
  return new Request(url, { method: request.method, headers: request.headers });
}
