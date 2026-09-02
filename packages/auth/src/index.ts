export { InMemoryAuthAdapter } from './in-memory.adapter.js';
export { ExternalAuthAdapter } from './external.adapter.js';
export type { ExternalAuthConfig } from './external.adapter.js';
export { SignedTokenAuthAdapter, DEMO_CREDENTIALS } from './signed-token.adapter.js';
export type { SignedTokenEnv } from './signed-token.adapter.js';
export { UsersCollectionAuthAdapter } from './users-collection.adapter.js';
export type { UsersCollectionAuthEnv, CreateUserInput } from './users-collection.adapter.js';
export { ApiKeyAuthAdapter } from './api-key.adapter.js';
export type {
  ApiKeyAuthEnv,
  ApiKeyAuthAdapterOptions,
  ApiKey,
  CreateApiKeyInput,
  CreateApiKeyResult
} from './api-key.adapter.js';
export { CompositeAuthAdapter } from './composite.adapter.js';
export { hasScope, hasAnyScope, hasAllScopes } from './scopes.js';
export { AUTH_USER_FIELDS, withAuthFields, defineUsersCollection } from './user-fields.js';
export type { DefineUsersCollectionOptions } from './user-fields.js';
export {
  SESSION_COOKIE_NAME,
  parseCookieToken,
  buildSessionCookie,
  buildLogoutCookie
} from './cookie.js';
export type { SessionCookieOptions } from './cookie.js';
export { extractBearerToken } from './token-signer.js';
export type { UserRole } from './roles.js';
export {
  USER_ROLES,
  userRole,
  hasRole,
  hasAnyRole,
  isAdmin,
  canWriteContent,
  canManageUsers
} from './roles.js';

export class ForgeAuthError extends Error {
  constructor(
    message: string,
    public readonly code: 'unauthorized' | 'forbidden' | 'expired' = 'unauthorized'
  ) {
    super(message);
    this.name = 'ForgeAuthError';
  }
}

export interface AuthUser {
  id: string;
  email?: string;
  name?: string;
  role?: string;
  roles?: string[];
  /** Generic scope strings for machine (or any) principals — see `hasScope`/`hasAnyScope`/`hasAllScopes`. */
  scopes?: string[];
  metadata?: Record<string, unknown>;
}

export interface AuthSession<TUser extends AuthUser = AuthUser> {
  user: TUser;
  expiresAt?: Date;
}

/** Why a login/signup attempt was rejected — lets the HTTP boundary give a precise, safe message. */
export type AuthFailureReason =
  | 'invalid-credentials'
  | 'email-in-use'
  | 'weak-password'
  | 'invalid-email';

export type AuthActionResult<TUser extends AuthUser = AuthUser> =
  | { ok: true; token: string; user: TUser }
  | { ok: false; reason: AuthFailureReason };

export interface PublicSignupInput {
  email: string;
  password: string;
  name?: string;
}

export interface AuthAdapter<TUser extends AuthUser = AuthUser> {
  readonly name: string;
  init(env?: unknown): this;
  extractToken(request: Request): string | null;
  validateSession(token: string): Promise<AuthSession<TUser> | null>;
  requireAuth(request: Request): Promise<TUser>;
  /** Optional schema/table bootstrap, invoked by `ForgeCmsRuntime.syncSchema()`. */
  syncSchema?(): Promise<void>;
  /**
   * Optional cheap, synchronous format check: does this token even look like one of ours? Lets
   * `CompositeAuthAdapter` skip an adapter's `requireAuth()` (a DB round-trip, an HMAC verification —
   * work that can only fail) when a token is obviously shaped for a different strategy. Adapters
   * without this method are always attempted, exactly as before it existed — fully optional and
   * backward compatible, and never required for a custom/third-party `AuthAdapter` to work correctly
   * inside a `CompositeAuthAdapter`.
   */
  canHandleToken?(token: string): boolean;
  /** Optional: adapters that support password login implement this (spec 053). */
  login?(email: string, password: string): Promise<AuthActionResult<TUser>>;
  /**
   * Optional: adapters that support public self-service signup implement this (spec 053). The input
   * type deliberately has no `role` field — a client cannot smuggle a role through the server API, not
   * just through a UI that happens to hide the field.
   */
  signup?(input: PublicSignupInput): Promise<AuthActionResult<TUser>>;
}
