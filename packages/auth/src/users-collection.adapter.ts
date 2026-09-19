import type { CollectionDefinition } from '@forge-cms/core';
import { defineField } from '@forge-cms/core';
import type { DatabaseAdapter, DatabaseRecord, WriteCondition } from '@forge-cms/db';
import { isUniqueConstraintError } from '@forge-cms/db';
import type {
  AuthActionResult,
  AuthAdapter,
  AuthSession,
  AuthUser,
  PublicSignupInput
} from './index.js';
import { ForgeAuthError, UserMutationError } from './index.js';
import { extractToken, issueToken, looksLikeSignedToken, validateSession } from './token-signer.js';
import type { UserRole } from './roles.js';
import { hasAnyRole } from './roles.js';

export interface UsersCollectionAuthEnv {
  AUTH_SECRET?: string;
  userDatabase?: DatabaseAdapter;
}

export interface PasswordPolicy {
  /** Defaults to 8. */
  minLength?: number;
}

export interface UsersCollectionAuthAdapterOptions {
  devMode?: boolean;
  passwordPolicy?: PasswordPolicy;
  /** Defaults to `'users'` — must match the slug passed to `defineUsersCollection()`/`withAuthFields()`. */
  collection?: string;
}

export interface CreateUserInput {
  email: string;
  password: string;
  name?: string;
  role?: 'admin' | 'editor' | 'viewer';
}

/** What every new user row starts from; the role is decided by the provisioning path. */
interface NewAccount {
  email: string;
  name: string;
  passwordHash: string;
}

const DEFAULT_COLLECTION = 'users';
const DEV_SECRET = 'forgecms-dev-only-signing-secret-do-not-use-in-real-deployments';
const DEFAULT_MIN_PASSWORD_LENGTH = 8;
const BOOTSTRAP_COLLECTION = '_forge_bootstrap';
/**
 * The last-admin invariant as a storage-level precondition (spec 059): a row currently in the admin set
 * may only be removed from it (deleted, or given a non-admin role) while at least one OTHER admin
 * remains — decided by the database inside the write itself, scoped to the write's own collection.
 */
const LAST_ADMIN_GUARD: WriteCondition = {
  keepAtLeast: { where: { role: 'admin' }, others: 1 }
};
/** Matches `@forge-cms/core`'s own `email` field validator (`validation.ts`'s `email_format` check). */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SALT_BYTES = 16;
const ITERATIONS = 100_000;
const KEY_BITS = 256;

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

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i]! ^ b[i]!;
  }
  return result === 0;
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    KEY_BITS
  );
  const hash = new Uint8Array(derived);
  const combined = new Uint8Array(salt.length + hash.length);
  combined.set(salt);
  combined.set(hash, salt.length);
  return base64UrlEncode(combined);
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const combined = base64UrlDecode(stored);
  const salt = combined.slice(0, SALT_BYTES);
  const hash = combined.slice(SALT_BYTES);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    KEY_BITS
  );
  return timingSafeEqual(new Uint8Array(derived), hash);
}

function sanitizeUser(record: DatabaseRecord): AuthUser {
  const { passwordHash: _ignored, _sessionVersion: _ignoredVersion, ...rest } = record;
  void _ignored;
  void _ignoredVersion;
  return rest as unknown as AuthUser;
}

/** `_sessionVersion` defaults to `0` for any row written before spec 058 — no migration needed. */
function sessionVersionOf(record: DatabaseRecord): number {
  return (record._sessionVersion as number | undefined) ?? 0;
}

/** Case/whitespace-insensitive email lookups and storage — `Foo@Bar.com` and `foo@bar.com` are one user. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}

function meetsPasswordPolicy(password: string, policy: PasswordPolicy | undefined): boolean {
  const minLength = policy?.minLength ?? DEFAULT_MIN_PASSWORD_LENGTH;
  return password.length >= minLength;
}

/**
 * Internal system collection whose sole purpose is a unique-index-backed compare-and-swap for the
 * first-admin bootstrap race (spec 058 §7a). Deliberately not built via `defineCollection()` — its
 * identifier validation rejects the reserved `_forge_` prefix for *consumer* collections, and this is
 * the one legitimate internal user of it, matching `ApiKeyAuthAdapter`'s `_forge_api_keys` pattern.
 */
