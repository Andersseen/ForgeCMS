import type { AtomicWriteOperation, DatabaseAdapter } from '@forge-cms/db';
export { InMemoryAuthAdapter } from './in-memory.adapter.js';
export { ExternalAuthAdapter } from './external.adapter.js';
export type { ExternalAuthConfig } from './external.adapter.js';
export { SignedTokenAuthAdapter, DEMO_CREDENTIALS } from './signed-token.adapter.js';
export type { SignedTokenEnv } from './signed-token.adapter.js';
export { UsersCollectionAuthAdapter } from './users-collection.adapter.js';
export type {
  UsersCollectionAuthEnv,
  UsersCollectionAuthAdapterOptions,
  PasswordPolicy,
  CreateUserInput
} from './users-collection.adapter.js';
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

/**
 * Why `UsersCollectionAuthAdapter.updateUser`/`deleteUser` rejected a change (spec 054; `'referenced'`:
 * spec 065; `'invalid-email'`/`'invalid-name'`: spec 069).
 */
export type UserMutationFailureReason =
  | 'last-admin'
  | 'weak-password'
  | 'referenced'
  | 'invalid-email'
  | 'invalid-name';

/**
 * Thrown by `UsersCollectionAuthAdapter.updateUser`/`deleteUser` instead of writing when the change
 * would leave the installation with zero admins (`'last-admin'`), set a password outside the configured
 * policy (`'weak-password'`), set an invalid email or an over-long name (`'invalid-email'`,
 * `'invalid-name'`), or delete a user that content or a global still references (`'referenced'`, spec
 * 065). A host route maps `reason` to a status (`409` for `last-admin`/`referenced`, otherwise `400`).
 */
export class UserMutationError extends Error {
  constructor(
    message: string,
    readonly reason: UserMutationFailureReason
  ) {
    super(message);
    this.name = 'UserMutationError';
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
  /**
   * Opaque session-freshness marker, present only for tokens issued by an adapter that embeds one
   * (currently `UsersCollectionAuthAdapter` — spec 058 §6). Adapters that don't set it never populate
   * this field; it carries no meaning outside the adapter that issued the token.
   */
  sessionVersion?: number;
}

/** Why a login/signup attempt was rejected — lets the HTTP boundary give a precise, safe message. */
export type AuthFailureReason =
  | 'invalid-credentials'
  | 'email-in-use'
  | 'weak-password'
  | 'invalid-email'
  /** A `name` over 256 characters (spec 069) — names are carried in every session token. */
  | 'invalid-name';

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
  /**
   * Optional (spec 061): does this adapter own the identity and lifecycle of the documents in the
   * collection `slug`? When it returns `true`, `@forge-cms/runtime` refuses every generic content
   * `create`/`update`/`delete` of that collection — Local API (trusted or not) and HTTP alike — because
   * those bypass the adapter's own invariants (first-admin provisioning, last-admin protection,
   * password hashing, email normalisation, session versioning). Reads are unaffected, and so is direct
   * `DatabaseAdapter` access, which is trusted low-level infrastructure below these guarantees.
   *
   * Adapters that keep no users in a Forge collection (`ExternalAuthAdapter`, `SignedTokenAuthAdapter`,
   * `ApiKeyAuthAdapter`, `InMemoryAuthAdapter`, any third-party adapter) simply omit it: absent means
   * `false`. Fully optional and backward compatible.
   */
  managesCollection?(slug: string): boolean;
  /**
   * Optional (spec 065), **infrastructure wiring — application code does not call it.** `ForgeCmsRuntime`
   * calls it once per registered collection this adapter {@link managesCollection manages}, handing over
   * the relation integrity that deleting one of its documents must respect: the adapter must commit
   * `guard.assertions(id)` in the **same** `atomicWrite` as its own delete of `id`, so a document that
   * content or a global still references is never deleted, even by a racing writer.
   *
   * Returns `true` only if the adapter will enforce the guard for `collection`. An adapter that manages a
   * collection some content references but omits this (or returns `false`) makes the runtime refuse to
   * start — it would otherwise leave that reference unprotected. Adapters that manage no collection
   * simply omit it. Fully optional and backward compatible.
   */
  setManagedDeleteGuard?(collection: string, guard: ManagedDeleteGuard): boolean;
}

/**
 * What must hold, atomically, for deleting a document of an auth-managed collection (spec 065). Pure data
 * from `@forge-cms/runtime`, which alone knows the content schema: auth never learns which fields
 * reference it, and never depends on the runtime.
 */
export interface ManagedDeleteGuard {
  /** The database the assertions address (the content database). The adapter's own must be this one. */
  readonly database: DatabaseAdapter;
  /**
   * Read-only `assertCount` preconditions for deleting `id`: every one of them must pass inside the
   * delete's batch. An empty list means nothing references the collection.
   */
  assertions(id: string): readonly AtomicWriteOperation[];
}
