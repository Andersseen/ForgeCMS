import type { AuthAdapter, AuthSession, AuthUser } from './index.js';
import { ForgeAuthError } from './index.js';
import { extractToken, issueToken, validateSession } from './token-signer.js';

export interface SignedTokenEnv {
  AUTH_SECRET?: string;
}

/** Demo credentials published on the login page — intentional for a public demo. */
export const DEMO_CREDENTIALS = { email: 'demo@forgecms.dev', password: 'forgecms-demo' } as const;

const DEV_SECRET = 'forgecms-dev-only-signing-secret-do-not-use-in-real-deployments';
// SHA-256 of DEMO_CREDENTIALS.password — avoids a plaintext credential in source.
const DEMO_PASSWORD_HASH = 'aa4621ba371597dfbbdb49da1b6fc6e963c614581701f16a28803ad4b05ee70d';

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

  init(env?: SignedTokenEnv): this {
    this.secret = env?.AUTH_SECRET ?? DEV_SECRET;
    return this;
  }

  extractToken(request: Request): string | null {
    return extractToken(request);
  }

  /** Signs a token for a given user directly — used by `login()` and by tests. */
  async issueToken(user: AuthUser): Promise<string> {
    return issueToken(this.secret, user);
  }

  async validateSession(token: string): Promise<AuthSession | null> {
    return validateSession(this.secret, token);
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