function buildBootstrapCollection(): CollectionDefinition {
  return {
    slug: BOOTSTRAP_COLLECTION,
    access: {
      read: () => false,
      create: () => false,
      update: () => false,
      delete: () => false
    },
    fields: {
      slot: defineField.text({ required: true, unique: true })
    }
  };
}

/**
 * Auth adapter backed by a real `users` collection in the configured database.
 * Passwords are hashed with PBKDF2 (Web Crypto) and never stored or returned in plain text.
 */
export class UsersCollectionAuthAdapter implements AuthAdapter {
  readonly name = 'users-collection';
  private secret?: string;
  private db?: DatabaseAdapter;
  private collection: string;
  private readonly devMode: boolean;
  private readonly passwordPolicy?: PasswordPolicy;

  constructor(options: UsersCollectionAuthAdapterOptions = {}) {
    this.devMode = options.devMode ?? false;
    if (options.passwordPolicy !== undefined) this.passwordPolicy = options.passwordPolicy;
    this.collection = options.collection ?? DEFAULT_COLLECTION;
  }

  init(env?: UsersCollectionAuthEnv): this {
    if (env?.AUTH_SECRET) {
      this.secret = env.AUTH_SECRET;
    } else if (this.devMode) {
      this.secret = DEV_SECRET;
    } else {
      throw new Error(
        'UsersCollectionAuthAdapter requires AUTH_SECRET to be set. ' +
          'In development, pass { devMode: true } to the constructor to use the built-in dev secret. ' +
          'In production, set AUTH_SECRET as an environment variable or secret.'
      );
    }

    if (env?.userDatabase !== undefined) {
      // The last-admin invariant (spec 059) and first-admin provisioning (spec 060) are decided by the
      // database. A custom adapter that predates `updateIf`/`deleteIf`/`atomicWrite` cannot make them
      // safe, so fail here — before any affected operation can run — rather than at the first demotion
      // or the first signup. (TypeScript implementers get this at compile time.)
      const { updateIf, deleteIf, atomicWrite } = env.userDatabase as Partial<DatabaseAdapter>;
      if (
        typeof updateIf !== 'function' ||
        typeof deleteIf !== 'function' ||
        typeof atomicWrite !== 'function'
      ) {
        throw new Error(
          `UsersCollectionAuthAdapter requires a DatabaseAdapter that implements updateIf(), deleteIf() ` +
            `and atomicWrite() (conditional and atomic writes, specs 059/060) to enforce the last-admin ` +
            `invariant and first-admin provisioning atomically; ` +
            `'${String(env.userDatabase.name ?? 'an unnamed adapter')}' does not.`
        );
      }
      this.db = env.userDatabase;
    }
    return this;
  }

  private getSecret(): string {
    if (!this.secret) {
      throw new Error('UsersCollectionAuthAdapter not initialized. Call init() first.');
    }
    return this.secret;
  }

  private getDb(): DatabaseAdapter {
    if (!this.db)
      throw new Error('UsersCollectionAuthAdapter not initialized. Call init() with userDatabase.');
    return this.db;
  }

  extractToken(request: Request): string | null {
    return extractToken(request);
  }

  /** Cheap format check for `CompositeAuthAdapter` routing — see `AuthAdapter.canHandleToken`. */
  canHandleToken(token: string): boolean {
    return looksLikeSignedToken(token);
  }

  /** Provisions `_forge_bootstrap`'s unique-index-backed bootstrap slot (spec 058 §7a). */
  async syncSchema(): Promise<void> {
    await this.ensureBootstrapSchema(this.getDb());
  }

  /**
   * Registers `_forge_bootstrap` on first use so {@link createFirstAdmin} works even for a
   * `UsersCollectionAuthAdapter` used standalone (not through `ForgeCmsRuntime.syncSchema()`, which
   * would otherwise be the only caller of {@link syncSchema}) — some real adapters (libSQL, D1) throw
   * outright on a write to a never-synced collection, rather than merely skipping unique-index
   * enforcement the way `InMemoryDatabaseAdapter` does, so this cannot be left to the consumer to
   * remember. Memoized per adapter instance; `syncSchema` is additive/idempotent, so a duplicate call
   * (e.g. this instance's own explicit `syncSchema()` running after a lazy call already happened) is
   * harmless.
   */
  private bootstrapSchemaReady = false;
  private async ensureBootstrapSchema(db: DatabaseAdapter): Promise<void> {
    if (this.bootstrapSchemaReady) return;
    await db.syncSchema([buildBootstrapCollection()]);
    this.bootstrapSchemaReady = true;
  }

