export const SESSION_COOKIE_NAME = 'forge_session';

const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * Reads the Forge session cookie from a request's `Cookie` header. Used as `extractToken`'s fallback
 * when no `Authorization` header is present, so a browser session and a Bearer-token client can share
 * the exact same signed-token validation path.
 */
export function parseCookieToken(
  request: Request,
  name: string = SESSION_COOKIE_NAME
): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;

  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key !== name) continue;
    const value = part.slice(eq + 1).trim();
    if (value.length === 0) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
}

export interface SessionCookieOptions {
  /** Omit the `Secure` attribute — only for local `http://` development. Defaults to `true`. */
  secure?: boolean;
  /** Defaults to 24h, matching the signed-token TTL. */
  maxAgeSeconds?: number;
}

/** Builds a `Set-Cookie` header value that starts a browser session. */
export function buildSessionCookie(token: string, options: SessionCookieOptions = {}): string {
  const { secure = true, maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS } = options;
  const attrs = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

/** Builds a `Set-Cookie` header value that clears the session cookie (logout). */
export function buildLogoutCookie(options: { secure?: boolean } = {}): string {
  const { secure = true } = options;
  const attrs = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}
