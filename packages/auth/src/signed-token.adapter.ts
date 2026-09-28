import type { AuthActionResult, AuthAdapter, AuthSession, AuthUser } from './index.js';
import { ForgeAuthError } from './index.js';
import {
  extractToken,
  issueToken,
  looksLikeSignedToken,
  resolveSigningSecret,
  validateSession
} from './token-signer.js';

export interface SignedTokenEnv {
  AUTH_SECRET?: string;
}

export interface SignedTokenAdapterOptions {
  /**
   * Explicit local-development opt-in: without `AUTH_SECRET`, sign with Forge's built-in, publicly known
   * dev secret, and accept a secret shorter than 32 bytes. Never derive it from a missing secret.
   */
  devMode?: boolean;
}

/** Demo credentials published on the login page — intentional for a public demo. */
export const DEMO_CREDENTIALS = { email: 'demo@forgecms.dev', password: 'forgecms-demo' } as const;

const DEMO_PASSWORD_HASH = 'aa4621ba371597dfbbdb49da1b6fc6e963c614581701f16a28803ad4b05ee70d';
/** Same default ceiling as `UsersCollectionAuthAdapter` (spec 069): longer input is never hashed. */
const MAX_PASSWORD_LENGTH = 1024;

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
    this.secret = resolveSigningSecret('SignedTokenAuthAdapter', env?.AUTH_SECRET, this.devMode);
    return this;
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

  async login(email: string, password: string): Promise<AuthActionResult> {
    // The single demo account is published, so skipping the hash for another email discloses nothing.
    if (email !== DEMO_CREDENTIALS.email || password.length > MAX_PASSWORD_LENGTH) {
      return { ok: false, reason: 'invalid-credentials' };
    }
    const hash = await sha256Hex(password);
    if (hash !== DEMO_PASSWORD_HASH) return { ok: false, reason: 'invalid-credentials' };

    const user: AuthUser = { id: 'demo-user', email: DEMO_CREDENTIALS.email, roles: ['admin'] };
    const token = await this.issueToken(user);
    return { ok: true, token, user };
  }
}