  /**
   * Provisions the first administrator as ONE atomic write (spec 060): the `_forge_bootstrap` claim and
   * the admin user commit together or not at all. Of any number of concurrent first callers the database
   * lets exactly one batch commit — the claim's unique index rejects every other — and a failure of the
   * user insert (a duplicate email, a database error) rolls the claim back with it, so a failed first
   * creation can never consume the bootstrap opportunity (spec 058 §7a committed the claim first and
   * created the user second, leaving a claim with no administrator behind it).
   *
   * The claim is keyed by `this.collection`, not a single fixed value: `_forge_bootstrap` is one table
   * shared by every `UsersCollectionAuthAdapter` instance pointed at the same database, and more than one
   * can legitimately coexist there (the `collection` constructor option exists precisely so a consumer
   * can target a renamed/second `users`-like collection) — each one's "first admin" is a property of
   * *its own* users table, not of the database as a whole.
   *
   * `'lost-claim'` means another caller provisioned the first admin (nothing of this batch persisted);
   * `'email-in-use'` means the user insert conflicted (the claim was rolled back too). Any other failure
   * propagates: nothing persisted, so the next attempt can still become the administrator.
   */
  private async createFirstAdmin(
    db: DatabaseAdapter,
    account: NewAccount
  ): Promise<DatabaseRecord | 'lost-claim' | 'email-in-use'> {
    await this.ensureBootstrapSchema(db);
    try {
      const [, created] = await db.atomicWrite([
        { type: 'create', collection: BOOTSTRAP_COLLECTION, data: { slot: this.collection } },
        { type: 'create', collection: this.collection, data: { ...account, role: 'admin' } }
      ]);
      if (created?.type !== 'create') {
        throw new Error(
          'atomicWrite returned an unexpected result for the first-admin batch — the batch itself may ' +
            'already have committed (claim and admin user persisted); check the users collection before retrying'
        );
      }
      return created.record;
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        if (err.collection === BOOTSTRAP_COLLECTION) return 'lost-claim';
        if (err.collection === this.collection) return 'email-in-use';
      }
      throw err;
    }
  }

  /**
   * Inserts a new user. The very first user of a fresh install is provisioned as the administrator by
   * {@link createFirstAdmin}; everyone else (including a caller that just lost the first-admin claim, or
   * any user of a database whose claim was already consumed) is created with `fallbackRole`. Returns
   * `'email-in-use'` for a unique-index conflict.
   */
  private async insertUser(
    db: DatabaseAdapter,
    account: NewAccount,
    fallbackRole: 'admin' | 'editor' | 'viewer'
  ): Promise<DatabaseRecord | 'email-in-use'> {
    if (!(await this.hasAnyUser(db))) {
      const first = await this.createFirstAdmin(db, account);
      if (first !== 'lost-claim') return first;
    }

    try {
      return await db.create(this.collection, { ...account, role: fallbackRole });
    } catch (err) {
      if (isUniqueConstraintError(err)) return 'email-in-use';
      throw err;
    }
  }

  /**
   * Re-validates the signed token, then re-reads the *current* user row and refreshes role/email/
   * name from it (spec 058 §6) — a demoted or renamed user's privileges/identity take effect on the
   * very next request, instead of waiting out the token's 24h TTL. A row that no longer exists (the
   * user was deleted) invalidates the session. `_sessionVersion` is bumped by a password change
   * (see `updateUser`); a token issued before that bump fails the version comparison below, so a
   * password change invalidates every session issued before it — the narrow, documented mechanism
   * this adapter uses instead of a general session store (there is no way to invalidate only *one* of
   * several outstanding sessions without one). A database failure here is a genuine unexpected error
   * and must propagate (surfacing as `500` through the existing `CompositeAuthAdapter`/HTTP boundary
   * convention), not be swallowed into a misleading "invalid session".
   */
  async validateSession(token: string): Promise<AuthSession | null> {
    const session = await validateSession(this.getSecret(), token);
    if (!session) return null;

    const db = this.getDb();
    const record = await db.findById(this.collection, session.user.id);
    if (!record) return null;

    if (sessionVersionOf(record) !== (session.sessionVersion ?? 0)) return null;

    return {
      user: sanitizeUser(record),
      ...(session.expiresAt && { expiresAt: session.expiresAt })
    };
  }

  async requireAuth(request: Request): Promise<AuthUser> {
    const token = this.extractToken(request);
    if (!token) throw new ForgeAuthError('Unauthorized', 'unauthorized');
    const session = await this.validateSession(token);
    if (!session) throw new ForgeAuthError('Unauthorized', 'unauthorized');
    return session.user;
  }

  async requireRole(request: Request, role: UserRole): Promise<AuthUser> {
    const user = await this.requireAuth(request);
    if (!hasAnyRole(user, [role])) {
      throw new ForgeAuthError('Forbidden', 'forbidden');
    }
    return user;
  }

  async requireAnyRole(request: Request, roles: UserRole[]): Promise<AuthUser> {
    const user = await this.requireAuth(request);
    if (!hasAnyRole(user, roles)) {
      throw new ForgeAuthError('Forbidden', 'forbidden');
    }
    return user;
  }

  async login(email: string, password: string): Promise<AuthActionResult> {
    const db = this.getDb();
    const records = await db.findMany({
      collection: this.collection,
      where: { email: normalizeEmail(email) }
    });
    const record = records[0];
    if (!record) return { ok: false, reason: 'invalid-credentials' };

    const storedHash = record.passwordHash as string | undefined;
    if (!storedHash) return { ok: false, reason: 'invalid-credentials' };

    const valid = await verifyPassword(password, storedHash);
    if (!valid) return { ok: false, reason: 'invalid-credentials' };

    const user = sanitizeUser(record);
    const token = await issueToken(this.getSecret(), user, sessionVersionOf(record));
    return { ok: true, token, user };
  }

  /** `true` once the users collection has at least one row — used by the first-admin bootstrap. */
  private async hasAnyUser(db: DatabaseAdapter): Promise<boolean> {
    const existing = await db.findMany({ collection: this.collection, limit: 1 });
    return existing.length > 0;
  }

  /**
   * Trusted, admin-facing user creation: the caller picks the role. The very first user created in a
   * fresh install is always forced to `admin` regardless of the requested role, so a new install can
   * never end up with a non-admin as its only user (provisioned atomically with its bootstrap claim,
   * spec 060).
   *
   * This is also the documented recovery for a database whose bootstrap claim was burned before spec 060
   * (claim present, no admin): a caller that does not win the claim gets the *requested* role, so
   * `createUser({ …, role: 'admin' })` provisions an administrator without touching the claim. It is
   * trusted-server code only — see {@link updateUser} for promoting an existing user.
   */
  async createUser(input: CreateUserInput): Promise<AuthActionResult> {
    const email = normalizeEmail(input.email);
    if (!isValidEmail(email)) return { ok: false, reason: 'invalid-email' };
    if (!meetsPasswordPolicy(input.password, this.passwordPolicy)) {
      return { ok: false, reason: 'weak-password' };
    }

    const db = this.getDb();
    const existing = await db.findMany({ collection: this.collection, where: { email } });
    if (existing.length > 0) return { ok: false, reason: 'email-in-use' };

    const passwordHash = await hashPassword(input.password);
    const record = await this.insertUser(
      db,
      { email, name: input.name ?? '', passwordHash },
      input.role ?? 'viewer'
    );
    if (record === 'email-in-use') return { ok: false, reason: 'email-in-use' };

    const user = sanitizeUser(record);
    const token = await issueToken(this.getSecret(), user, sessionVersionOf(record));
    return { ok: true, token, user };
  }

  /**
   * Public, self-service signup. Unlike {@link createUser}, `input` has no `role` field at all — a
   * client cannot smuggle a role through the server API. The first user ever created gets `admin`
   * (same bootstrap rule as `createUser`); every other signup gets `viewer`.
   */
  async signup(input: PublicSignupInput): Promise<AuthActionResult> {
    const email = normalizeEmail(input.email);
    if (!isValidEmail(email)) return { ok: false, reason: 'invalid-email' };
    if (!meetsPasswordPolicy(input.password, this.passwordPolicy)) {
      return { ok: false, reason: 'weak-password' };
    }

    const db = this.getDb();
    const existing = await db.findMany({ collection: this.collection, where: { email } });
    if (existing.length > 0) return { ok: false, reason: 'email-in-use' };

    // Same path as `createUser`, reachable here through a *public* endpoint — which is what makes the
    // first-admin provisioning security-sensitive. Nobody but the very first user can become admin.
    const passwordHash = await hashPassword(input.password);
    const record = await this.insertUser(
      db,
      { email, name: input.name ?? '', passwordHash },
      'viewer'
    );
    if (record === 'email-in-use') return { ok: false, reason: 'email-in-use' };

    const user = sanitizeUser(record);
    const token = await issueToken(this.getSecret(), user, sessionVersionOf(record));
    return { ok: true, token, user };
  }

  async listUsers(): Promise<AuthUser[]> {
    const db = this.getDb();
    const records = await db.findMany({ collection: this.collection });
    return records.map(sanitizeUser);
  }

  /**
   * Updates a user. Rejects (via {@link UserMutationError}) rather than writing when the change would:
   * - set a password shorter than the configured policy, or
   * - remove the last remaining admin's admin role.
   *
   * The second check, together with {@link deleteUser}'s, is the whole last-admin invariant: a users
   * collection can never end up with zero admins *through this adapter*, however the change is attempted
   * (self-demote, demoted by another admin, self-delete, deleted by another admin) and however many of
   * them run at once. Writes that bypass it — the generic content CRUD routes on the users collection
   * (`/api/v1/users`) or direct adapter access — do not run the guard (spec 059, known limitations).
   *
   * **Concurrency (spec 059):** any update that sets a non-admin role is one `updateIf()` carrying
   * {@link LAST_ADMIN_GUARD}, so the database decides "is another admin still there?" in the same
   * statement that writes — there is no read-then-write window, no post-write re-check and no
   * compensation, and it holds across independent Workers/processes on D1 and libSQL. The guard is
   * attached whenever the caller *intends* a non-admin role, whatever an earlier read showed, so a stale
   * read cannot skip it. An update that cannot remove admin privilege is an ordinary `update()`.
   *
   * Returns `null` when the user does not exist (including one deleted while this call was in flight).
   *
   * Promoting an existing user (`{ role: 'admin' }`) is a plain update that never consults or touches the
   * bootstrap claim — together with {@link createUser}, the trusted-server recovery for a database whose
   * claim was burned before spec 060 (claim present, no admin).
   */
  async updateUser(id: string, input: Partial<CreateUserInput>): Promise<AuthUser | null> {
    const db = this.getDb();
    const existing = await db.findById(this.collection, id);
    if (!existing) return null;

    if (input.password !== undefined && !meetsPasswordPolicy(input.password, this.passwordPolicy)) {
      throw new UserMutationError('Password does not meet requirements', 'weak-password');
    }

    const updates: DatabaseRecord = {};
    if (input.email !== undefined) updates.email = normalizeEmail(input.email);
    if (input.name !== undefined) updates.name = input.name;
    if (input.role !== undefined) updates.role = input.role;
    if (input.password !== undefined) {
      updates.passwordHash = await hashPassword(input.password);
      // A password change invalidates every session issued before it (spec 058 §6) — see
      // `validateSession`'s comparison against this same field.
      updates._sessionVersion = sessionVersionOf(existing) + 1;
    }

    if (input.role === undefined || input.role === 'admin') {
      return sanitizeUser(await db.update(this.collection, id, updates));
    }

    const result = await db.updateIf(this.collection, id, updates, LAST_ADMIN_GUARD);
    if (result.applied) return sanitizeUser(result.record);

    // Not applied: either the user vanished meanwhile, or the guard refused. Only this re-read can tell
    // them apart; the refusal itself was decided atomically by the database.
    if (!(await db.findById(this.collection, id))) return null;
    throw new UserMutationError('Cannot remove the last remaining admin', 'last-admin');
  }

  /**
   * Deletes a user; rejects (via {@link UserMutationError}) removing the last remaining admin. One
   * `deleteIf()` carrying {@link LAST_ADMIN_GUARD} — see {@link updateUser} for the concurrency
   * guarantee. Deleting a user who does not exist (or was deleted meanwhile) is a no-op; deleting a
   * non-admin is never held back.
   */
  async deleteUser(id: string): Promise<void> {
    const db = this.getDb();
    const result = await db.deleteIf(this.collection, id, LAST_ADMIN_GUARD);
    if (result.applied) return;

    if (await db.findById(this.collection, id)) {
      throw new UserMutationError('Cannot remove the last remaining admin', 'last-admin');
    }
  }
}
