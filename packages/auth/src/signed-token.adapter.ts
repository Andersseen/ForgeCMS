import type { AuthAdapter, AuthSession, AuthUser } from './index.js';
import { ForgeAuthError } from './index.js';
import { extractToken, issueToken, looksLikeSignedToken, validateSession } from './token-signer.js';

export interface SignedTokenEnv {
  AUTH_SECRET?: string;
}

export interface SignedTokenAdapterOptions {
  devMode?: boolean;
}

/** Demo credentials published on the login page — intentional for a public demo. */
export const DEMO_CREDENTIALS = { email: 'demo@forgecms.dev', password: 'forgecms-demo' } as const;

const DEV_SECRET = 'forgecms-dev-only-signing-secret-do-not-use-in-real-deployments';
const DEMO_PASSWORD_HASH = 'aa4621ba371597dfbbdb49da1b6fc6e963c614581701f16a28803ad4b05ee70d';

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export class SignedTokenAuthAdapter implements AuthAdapter {
  readonly name = 'signed-token';
  private secret?: string;
  private readonly devMode: boolean;

  constructor(options: SignedTokenAdapterOptions = {}) {
    this.devMode = options.devMode ?? false;
  }

  init(env?: SignedTokenEnv): this {
    if (env?.AUTH_SECRET) {
      this.secret = env.AUTH_SECRET;
      return this;
    }

    if (this.devMode) {
      this.secret = DEV_SECRET;
      return this;
    }

    throw new Error(
      'SignedTokenAuthAdapter requires AUTH_SECRET to be set. ' +
        'In development, pass { devMode: true } to the constructor to use the built-in dev secret. ' +
        'In production, set AUTH_SECRET as an environment variable or secret.'
    );
  }

  private getSecret(): string {
    if (!this.secret) {
      throw new Error('SignedTokenAuthAdapter not initialized. Call init() first.');
    }
    return this.secret;
  }

  extractToken(request: Request): string | null {
    return extractToken(request);
  }

  /** Cheap format check for `CompositeAuthAdapter` routing — see `AuthAdapter.canHandleToken`. */
  canHandleToken(token: string): boolean {
    return looksLikeSignedToken(token);
  }

  async issueToken(user: AuthUser): Promise<string> {
    return issueToken(this.getSecret(), user);
  }

  async validateSession(token: string): Promise<AuthSession | null> {
    return validateSession(this.getSecret(), token);
  }

  async requireAuth(request: Request): Promise<AuthUser> {
    const token = this.extractToken(request);
    if (!token) throw new ForgeAuthError('Unauthorized', 'unauthorized');
    const session = await this.validateSession(token);
    if (!session) throw new ForgeAuthError('Unauthorized', 'unauthorized');
    return session.user;
  }

  async login(email: string, password: string): Promise<{ token: string; user: AuthUser } | null> {
    if (email !== DEMO_CREDENTIALS.email) return null;
    const hash = await sha256Hex(password);
    if (hash !== DEMO_PASSWORD_HASH) return null;

    const user: AuthUser = { id: 'demo-user', email: DEMO_CREDENTIALS.email, roles: ['admin'] };
    const token = await this.issueToken(user);
    return { token, user };
  }
}
