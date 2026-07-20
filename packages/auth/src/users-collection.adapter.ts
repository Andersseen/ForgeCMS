import type { DatabaseAdapter, DatabaseRecord } from '@forge-cms/db';
import type { AuthAdapter, AuthSession, AuthUser } from './index.js';
import { ForgeAuthError } from './index.js';
import { extractToken, issueToken, validateSession } from './token-signer.js';

export interface UsersCollectionAuthEnv {
  AUTH_SECRET?: string;
  userDatabase?: DatabaseAdapter;
}

export interface CreateUserInput {
  email: string;
  password: string;
  name?: string;
  role?: 'admin' | 'editor' | 'viewer';
}

const DEFAULT_COLLECTION = 'users';
const DEV_SECRET = 'forgecms-dev-only-signing-secret-do-not-use-in-real-deployments';

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

/**
 * Auth adapter backed by a real `users` collection in the configured database.
 * Passwords are hashed with PBKDF2 (Web Crypto) and never stored or returned in plain text.
 */
export class UsersCollectionAuthAdapter implements AuthAdapter {
  readonly name = 'users-collection';
  private secret = DEV_SECRET;
  private db?: DatabaseAdapter;
  private collection = DEFAULT_COLLECTION;

  init(env?: UsersCollectionAuthEnv): this {
    this.secret = env?.AUTH_SECRET ?? DEV_SECRET;
    if (env?.userDatabase !== undefined) {
      this.db = env.userDatabase;
    }
    return this;
  }

  private getDb(): DatabaseAdapter {
    if (!this.db)
      throw new Error('UsersCollectionAuthAdapter not initialized. Call init() with userDatabase.');
    return this.db;
  }

  extractToken(request: Request): string | null {
    return extractToken(request);
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

  async login(email: string, password: string): Promise<{ token: string; user: AuthUser } | null> {
    const db = this.getDb();
    const records = await db.findMany({ collection: this.collection, where: { email } });
    const record = records[0];
    if (!record) return null;

    const storedHash = record.passwordHash as string | undefined;
    if (!storedHash) return null;

    const valid = await verifyPassword(password, storedHash);
    if (!valid) return null;

    const user = sanitizeUser(record);
    const token = await issueToken(this.secret, user);
    return { token, user };
  }

  async createUser(input: CreateUserInput): Promise<{ token: string; user: AuthUser } | null> {
    const db = this.getDb();
    const existing = await db.findMany({
      collection: this.collection,
      where: { email: input.email }
    });
    if (existing.length > 0) return null;

    const passwordHash = await hashPassword(input.password);
    const record = await db.create(this.collection, {
      email: input.email,
      name: input.name ?? '',
      role: input.role ?? 'viewer',
      passwordHash
    });

    const user = sanitizeUser(record);
    const token = await issueToken(this.secret, user);
    return { token, user };
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
    if (input.email !== undefined) updates.email = input.email;
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
