import type { AuthSession, AuthUser } from './index.js';
import { parseCookieToken } from './cookie.js';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

interface TokenPayload {
  sub: string;
  email?: string;
  name?: string;
  role?: string;
  roles?: string[];
  exp: number;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function getKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/**
 * Cheap format check shared by every token-signer-based adapter (`SignedTokenAuthAdapter`,
 * `UsersCollectionAuthAdapter`): a signed token is exactly `<payload>.<signature>`, two non-empty
 * base64url segments. Used for `AuthAdapter.canHandleToken` — lets `CompositeAuthAdapter` skip an
 * HMAC verification for a token shaped for a different strategy (e.g. an API key, which never
 * contains a `.`).
 */
export function looksLikeSignedToken(token: string): boolean {
  const parts = token.split('.');
  return parts.length === 2 && parts.every((part) => part.length > 0);
}

/**
 * A well-formed `Authorization: Bearer <token>` header, or `null` if absent/malformed (e.g.
 * `Basic ...`, or `Bearer` with no token). Exported so `@forge-cms/runtime`'s CSRF check
 * (`usesCookieCredential`) can test for exactly the same condition `extractToken` uses to decide
 * whether it even looks at the cookie — an `Authorization` header that isn't a valid Bearer credential
 * must not be treated as "not a cookie session" by one and "is a cookie session" by the other.
 */
export function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}

/**
 * `Authorization: Bearer` takes precedence (machine/programmatic clients); a browser session with no
 * such header falls back to the Forge session cookie — this is what lets a page refresh authenticate
 * from the cookie alone, with no client JS re-attaching a stored token.
 */
export function extractToken(request: Request): string | null {
  return extractBearerToken(request) ?? parseCookieToken(request);
}

export async function issueToken(secret: string, user: AuthUser): Promise<string> {
  const payload: TokenPayload = {
    sub: user.id,
    ...(user.email !== undefined && { email: user.email }),
    ...(user.name !== undefined && { name: user.name }),
    ...(user.role !== undefined && { role: user.role }),
    ...(user.roles !== undefined && { roles: user.roles }),
    exp: Date.now() + TOKEN_TTL_MS
  };
  const payloadPart = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await getKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadPart));
  const signaturePart = base64UrlEncode(new Uint8Array(signature));
  return `${payloadPart}.${signaturePart}`;
}

export async function validateSession(secret: string, token: string): Promise<AuthSession | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadPart, signaturePart] = parts as [string, string];

  const key = await getKey(secret);
  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlDecode(signaturePart),
      new TextEncoder().encode(payloadPart)
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart))) as TokenPayload;
  } catch {
    return null;
  }
  if (payload.exp < Date.now()) return null;

  const user: AuthUser = {
    id: payload.sub,
    ...(payload.email !== undefined && { email: payload.email }),
    ...(payload.name !== undefined && { name: payload.name }),
    ...(payload.role !== undefined && { role: payload.role }),
    ...(payload.roles !== undefined && { roles: payload.roles })
  };
  return { user, expiresAt: new Date(payload.exp) };
}
