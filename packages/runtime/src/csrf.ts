import { SESSION_COOKIE_NAME, extractBearerToken } from '@forge-cms/auth';
import { CsrfError } from './errors.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * A request carries the ambient Forge session cookie as its only credential — no well-formed
 * `Authorization: Bearer` — and is therefore the shape a cross-site page could forge (a browser
 * attaches cookies to a cross-origin request automatically; it cannot attach a custom header without
 * CORS explicitly allowing it). Tests for a *valid* Bearer credential specifically (via the same
 * `extractBearerToken` `extractToken` itself uses), not mere presence of an `Authorization` header —
 * otherwise a malformed header (e.g. `Authorization: Basic ...`) would make this function think no
 * cookie is in play while `extractToken` falls through to the cookie anyway, letting exactly the
 * request this check exists to catch skip it.
 */
function usesCookieCredential(request: Request): boolean {
  if (extractBearerToken(request) !== null) return false;
  const cookie = request.headers.get('cookie');
  if (!cookie) return false;
  return cookie.split(';').some((part) => part.trim().startsWith(`${SESSION_COOKIE_NAME}=`));
}

function isSameOrigin(request: Request): boolean {
  const source = request.headers.get('origin') ?? request.headers.get('referer');
  if (!source) return false;
  try {
    return new URL(source).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

/**
 * Rejects a cross-site mutating request that would otherwise ride on the ambient session cookie.
 * A no-op for `GET`/`HEAD`/etc., and for any request authenticated via `Authorization: Bearer`
 * (machine/API-key clients, and today's Bearer/`localStorage` browser client, are unaffected).
 */
export function assertCsrfSafe(request: Request): void {
  if (!MUTATING_METHODS.has(request.method)) return;
  if (!usesCookieCredential(request)) return;
  if (!isSameOrigin(request)) throw new CsrfError();
}
