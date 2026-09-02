import { describe, expect, it, beforeEach } from 'vitest';
import { runAuthAdapterContractTests } from '@forge-cms/testing/contracts';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { defineUsersCollection } from './user-fields.js';
import { UsersCollectionAuthAdapter } from './users-collection.adapter.js';

function createAdapter() {
  const db = new InMemoryDatabaseAdapter();
  return new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: db });
}

async function createAdapterWithUser(password = 'password123') {
  const db = new InMemoryDatabaseAdapter();
  const adapter = new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: db });
  await adapter.createUser({
    email: 'test@example.com',
    password,
    name: 'Test User',
    role: 'admin'
  });
  return { adapter, db };
}

const contractAdapter = createAdapter();
const contractUser = await contractAdapter.createUser({
  email: 'contract@example.com',
  password: 'contract-pass',
  role: 'admin'
});
const contractToken = contractUser.ok ? contractUser.token : '';

runAuthAdapterContractTests(
  () => createAdapter(),
  () =>
    new Request('https://forge.test', {
      headers: { authorization: `Bearer ${contractToken}` }
    })
);

describe('UsersCollectionAuthAdapter', () => {
  let adapter: UsersCollectionAuthAdapter;
  let db: InMemoryDatabaseAdapter;

  beforeEach(async () => {
    const created = await createAdapterWithUser();
    adapter = created.adapter;
    db = created.db;
  });

  it('init() throws without AUTH_SECRET or devMode', () => {
    const db = new InMemoryDatabaseAdapter();
    expect(() => new UsersCollectionAuthAdapter().init({ userDatabase: db })).toThrow(
      'UsersCollectionAuthAdapter requires AUTH_SECRET to be set'
    );
  });

  it('init() succeeds with devMode', () => {
    const db = new InMemoryDatabaseAdapter();
    expect(() =>
      new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: db })
    ).not.toThrow();
  });

  it('init() succeeds with AUTH_SECRET', () => {
    const db = new InMemoryDatabaseAdapter();
    expect(() =>
      new UsersCollectionAuthAdapter().init({ AUTH_SECRET: 'test-secret', userDatabase: db })
    ).not.toThrow();
  });

  it('logs in with valid credentials', async () => {
    const result = await adapter.login('test@example.com', 'password123');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.user.email).toBe('test@example.com');
    expect(result.user.role).toBe('admin');
    expect(typeof result.token).toBe('string');
  });

  it('login normalizes email case and whitespace', async () => {
    const result = await adapter.login('  Test@Example.com ', 'password123');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.user.email).toBe('test@example.com');
  });

  it('rejects login with wrong password', async () => {
    const result = await adapter.login('test@example.com', 'wrong-password');
    expect(result).toEqual({ ok: false, reason: 'invalid-credentials' });
  });

  it('rejects login for unknown email', async () => {
    const result = await adapter.login('nobody@example.com', 'password123');
    expect(result).toEqual({ ok: false, reason: 'invalid-credentials' });
  });

  it('a token issued by login authenticates a later request', async () => {
    const login = await adapter.login('test@example.com', 'password123');
    if (!login.ok) throw new Error('expected success');
    const request = new Request('https://forge.test', {
      headers: { authorization: `Bearer ${login.token}` }
    });
    const user = await adapter.requireAuth(request);
    expect(user.email).toBe('test@example.com');
  });

  it('a session cookie alone (no Authorization header) authenticates a request', async () => {
    const login = await adapter.login('test@example.com', 'password123');
    if (!login.ok) throw new Error('expected success');
    const request = new Request('https://forge.test', {
      headers: { cookie: `forge_session=${login.token}` }
    });
    const user = await adapter.requireAuth(request);
    expect(user.email).toBe('test@example.com');
  });

  it('createUser hashes the password and returns a token', async () => {
    const result = await adapter.createUser({
      email: 'new@example.com',
      password: 'secret123',
      name: 'New User',
      role: 'editor'
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.user.email).toBe('new@example.com');
    expect(result.user.role).toBe('editor');

    const stored = await db.findById('users', result.user.id);
    expect(stored).toBeTruthy();
    expect(stored?.passwordHash).toBeTruthy();
    expect(stored?.passwordHash).not.toBe('secret123');
  });

  it('createUser normalizes email to lowercase before storing', async () => {
    const result = await adapter.createUser({ email: 'Mixed@Example.COM', password: 'secret123' });
    if (!result.ok) throw new Error('expected success');
    expect(result.user.email).toBe('mixed@example.com');
  });

  it('createUser rejects an invalid email format', async () => {
    const result = await adapter.createUser({ email: 'not-an-email', password: 'secret123' });
    expect(result).toEqual({ ok: false, reason: 'invalid-email' });
  });

  it('createUser rejects a password under the minimum length', async () => {
    const result = await adapter.createUser({ email: 'short@example.com', password: 'short' });
    expect(result).toEqual({ ok: false, reason: 'weak-password' });
  });

  it('a custom password policy minLength is enforced', async () => {
    const db = new InMemoryDatabaseAdapter();
    const strict = new UsersCollectionAuthAdapter({
      devMode: true,
      passwordPolicy: { minLength: 12 }
    }).init({ userDatabase: db });

    const tooShort = await strict.createUser({ email: 'a@example.com', password: 'tenchars12' });
    expect(tooShort).toEqual({ ok: false, reason: 'weak-password' });

    const longEnough = await strict.createUser({
      email: 'b@example.com',
      password: 'twelvecharsss'
    });
    expect(longEnough.ok).toBe(true);
  });

  it('createUser returns email-in-use for a duplicate (normalized) email', async () => {
    const first = await adapter.createUser({ email: 'dup@example.com', password: 'secret123' });
    expect(first.ok).toBe(true);
    const second = await adapter.createUser({ email: 'DUP@Example.com', password: 'other1234' });
    expect(second).toEqual({ ok: false, reason: 'email-in-use' });
  });

  it('createUser is race-safe against a duplicate email when the collection has a unique index', async () => {
    const raceDb = new InMemoryDatabaseAdapter();
    await raceDb.syncSchema([defineUsersCollection()]);
    const raceAdapter = new UsersCollectionAuthAdapter({ devMode: true }).init({
      userDatabase: raceDb
    });

    const [first, second] = await Promise.all([
      raceAdapter.createUser({ email: 'race@example.com', password: 'secret123' }),
      raceAdapter.createUser({ email: 'race@example.com', password: 'secret456' })
    ]);

    const results = [first, second];
    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toEqual({ ok: false, reason: 'email-in-use' });
  });

  it('the first user ever created becomes admin regardless of requested role', async () => {
    const db = new InMemoryDatabaseAdapter();
    const fresh = new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: db });

    const first = await fresh.createUser({
      email: 'first@example.com',
      password: 'secret123',
      role: 'viewer'
    });
    if (!first.ok) throw new Error('expected success');
    expect(first.user.role).toBe('admin');

    const second = await fresh.createUser({
      email: 'second@example.com',
      password: 'secret123',
      role: 'viewer'
    });
    if (!second.ok) throw new Error('expected success');
    expect(second.user.role).toBe('viewer');
  });

  it('signup rejects an invalid email format', async () => {
    const result = await adapter.signup({ email: 'not-an-email', password: 'secret123' });
    expect(result).toEqual({ ok: false, reason: 'invalid-email' });
  });

  it('signup rejects a weak password', async () => {
    const result = await adapter.signup({ email: 'weak@example.com', password: 'short' });
    expect(result).toEqual({ ok: false, reason: 'weak-password' });
  });

  it('signup rejects a duplicate (normalized) email', async () => {
    const result = await adapter.signup({ email: 'TEST@example.com', password: 'secret123' });
    expect(result).toEqual({ ok: false, reason: 'email-in-use' });
  });

  it('signup always assigns viewer once an admin already exists', async () => {
    // `adapter` already has one admin from `createAdapterWithUser()`.
    const result = await adapter.signup({ email: 'signup@example.com', password: 'secret123' });
    if (!result.ok) throw new Error('expected success');
    expect(result.user.role).toBe('viewer');
  });

  it('the first signup ever becomes admin (bootstrap), same rule as createUser', async () => {
    const db = new InMemoryDatabaseAdapter();
    const fresh = new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: db });

    const result = await fresh.signup({ email: 'bootstrap@example.com', password: 'secret123' });
    if (!result.ok) throw new Error('expected success');
    expect(result.user.role).toBe('admin');
  });

  it("signup's input type carries no role field to escalate", async () => {
    // A structural guarantee, not just a runtime one: PublicSignupInput has no `role` key, so even a
    // caller that received an untyped/`any` body and forwarded it can only pass email/password/name.
    const maliciousBody = { email: 'escalate@example.com', password: 'secret123', role: 'admin' };
    const result = await adapter.signup({
      email: maliciousBody.email,
      password: maliciousBody.password
    });
    if (!result.ok) throw new Error('expected success');
    expect(result.user.role).toBe('viewer');
  });

  it('listUsers excludes passwordHash', async () => {
    await adapter.createUser({ email: 'listed@example.com', password: 'secret123' });
    const users = await adapter.listUsers();
    expect(users.length).toBeGreaterThan(0);
    for (const user of users) {
      expect(user).not.toHaveProperty('passwordHash');
    }
  });

  it('updateUser re-hashes password when provided', async () => {
    const created = await adapter.createUser({ email: 'update@example.com', password: 'oldpass1' });
    if (!created.ok) throw new Error('expected success');
    const before = await db.findById('users', created.user.id);

    const updated = await adapter.updateUser(created.user.id, { password: 'newpass1' });
    expect(updated).not.toBeNull();

    const after = await db.findById('users', created.user.id);
    expect(after?.passwordHash).not.toBe(before?.passwordHash);

    const login = await adapter.login('update@example.com', 'newpass1');
    expect(login.ok).toBe(true);
  });

  it('updateUser normalizes an updated email', async () => {
    const created = await adapter.createUser({
      email: 'rename2@example.com',
      password: 'secret123'
    });
    if (!created.ok) throw new Error('expected success');
    const updated = await adapter.updateUser(created.user.id, { email: 'Renamed@Example.COM' });
    expect(updated?.email).toBe('renamed@example.com');
  });

  it('updateUser updates non-password fields', async () => {
    const created = await adapter.createUser({
      email: 'rename@example.com',
      password: 'secret123',
      name: 'Old'
    });
    if (!created.ok) throw new Error('expected success');
    const updated = await adapter.updateUser(created.user.id, { name: 'New', role: 'viewer' });
    expect(updated?.name).toBe('New');
    expect(updated?.role).toBe('viewer');
  });

  it('deleteUser removes the user', async () => {
    const created = await adapter.createUser({
      email: 'delete@example.com',
      password: 'secret123'
    });
    if (!created.ok) throw new Error('expected success');
    await adapter.deleteUser(created.user.id);
    const stored = await db.findById('users', created.user.id);
    expect(stored).toBeNull();
  });

  it('requireRole allows matching role', async () => {
    const login = await adapter.login('test@example.com', 'password123');
    if (!login.ok) throw new Error('expected success');
    const request = new Request('https://forge.test', {
      headers: { authorization: `Bearer ${login.token}` }
    });
    const user = await adapter.requireRole(request, 'admin');
    expect(user.email).toBe('test@example.com');
  });

  it('requireRole rejects insufficient role', async () => {
    const created = await adapter.createUser({
      email: 'viewer@example.com',
      password: 'secret123',
      role: 'viewer'
    });
    if (!created.ok) throw new Error('expected success');
    const request = new Request('https://forge.test', {
      headers: { authorization: `Bearer ${created.token}` }
    });
    await expect(adapter.requireRole(request, 'admin')).rejects.toThrow('Forbidden');
  });

  it('requireAnyRole allows one matching role', async () => {
    const created = await adapter.createUser({
      email: 'editor@example.com',
      password: 'secret123',
      role: 'editor'
    });
    if (!created.ok) throw new Error('expected success');
    const request = new Request('https://forge.test', {
      headers: { authorization: `Bearer ${created.token}` }
    });
    const user = await adapter.requireAnyRole(request, ['admin', 'editor']);
    expect(user.role).toBe('editor');
  });

  it('requireAnyRole rejects non-matching role', async () => {
    const created = await adapter.createUser({
      email: 'viewer2@example.com',
      password: 'secret123',
      role: 'viewer'
    });
    if (!created.ok) throw new Error('expected success');
    const request = new Request('https://forge.test', {
      headers: { authorization: `Bearer ${created.token}` }
    });
    await expect(adapter.requireAnyRole(request, ['admin', 'editor'])).rejects.toThrow('Forbidden');
  });
});
