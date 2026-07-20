import type { H3Event } from 'h3';
import { getRequestHeaders, getRequestURL } from 'h3';

/**
 * Build a headers-only Request for auth validation.
 *
 * Avoids `toWebRequest(event)` because that consumes the request body, which breaks later
 * `readBody(event)` calls in POST/PUT handlers.
 */
export function createAuthRequest(event: H3Event): Request {
  const rawHeaders = getRequestHeaders(event);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (value !== undefined) {
      headers[key] = value;
    }
  }
  return new Request(getRequestURL(event), { headers });
}
