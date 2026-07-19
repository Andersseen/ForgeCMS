import { describe, expect, it, beforeEach } from 'vitest';
import { runAuthAdapterContractTests } from '@forge-cms/testing/contracts';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { UsersCollectionAuthAdapter } from './users-collection.adapter.js';

function createAdapter() {
  const db = new InMemoryDatabaseAdapter();
  return new UsersCollectionAuthAdapter().init({ userDatabase: db });
}

async function createAdapterWithUser(password = 'password123') {
  const db = new InMemoryDatabaseAdapter();
  const adapter = new UsersCollectionAuthAdapter().init({ userDatabase: db });
  await adapter.createUser({ email: 'test@example.com', password, name: 'Test User', role: 'admin' });
  return { adapter, db };
}

// Contract tests need a pre-authenticated request. We create a user and issue a token once.
const contractAdapter = createAdapter();
const contractUser = await contractAdapter.createUser({
  email: 'contract@example.com',
  password: 'contract-pass',
  role: 'admin'
});
const contractToken = contractUser?.token ?? '';

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

  it('logs in with valid credentials', async () => {
    const result = await adapter.login('test@example.com', 'password123');
    expect(result).not.toBeNull();
    expect(result?.user.email).toBe('test@example.com');
    expect(result?.user.role).toBe('admin');
    expect(typeof result?.token).toBe('string');
  });

  it('rejects login with wrong password', async () => {
    const result = await adapter.login('test@example.com', 'wrong-password');
    expect(result).toBeNull();
  });

  it('rejects login for unknown email', async () => {
    const result = await adapter.login('nobody@example.com', 'password123');
    expect(result).toBeNull();
  });

  it('a token issued by login authenticates a later request', async () => {
    const login = await adapter.login('test@example.com', 'password123');
    const request = new Request('https://forge.test', {
      headers: { authorization: `Bearer ${login?.token}` }
    });
    const user = await adapter.requireAuth(request);
    expect(user.email).toBe('test@example.com');
  });

  it('createUser hashes the password and returns a token', async () => {
    const result = await adapter.createUser({
      email: 'new@example.com',
      password: 'secret',
      name: 'New User',
      role: 'editor'
    });
    expect(result).not.toBeNull();
    expect(result?.user.email).toBe('new@example.com');
    expect(result?.user.role).toBe('editor');

    const stored = await db.findById('users', result!.user.id);
    expect(stored).toBeTruthy();
    expect(stored?.passwordHash).toBeTruthy();
    expect(stored?.passwordHash).not.toBe('secret');
  });

  it('createUser returns null for duplicate email', async () => {
    const first = await adapter.createUser({ email: 'dup@example.com', password: 'secret' });
    expect(first).not.toBeNull();
    const second = await adapter.createUser({ email: 'dup@example.com', password: 'other' });
    expect(second).toBeNull();
  });

  it('listUsers excludes passwordHash', async () => {
    await adapter.createUser({ email: 'listed@example.com', password: 'secret' });
    const users = await adapter.listUsers();
    expect(users.length).toBeGreaterThan(0);
    for (const user of users) {
      expect(user).not.toHaveProperty('passwordHash');
    }
  });

  it('updateUser re-hashes password when provided', async () => {
    const created = await adapter.createUser({ email: 'update@example.com', password: 'old' });
    const before = await db.findById('users', created!.user.id);

    const updated = await adapter.updateUser(created!.user.id, { password: 'new' });
    expect(updated).not.toBeNull();

    const after = await db.findById('users', created!.user.id);
    expect(after?.passwordHash).not.toBe(before?.passwordHash);

    const login = await adapter.login('update@example.com', 'new');
    expect(login).not.toBeNull();
  });

  it('updateUser updates non-password fields', async () => {
    const created = await adapter.createUser({
      email: 'rename@example.com',
      password: 'secret',
      name: 'Old'
    });
    const updated = await adapter.updateUser(created!.user.id, { name: 'New', role: 'viewer' });
    expect(updated?.name).toBe('New');
    expect(updated?.role).toBe('viewer');
  });

  it('deleteUser removes the user', async () => {
    const created = await adapter.createUser({ email: 'delete@example.com', password: 'secret' });
    await adapter.deleteUser(created!.user.id);
    const stored = await db.findById('users', created!.user.id);
    expect(stored).toBeNull();
  });
});
