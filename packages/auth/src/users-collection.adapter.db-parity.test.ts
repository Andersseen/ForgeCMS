import { describe, expect, it } from 'vitest';
import { InMemoryDatabaseAdapter, LibSqlDatabaseAdapter } from '@forge-cms/db';
import type { DatabaseAdapter } from '@forge-cms/db';
import { defineUsersCollection } from './user-fields.js';
import { UsersCollectionAuthAdapter } from './users-collection.adapter.js';

/**
 * Browser/human auth is backed by `DatabaseAdapter`, and must behave identically on every adapter —
 * in particular the unique-email index `defineUsersCollection()` declares, which is what makes signup
 * race-safe against a duplicate email (spec 053). Mirrors `api-key.adapter.db-parity.test.ts`'s
 * pattern: the same behavioral assertions against each adapter constructor (InMemory, libSQL — D1
 * parity lives in `@forge-cms/cloudflare`'s `test/workers/human-auth.test.ts`).
 */
const adapters: [string, () => DatabaseAdapter][] = [
  ['InMemoryDatabaseAdapter', () => new InMemoryDatabaseAdapter()],
  ['LibSqlDatabaseAdapter', () => new LibSqlDatabaseAdapter('file::memory:').init()]
];

describe.each(adapters)('UsersCollectionAuthAdapter on %s (adapter parity)', (_name, createDb) => {
  it('the first signup becomes admin, the second becomes viewer', async () => {
    const db = createDb();
    await db.syncSchema([defineUsersCollection()]);
    const auth = new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: db });

    const first = await auth.signup({ email: 'first@example.com', password: 'password123' });
    if (!first.ok) throw new Error('expected success');
    expect(first.user.role).toBe('admin');

    const second = await auth.signup({ email: 'second@example.com', password: 'password123' });
    if (!second.ok) throw new Error('expected success');
    expect(second.user.role).toBe('viewer');
  });

  it('stores the normalized (lowercased) email and round-trips login', async () => {
    const db = createDb();
    await db.syncSchema([defineUsersCollection()]);
    const auth = new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: db });

    const created = await auth.createUser({ email: 'Mixed@Example.COM', password: 'password123' });
    if (!created.ok) throw new Error('expected success');
    expect(created.user.email).toBe('mixed@example.com');

    const login = await auth.login('  MIXED@example.com  ', 'password123');
    expect(login.ok).toBe(true);
  });

  it('the password hash is never the plaintext password and never leaks through listUsers', async () => {
    const db = createDb();
    await db.syncSchema([defineUsersCollection()]);
    const auth = new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: db });

    const created = await auth.createUser({ email: 'hash@example.com', password: 'password123' });
    if (!created.ok) throw new Error('expected success');

    const stored = await db.findById('users', created.user.id);
    expect(stored?.passwordHash).toBeTruthy();
    expect(stored?.passwordHash).not.toBe('password123');

    const users = await auth.listUsers();
    for (const user of users) {
      expect(user).not.toHaveProperty('passwordHash');
    }
  });

  it('is race-safe against a duplicate (normalized) email under the unique index', async () => {
    const db = createDb();
    await db.syncSchema([defineUsersCollection()]);
    const auth = new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: db });

    const [first, second] = await Promise.all([
      auth.signup({ email: 'race@example.com', password: 'password123' }),
      auth.signup({ email: 'RACE@example.com', password: 'password456' })
    ]);

    const results = [first, second];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: 'email-in-use' }]);
  });

  it('sharing the same adapter instance as the main runtime does not break consumer collections', async () => {
    const db = createDb();
    await db.syncSchema([defineUsersCollection()]);
    await db.create('users', {
      email: 'seed@example.com',
      name: '',
      role: 'admin',
      passwordHash: 'irrelevant-for-this-test'
    });

    const auth = new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: db });
    // UsersCollectionAuthAdapter has no syncSchema() of its own — its storage need is the `users`
    // collection itself, already synced above — but re-syncing the same collection set (as
    // `ForgeCmsRuntime.syncSchema()` does on every call) must stay a safe, idempotent upsert.
    await db.syncSchema([defineUsersCollection()]);

    await expect(db.findMany({ collection: 'users' })).resolves.toHaveLength(1);
    const created = await auth.createUser({
      email: 'after-resync@example.com',
      password: 'password123'
    });
    expect(created.ok).toBe(true);
    await expect(db.findMany({ collection: 'users' })).resolves.toHaveLength(2);
  });
});
