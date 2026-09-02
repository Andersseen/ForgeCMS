import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { UsersCollectionAuthAdapter, defineUsersCollection } from '@forge-cms/auth';
import { D1DatabaseAdapter } from '../../src/d1.adapter.js';

function realDb(): D1DatabaseAdapter {
  return new D1DatabaseAdapter().init(env);
}

/**
 * Browser/human auth (spec 053), proven against a real local D1 binding (Miniflare/workerd, no
 * account/credentials) — not a hand-rolled mock. `defineUsersCollection()`'s generated schema must
 * actually create the `passwordHash` column (`withAuthFields`) and a real unique index on `email`
 * (`unique: true`) for signup/login and the race-safe duplicate-email rejection to work at all; a
 * mocked D1 could pass this suite while a real `CREATE TABLE`/`CREATE UNIQUE INDEX` statement is
 * subtly wrong (column name, quoting, SQLite affinity) and it would only surface in production.
 */
describe('UsersCollectionAuthAdapter — real local D1 binding: signup/login round trip', () => {
  it('syncs a schema with a passwordHash column and a unique email index, then signs up and logs in', async () => {
    const database = realDb();
    await database.syncSchema([defineUsersCollection({ slug: 'human_auth_users' })]);

    const auth = new UsersCollectionAuthAdapter({
      devMode: true,
      collection: 'human_auth_users'
    }).init({
      userDatabase: database
    });

    const signedUp = await auth.signup({ email: 'Admin@Example.com', password: 'password123' });
    if (!signedUp.ok) throw new Error(`expected success, got ${JSON.stringify(signedUp)}`);
    // First user ever in this table → bootstrapped to admin.
    expect(signedUp.user.role).toBe('admin');
    expect(signedUp.user.email).toBe('admin@example.com');

    const login = await auth.login('  ADMIN@example.com  ', 'password123');
    expect(login.ok).toBe(true);

    const request = new Request('https://forge.test', {
      headers: { authorization: `Bearer ${signedUp.token}` }
    });
    const user = await auth.requireAuth(request);
    expect(user.email).toBe('admin@example.com');

    // Same request via the session cookie alone, no Authorization header — proves the cookie-fallback
    // path (spec 053) also works against a real signed token issued from a real D1-backed adapter.
    const cookieRequest = new Request('https://forge.test', {
      headers: { cookie: `forge_session=${signedUp.token}` }
    });
    const cookieUser = await auth.requireAuth(cookieRequest);
    expect(cookieUser.email).toBe('admin@example.com');
  });

  it('rejects a duplicate (normalized) email via the real unique index, not just the in-process pre-check', async () => {
    const database = realDb();
    await database.syncSchema([defineUsersCollection({ slug: 'human_auth_dup_users' })]);
    const auth = new UsersCollectionAuthAdapter({
      devMode: true,
      collection: 'human_auth_dup_users'
    }).init({ userDatabase: database });

    const first = await auth.signup({ email: 'dup@example.com', password: 'password123' });
    expect(first.ok).toBe(true);

    const second = await auth.signup({ email: 'DUP@Example.com', password: 'password456' });
    expect(second).toEqual({ ok: false, reason: 'email-in-use' });
  });

  it('the second signup gets viewer, not admin, once a first user already exists', async () => {
    const database = realDb();
    await database.syncSchema([defineUsersCollection({ slug: 'human_auth_bootstrap_users' })]);
    const auth = new UsersCollectionAuthAdapter({
      devMode: true,
      collection: 'human_auth_bootstrap_users'
    }).init({ userDatabase: database });

    const first = await auth.signup({ email: 'owner@example.com', password: 'password123' });
    if (!first.ok) throw new Error('expected success');
    expect(first.user.role).toBe('admin');

    const second = await auth.signup({ email: 'newcomer@example.com', password: 'password123' });
    if (!second.ok) throw new Error('expected success');
    expect(second.user.role).toBe('viewer');
  });
});
