import type { CollectionDefinition } from '@forge-cms/core';
import { defineField } from '@forge-cms/core';
import type { DatabaseAdapter, DatabaseRecord } from '@forge-cms/db';
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

const DEFAULT_COLLECTION = 'users';
const DEV_SECRET = 'forgecms-dev-only-signing-secret-do-not-use-in-real-deployments';
const DEFAULT_MIN_PASSWORD_LENGTH = 8;
const BOOTSTRAP_COLLECTION = '_forge_bootstrap';
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
   * Registers `_forge_bootstrap` on first use so {@link claimFirstAdminBootstrap} works even for a
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
   * Atomically claims the "first admin" bootstrap slot using the database's own unique-index
   * enforcement as a compare-and-swap primitive: of any number of concurrent callers, `create()`
   * with the same `slot` value can only ever succeed once — every adapter (InMemory/libSQL/D1)
   * already enforces field-level `unique: true` (proven by spec 046's constraint contract suite), so
   * every other racing caller observes `UniqueConstraintError` and safely loses the race, permanently
   * (the marker row is never deleted). This closes "two concurrent first signups both become admin"
   * without a new `DatabaseAdapter` contract method (spec 058 §7a).
   *
   * The slot is keyed by `this.collection`, not a single fixed value: `_forge_bootstrap` is one
   * table shared by every `UsersCollectionAuthAdapter` instance pointed at the same database, and
   * more than one can legitimately coexist there (the `collection` constructor option exists
   * precisely so a consumer can target a renamed/second `users`-like collection) — each one's "first
   * admin" is a property of *its own* users table, not of the database as a whole.
   */
  private async claimFirstAdminBootstrap(db: DatabaseAdapter): Promise<boolean> {
    await this.ensureBootstrapSchema(db);
    try {
      await db.create(BOOTSTRAP_COLLECTION, { slot: this.collection });
      return true;
    } catch (err) {
      if (isUniqueConstraintError(err)) return false;
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
   * never end up with a non-admin as its only user.
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

    // Bootstrap race fix (spec 058 §7a): `hasAnyUser()` alone is check-then-act — two concurrent
    // `createUser`/`signup` calls could both observe "no users yet" and both be granted `admin`. The
    // atomic claim is the actual tie-breaker; `hasAnyUser()` remains a fast-path guard that skips the
    // extra write once bootstrap is long over.
    const role = (await this.hasAnyUser(db))
      ? (input.role ?? 'viewer')
      : (await this.claimFirstAdminBootstrap(db))
        ? 'admin'
        : (input.role ?? 'viewer');
    const passwordHash = await hashPassword(input.password);

    let record: DatabaseRecord;
    try {
      record = await db.create(this.collection, {
        email,
        name: input.name ?? '',
        role,
        passwordHash
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) return { ok: false, reason: 'email-in-use' };
      throw err;
    }

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

    // See the matching comment in `createUser` — same atomic-claim fix for the same race, reachable
    // here through a *public* endpoint, which is exactly what makes this one security-sensitive.
    const role = (await this.hasAnyUser(db))
      ? 'viewer'
      : (await this.claimFirstAdminBootstrap(db))
        ? 'admin'
        : 'viewer';
    const passwordHash = await hashPassword(input.password);

    let record: DatabaseRecord;
    try {
      record = await db.create(this.collection, {
        email,
        name: input.name ?? '',
        role,
        passwordHash
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) return { ok: false, reason: 'email-in-use' };
      throw err;
    }

    const user = sanitizeUser(record);
    const token = await issueToken(this.getSecret(), user, sessionVersionOf(record));
    return { ok: true, token, user };
  }

  async listUsers(): Promise<AuthUser[]> {
    const db = this.getDb();
    const records = await db.findMany({ collection: this.collection });
    return records.map(sanitizeUser);
  }

  /** How many `role: 'admin'` rows exist — the last-admin invariant below is keyed on this. */
  private async countAdmins(db: DatabaseAdapter): Promise<number> {
    const admins = await db.findMany({ collection: this.collection, where: { role: 'admin' } });
    return admins.length;
  }

  /**
   * Updates a user. Rejects (via {@link UserMutationError}) rather than writing when the change would:
   * - set a password shorter than the configured policy, or
   * - change the sole remaining admin's `role` away from `'admin'`.
   *
   * The second check, combined with {@link deleteUser}'s identical guard, is the whole last-admin
   * invariant: an installation can never end up with zero usable administrators, however the change is
   * attempted (self-demote, demoted by another admin, self-delete, deleted by another admin).
   *
   * **Concurrency (spec 058 §7b, explicit limitation):** the pre-write `countAdmins()` check above is
   * check-then-act, and the current `DatabaseAdapter` contract has no conditional/compare-and-swap
   * write to make it atomic (no SQL-expression `WHERE`, no cross-adapter transaction). A **post-write
   * re-verification with best-effort compensation** below closes the common case — two concurrent
   * last-admin removals whose pre-checks both ran before either write landed — by reverting the role
   * change and re-raising the same error if the count reads zero immediately afterward. This narrows,
   * but does not eliminate, the race: if both operations' *post-write* rechecks also each run before
   * the other's write becomes visible, both can still observe "still fine" and the invariant can still
   * be violated. A genuine fix needs a conditional-write primitive across all three adapters (the
   * H01 packet in `docs/roadmap/v1/0.6-auth-data-integrity.md`) — out of scope for this hardening pass;
   * this is a bounded, honestly-documented mitigation, not a claim of atomicity.
   */
  async updateUser(id: string, input: Partial<CreateUserInput>): Promise<AuthUser | null> {
    const db = this.getDb();
    const existing = await db.findById(this.collection, id);
    if (!existing) return null;

    if (input.password !== undefined && !meetsPasswordPolicy(input.password, this.passwordPolicy)) {
      throw new UserMutationError('Password does not meet requirements', 'weak-password');
    }
    const demotesLastAdmin =
      input.role !== undefined && input.role !== 'admin' && existing.role === 'admin';
    if (demotesLastAdmin && (await this.countAdmins(db)) <= 1) {
      throw new UserMutationError('Cannot remove the last remaining admin', 'last-admin');
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

    const updated = await db.update(this.collection, id, updates);

    if (demotesLastAdmin && (await this.countAdmins(db)) === 0) {
      // Compensate: best-effort revert. See this method's doc comment for the residual race window.
      await db.update(this.collection, id, { role: 'admin' }).catch(() => undefined);
      throw new UserMutationError('Cannot remove the last remaining admin', 'last-admin');
    }

    return sanitizeUser(updated);
  }

  /**
   * Rejects (via {@link UserMutationError}) deleting the sole remaining admin — see {@link updateUser}
   * for the invariant and its documented, bounded (non-atomic) concurrency mitigation.
   */
  async deleteUser(id: string): Promise<void> {
    const db = this.getDb();
    const existing = await db.findById(this.collection, id);
    if (!existing) return;

    const deletesLastAdmin = existing.role === 'admin';
    if (deletesLastAdmin && (await this.countAdmins(db)) <= 1) {
      throw new UserMutationError('Cannot remove the last remaining admin', 'last-admin');
    }

    await db.delete(this.collection, id);

    if (deletesLastAdmin && (await this.countAdmins(db)) === 0) {
      // Compensate: best-effort restore. Re-creating with the same id/fields is not a perfect
      // rollback (e.g. `created_at`/`updated_at` will not exactly match the original row), but it
      // keeps the installation from ending up with zero admins in the common race case. If the
      // compensating create itself fails (e.g. the id was reused in the meantime), the installation
      // may be left with zero admins — an explicit, documented residual risk of the current
      // non-transactional adapter contract (see `updateUser`'s doc comment).
      try {
        await db.create(this.collection, { ...existing });
      } catch {
        // Best-effort only — see comment above.
      }
      throw new UserMutationError('Cannot remove the last remaining admin', 'last-admin');
    }
  }
}
