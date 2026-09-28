import type { AuthSession, AuthUser } from './index.js';
import { parseCookieToken } from './cookie.js';
import { SESSION_TTL_SECONDS } from './session-lifetime.js';

const TOKEN_TTL_MS = SESSION_TTL_SECONDS * 1000;

/**
 * The longest signed token Forge accepts (spec 069). Checked before any split, base64 decode or HMAC,
 * so an oversized credential fails for the cost of a length comparison. A token Forge issues carries
 * `sub`, `email` (≤ 254 characters), `name` (≤ 256), role(s), `sv` and `exp`: a few KB at most, and a
 * browser cookie cannot hold more than ~4 KB anyway. Applies only to Forge's own token format, never to
 * a third-party adapter's.
 */
export const MAX_SIGNED_TOKEN_LENGTH = 8192;

/**
 * Minimum production signing-secret size (spec 069): 32 bytes of UTF-8, the HMAC-SHA256 output size —
 * RFC 2104 recommends a key no shorter than the hash output.
 */
export const MIN_SIGNING_SECRET_BYTES = 32;

/** Publicly known, so it may only ever be used under an explicit `devMode: true`. */
const DEV_SIGNING_SECRET = 'forgecms-dev-only-signing-secret-do-not-use-in-real-deployments';

/**
 * The signing secret an adapter uses (spec 069). Development mode is an explicit decision of the host —
 * `devMode: true` — and never follows from a missing secret: without `devMode` a missing secret, or one
 * shorter than {@link MIN_SIGNING_SECRET_BYTES}, fails configuration. The error never contains the secret.
 * Under `devMode` any provided secret is used as is, and none falls back to the public dev secret.
 */
export function resolveSigningSecret(
  adapterName: string,
  secret: string | undefined,
  devMode: boolean
): string {
  if (secret) {
    if (devMode || new TextEncoder().encode(secret).byteLength >= MIN_SIGNING_SECRET_BYTES) {
      return secret;
    }
    throw new Error(
      `${adapterName}: AUTH_SECRET is too short. A production signing secret must be at least ` +
        `${MIN_SIGNING_SECRET_BYTES} bytes (UTF-8); generate one with \`openssl rand -base64 48\`. ` +
        'Rotating it invalidates every issued session.'
    );
  }
  if (devMode) return DEV_SIGNING_SECRET;
  throw new Error(
    `${adapterName} requires AUTH_SECRET to be set. ` +
      'For local development only, pass { devMode: true } to the constructor to use the built-in, ' +
      'publicly known dev secret; a missing secret never enables it. ' +
      'In production, set AUTH_SECRET (at least 32 bytes) as an environment variable or secret.'
  );
}

interface TokenPayload {
  sub: string;
  email?: string;
  name?: string;
  role?: string;
  roles?: string[];
  exp: number;
  /**
   * Opaque session-freshness marker (spec 058 §6) — `UsersCollectionAuthAdapter` embeds its user
   * row's `_sessionVersion` here at issue time and compares it against the row's *current* value on
   * every `validateSession()` call, so a password change (which bumps the row's version) invalidates
   * every token issued before it. Every other token-signer-based adapter (`SignedTokenAuthAdapter`)
   * never sets this, so it is simply absent from their tokens and ignored — this field only has
   * meaning to the adapter that chooses to read it.
   */
  sv?: number;
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
  if (token.length > MAX_SIGNED_TOKEN_LENGTH) return false;
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

export async function issueToken(
  secret: string,
  user: AuthUser,
  sessionVersion?: number
): Promise<string> {
  const payload: TokenPayload = {
    sub: user.id,
    ...(user.email !== undefined && { email: user.email }),
    ...(user.name !== undefined && { name: user.name }),
    ...(user.role !== undefined && { role: user.role }),
    ...(user.roles !== undefined && { roles: user.roles }),
    ...(sessionVersion !== undefined && { sv: sessionVersion }),
    exp: Date.now() + TOKEN_TTL_MS
  };
  const payloadPart = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await getKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadPart));
  const signaturePart = base64UrlEncode(new Uint8Array(signature));
  return `${payloadPart}.${signaturePart}`;
}

export async function validateSession(secret: string, token: string): Promise<AuthSession | null> {
  if (!token || token.length > MAX_SIGNED_TOKEN_LENGTH) return null;
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
  return {
    user,
    expiresAt: new Date(payload.exp),
    ...(payload.sv !== undefined && { sessionVersion: payload.sv })
  };
}
