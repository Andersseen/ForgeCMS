import type { AuthSession, AuthUser } from './index.js';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

interface TokenPayload {
  sub: string;
  email?: string;
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

export function extractToken(request: Request): string | null {
  return request.headers.get('authorization')?.replace('Bearer ', '') ?? null;
}

export async function issueToken(secret: string, user: AuthUser): Promise<string> {
  const payload: TokenPayload = {
    sub: user.id,
    ...(user.email !== undefined && { email: user.email }),
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
    ...(payload.roles !== undefined && { roles: payload.roles })
  };
  return { user, expiresAt: new Date(payload.exp) };
}
