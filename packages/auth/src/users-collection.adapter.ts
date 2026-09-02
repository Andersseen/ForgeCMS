import type { DatabaseAdapter, DatabaseRecord } from '@forge-cms/db';
import { isUniqueConstraintError } from '@forge-cms/db';
import type {
  AuthActionResult,
  AuthAdapter,
  AuthSession,
  AuthUser,
  PublicSignupInput
} from './index.js';
import { ForgeAuthError } from './index.js';
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
  const { passwordHash: _ignored, ...rest } = record;
  void _ignored;
  return rest as unknown as AuthUser;
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
    const token = await issueToken(this.getSecret(), user);
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

    const role = (await this.hasAnyUser(db)) ? (input.role ?? 'viewer') : 'admin';
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
    const token = await issueToken(this.getSecret(), user);
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

    const role = (await this.hasAnyUser(db)) ? 'viewer' : 'admin';
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
    const token = await issueToken(this.getSecret(), user);
    return { ok: true, token, user };
  }

  async listUsers(): Promise<AuthUser[]> {
    const db = this.getDb();
    const records = await db.findMany({ collection: this.collection });
    return records.map(sanitizeUser);
  }

  async updateUser(id: string, input: Partial<CreateUserInput>): Promise<AuthUser | null> {
    const db = this.getDb();
    const existing = await db.findById(this.collection, id);
    if (!existing) return null;

    const updates: DatabaseRecord = {};
    if (input.email !== undefined) updates.email = normalizeEmail(input.email);
    if (input.name !== undefined) updates.name = input.name;
    if (input.role !== undefined) updates.role = input.role;
    if (input.password !== undefined) updates.passwordHash = await hashPassword(input.password);

    const updated = await db.update(this.collection, id, updates);
    return sanitizeUser(updated);
  }

  async deleteUser(id: string): Promise<void> {
    const db = this.getDb();
    await db.delete(this.collection, id);
  }
}
