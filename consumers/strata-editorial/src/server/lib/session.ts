import type { H3Event } from 'h3';
import { getRequestHeaders, getRequestProtocol, getRequestURL, readRawBody } from 'h3';

import { getEditorialRuntime, nodeEnv } from '../../app/cms/runtime';
import type { EditorialEnv } from '../../app/cms/runtime';

/** Login bodies are tiny; anything larger is refused before it is buffered (ForgeCMS spec 069 bound). */
export const MAX_AUTH_BODY_BYTES = 8 * 1024;

export function envOf(event: H3Event): EditorialEnv {
  const cloudflare = event.context['cloudflare'] as { env?: EditorialEnv } | undefined;
  return cloudflare?.env ?? nodeEnv();
}

export const runtimeFor = (event: H3Event) => getEditorialRuntime(envOf(event));

/** `Secure` cookies whenever the request arrived over HTTPS (directly or via a TLS-terminating proxy). */
export const secureCookies = (event: H3Event) =>
  getRequestProtocol(event, { xForwardedProto: true }) === 'https';

function headersOf(event: H3Event): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(getRequestHeaders(event))) {
    if (typeof value === 'string') headers.set(name, value);
  }
  return headers;
}

/** A Web Request for ForgeCMS's handlers. Bodies over the bound answer `null` (the route returns 413). */
export async function webRequest(event: H3Event): Promise<Request | null> {
  const headers = headersOf(event);
  const url = getRequestURL(event);
  if (event.method === 'GET' || event.method === 'HEAD') {
    return new Request(url, { method: event.method, headers });
  }
  const declared = Number(headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_AUTH_BODY_BYTES) return null;
  const body = (await readRawBody(event, false)) ?? new Uint8Array();
  if (body.byteLength > MAX_AUTH_BODY_BYTES) return null;
  return new Request(url, { method: event.method, headers, body });
}

export const payloadTooLarge = () =>
  new Response(JSON.stringify({ error: 'Payload too large' }), {
    status: 413,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
