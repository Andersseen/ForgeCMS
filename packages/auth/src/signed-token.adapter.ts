import type { AuthAdapter, AuthSession, AuthUser } from './index.js';
import { ForgeAuthError } from './index.js';

export interface SignedTokenEnv {
  AUTH_SECRET?: string;
}

/** Demo credentials published on the login page — intentional for a public demo. */
export const DEMO_CREDENTIALS = { email: 'demo@forgecms.dev', password: 'forgecms-demo' } as const;

const DEV_SECRET = 'forgecms-dev-only-signing-secret-do-not-use-in-real-deployments';
// SHA-256 of DEMO_CREDENTIALS.password — avoids a plaintext credential in source.
const DEMO_PASSWORD_HASH = 'aa4621ba371597dfbbdb49da1b6fc6e963c614581701f16a28803ad4b05ee70d';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

interface TokenPayload {
  sub: string;
  email?: string;
  roles?: string[];
  exp: number;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Minimal HS256-JWT-like signed-token auth adapter, Web Crypto only (no jsonwebtoken/jose
 * dependency — consistent with CONVENTIONS.md's near-zero-runtime-deps rule, and Web Crypto works
 * identically in Node 18+ and Cloudflare Workers).
 */
export class SignedTokenAuthAdapter implements AuthAdapter {
  readonly name = 'signed-token';
  private secret = DEV_SECRET;
  private keyPromise: Promise<CryptoKey> | undefined;

  init(env?: SignedTokenEnv): this {
    this.secret = env?.AUTH_SECRET ?? DEV_SECRET;
    this.keyPromise = undefined;
    return this;
  }

  private getKey(): Promise<CryptoKey> {
    this.keyPromise ??= crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(this.secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );
    return this.keyPromise;
  }

  extractToken(request: Request): string | null {
    return request.headers.get('authorization')?.replace('Bearer ', '') ?? null;
  }

  /** Signs a token for a given user directly — used by `login()` and by tests. */
  async issueToken(user: AuthUser): Promise<string> {
    const payload: TokenPayload = {
      sub: user.id,
      ...(user.email !== undefined && { email: user.email }),
      ...(user.roles !== undefined && { roles: user.roles }),
      exp: Date.now() + TOKEN_TTL_MS
    };
    const payloadPart = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
    const key = await this.getKey();
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadPart));
    const signaturePart = base64UrlEncode(new Uint8Array(signature));
    return `${payloadPart}.${signaturePart}`;
  }

  async validateSession(token: string): Promise<AuthSession | null> {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payloadPart, signaturePart] = parts as [string, string];

    const key = await this.getKey();
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

  async requireAuth(request: Request): Promise<AuthUser> {
    const token = this.extractToken(request);
    const session = await this.validateSession(token ?? '');
    if (!session) throw new ForgeAuthError('Unauthorized', 'unauthorized');
    return session.user;
  }

  /** Validates email/password against the one hardcoded demo user; returns a signed token + user, or null. */
  async login(email: string, password: string): Promise<{ token: string; user: AuthUser } | null> {
    if (email !== DEMO_CREDENTIALS.email) return null;
    const hash = await sha256Hex(password);
    if (hash !== DEMO_PASSWORD_HASH) return null;

    const user: AuthUser = { id: 'demo-user', email: DEMO_CREDENTIALS.email, roles: ['admin'] };
    const token = await this.issueToken(user);
    return { token, user };
  }
}
