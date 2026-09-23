import { describe, expect, it, beforeEach } from 'vitest';
import {
  runAuthAdapterContractTests,
  runFirstAdminBootstrapContractTests,
  runLastAdminConcurrencyContractTests
} from '@forge-cms/testing/contracts';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { UserMutationError } from './index.js';
import { defineUsersCollection } from './user-fields.js';
import { UsersCollectionAuthAdapter } from './users-collection.adapter.js';

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

// Spec 058 §6: `validateSession` now re-reads the user row from the database (session freshness), so
// the contract-test factory must hand every adapter instance the *same* backing database the token's
// user was actually created in — a fresh, empty database per instance (the previous shape here) would
// make every session look like "the user was deleted", which is exactly the bug this closes, not a
// contract-test artifact to route around.
const contractDb = new InMemoryDatabaseAdapter();
const contractAdapter = new UsersCollectionAuthAdapter({ devMode: true }).init({
  userDatabase: contractDb
});
const contractUser = await contractAdapter.createUser({
  email: 'contract@example.com',
  password: 'contract-pass',
  role: 'admin'
});
const contractToken = contractUser.ok ? contractUser.token : '';

runAuthAdapterContractTests(
  () => new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: contractDb }),
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

  describe('last-admin invariant (spec 054)', () => {
    it('updateUser rejects a password under the policy with UserMutationError(weak-password)', async () => {
      const created = await adapter.createUser({
        email: 'weak@example.com',
        password: 'secret123'
      });
      if (!created.ok) throw new Error('expected success');
      const before = await db.findById('users', created.user.id);

      await expect(adapter.updateUser(created.user.id, { password: 'short' })).rejects.toThrow(
        UserMutationError
      );
      const after = await db.findById('users', created.user.id);
      expect(after?.passwordHash).toBe(before?.passwordHash);
    });

    it('rejects the sole admin demoting themselves', async () => {
      // `adapter` from beforeEach has exactly one user, the admin created by createAdapterWithUser().
      const admin = await adapter.login('test@example.com', 'password123');
      if (!admin.ok) throw new Error('expected success');

      await expect(adapter.updateUser(admin.user.id, { role: 'viewer' })).rejects.toThrow(
        UserMutationError
      );
      const stored = await db.findById('users', admin.user.id);
      expect(stored?.role).toBe('admin');
    });

    it('rejects the sole admin being demoted by another admin', async () => {
      const admin = await adapter.login('test@example.com', 'password123');
      if (!admin.ok) throw new Error('expected success');
      // A second admin is promoted, then demotes themselves back to editor first, leaving `admin`
      // (the original account) as the sole remaining admin once more before the real assertion.
      const second = await adapter.createUser({
        email: 'second-admin@example.com',
        password: 'secret123',
        role: 'admin'
      });
      if (!second.ok) throw new Error('expected success');
      await adapter.updateUser(second.user.id, { role: 'viewer' });

      await expect(adapter.updateUser(admin.user.id, { role: 'viewer' })).rejects.toThrow(
        UserMutationError
      );
    });

    it('allows demoting an admin when a second admin exists', async () => {
      const admin = await adapter.login('test@example.com', 'password123');
      if (!admin.ok) throw new Error('expected success');
      const second = await adapter.createUser({
        email: 'second-admin2@example.com',
        password: 'secret123',
        role: 'admin'
      });
      if (!second.ok) throw new Error('expected success');

      const updated = await adapter.updateUser(admin.user.id, { role: 'editor' });
      expect(updated?.role).toBe('editor');
    });

    it('rejects the sole admin deleting themselves', async () => {
      const admin = await adapter.login('test@example.com', 'password123');
      if (!admin.ok) throw new Error('expected success');

      await expect(adapter.deleteUser(admin.user.id)).rejects.toThrow(UserMutationError);
      const stored = await db.findById('users', admin.user.id);
      expect(stored).toBeTruthy();
    });

    it('rejects the sole admin being deleted by another admin', async () => {
      const admin = await adapter.login('test@example.com', 'password123');
      if (!admin.ok) throw new Error('expected success');
      const second = await adapter.createUser({
        email: 'second-admin3@example.com',
        password: 'secret123',
        role: 'admin'
      });
      if (!second.ok) throw new Error('expected success');
      // Demote the second admin back down so `admin` is again the sole admin.
      await adapter.updateUser(second.user.id, { role: 'viewer' });

      await expect(adapter.deleteUser(admin.user.id)).rejects.toThrow(UserMutationError);
    });

    it('allows deleting an admin when a second admin exists', async () => {
      const admin = await adapter.login('test@example.com', 'password123');
      if (!admin.ok) throw new Error('expected success');
      const second = await adapter.createUser({
        email: 'second-admin4@example.com',
        password: 'secret123',
        role: 'admin'
      });
      if (!second.ok) throw new Error('expected success');

      await expect(adapter.deleteUser(admin.user.id)).resolves.toBeUndefined();
      expect(await db.findById('users', admin.user.id)).toBeNull();
    });

    it('never blocks deleting/demoting a non-admin, even when they are the only user of that role', async () => {
      const viewer = await adapter.createUser({
        email: 'lone-viewer@example.com',
        password: 'secret123',
        role: 'viewer'
      });
      if (!viewer.ok) throw new Error('expected success');

      await expect(adapter.updateUser(viewer.user.id, { role: 'editor' })).resolves.not.toBeNull();
      await expect(adapter.deleteUser(viewer.user.id)).resolves.toBeUndefined();
    });
  });
});

// Spec 058 §6: a signed token embeds role/email/name at login time; `validateSession` must not keep
// trusting that stale snapshot for its whole 24h TTL once the underlying row changes.
describe('Session freshness (spec 058 §6)', () => {
  it('reflects a role change on the very next validateSession call, without re-login', async () => {
    const { adapter } = await createAdapterWithUser();
    const admin = await adapter.login('test@example.com', 'password123');
    if (!admin.ok) throw new Error('expected success');

    // A second admin so demoting the first does not hit the last-admin guard.
    const second = await adapter.createUser({
      email: 'second@example.com',
      password: 'secret123',
      role: 'admin'
    });
    if (!second.ok) throw new Error('expected success');
    await adapter.updateUser(admin.user.id, { role: 'viewer' });

    const session = await adapter.validateSession(admin.token);
    expect(session?.user.role).toBe('viewer');
  });

  it('invalidates the session of a user who has since been deleted', async () => {
    const { adapter } = await createAdapterWithUser();
    const second = await adapter.createUser({
      email: 'second@example.com',
      password: 'secret123',
      role: 'admin'
    });
    if (!second.ok) throw new Error('expected success');
    const victim = await adapter.login('test@example.com', 'password123');
    if (!victim.ok) throw new Error('expected success');

    await adapter.deleteUser(victim.user.id);

    expect(await adapter.validateSession(victim.token)).toBeNull();
  });

  it('invalidates every session issued before a password change', async () => {
    const { adapter } = await createAdapterWithUser();
    const before = await adapter.login('test@example.com', 'password123');
    if (!before.ok) throw new Error('expected success');

    await adapter.updateUser(before.user.id, { password: 'brand-new-password-1' });

    expect(await adapter.validateSession(before.token)).toBeNull();

    const after = await adapter.login('test@example.com', 'brand-new-password-1');
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(await adapter.validateSession(after.token)).toBeTruthy();
    }
  });

  it("does not invalidate a different user's session when one user changes their password", async () => {
    const { adapter } = await createAdapterWithUser();
    const admin = await adapter.login('test@example.com', 'password123');
    if (!admin.ok) throw new Error('expected success');
    const second = await adapter.createUser({
      email: 'second@example.com',
      password: 'secret123',
      role: 'viewer'
    });
    if (!second.ok) throw new Error('expected success');
    const secondSession = await adapter.login('second@example.com', 'secret123');
    if (!secondSession.ok) throw new Error('expected success');

    await adapter.updateUser(admin.user.id, { password: 'new-admin-password-1' });

    expect(await adapter.validateSession(secondSession.token)).toBeTruthy();
  });

  it('propagates a database failure during session validation instead of returning null', async () => {
    const db = new InMemoryDatabaseAdapter();
    const adapter = new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: db });
    const created = await adapter.createUser({
      email: 'x@example.com',
      password: 'secret123',
      role: 'admin'
    });
    if (!created.ok) throw new Error('expected success');

    db.findById = (async () => {
      throw new Error('simulated db outage');
    }) as typeof db.findById;

    await expect(adapter.validateSession(created.token)).rejects.toThrow('simulated db outage');
  });
});

// Spec 058 §7a closed the first-admin bootstrap race atomically with a unique-index claim. The
// last-admin race (§7b) was only mitigated there; spec 059 closes it with a conditional write — its
// deterministic two-writer proof lives in `runLastAdminConcurrencyContractTests` (run below for
// InMemory, and for real libSQL/D1 in `db-parity`/`human-auth`).
describe('Auth concurrency (spec 058 §7a)', () => {
  it('two concurrent first signups never both become admin (deterministic interleaving)', async () => {
    const db = new InMemoryDatabaseAdapter();
    const adapter = new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: db });
    await adapter.syncSchema();

    let hasAnyUserCalls = 0;
    let releaseFirst = () => {};
    const firstWaiting = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const originalFindMany = db.findMany.bind(db);
    db.findMany = (async (opts: Parameters<typeof originalFindMany>[0]) => {
      if (opts.collection === 'users' && opts.limit === 1 && !opts.where) {
        hasAnyUserCalls++;
        if (hasAnyUserCalls === 1) {
          await firstWaiting;
        } else if (hasAnyUserCalls === 2) {
          releaseFirst();
        }
      }
      return originalFindMany(opts);
    }) as typeof db.findMany;

    const [a, b] = await Promise.all([
      adapter.signup({ email: 'racer-a@example.com', password: 'secret123' }),
      adapter.signup({ email: 'racer-b@example.com', password: 'secret123' })
    ]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    const roles = [a, b].map((r) => (r.ok ? r.user.role : undefined));
    expect(roles.filter((role) => role === 'admin')).toHaveLength(1);
    expect(roles.filter((role) => role === 'viewer')).toHaveLength(1);
  });
});

// Spec 059: the last-admin invariant is decided by the database inside one conditional write.
// InMemory shares a single adapter instance between the parties (a separate `InMemoryDatabaseAdapter`
// would be a separate store); the parties still have their own `UsersCollectionAuthAdapter`.
runLastAdminConcurrencyContractTests(async ({ collection, parties, gate }) => {
  const database = new InMemoryDatabaseAdapter();
  await database.syncSchema([defineUsersCollection({ slug: collection })]);

  const contenderFor = async (slug: string) => {
    await database.syncSchema([defineUsersCollection({ slug })]);
    const gated = gate.wrap(database);
    const users = new UsersCollectionAuthAdapter({ devMode: true, collection: slug }).init({
      userDatabase: gated
    });
    return { users, database: gated };
  };

  return {
    contenders: await Promise.all(Array.from({ length: parties }, () => contenderFor(collection))),
    contenderFor
  };
});

// Spec 060: first-admin provisioning is one atomic write. InMemory shares a single adapter instance
// between the parties (a second `InMemoryDatabaseAdapter` would be a second store); each still has its
// own `UsersCollectionAuthAdapter`. The real-backend runs are in `db-parity` (independent libSQL clients)
// and `@forge-cms/cloudflare`'s `first-admin-bootstrap` (real D1).
runFirstAdminBootstrapContractTests(async ({ collection, parties, wrap }) => {
  const database = new InMemoryDatabaseAdapter();
  await database.syncSchema([defineUsersCollection({ slug: collection })]);

  return {
    contenders: Array.from({ length: parties }, () => ({
      users: new UsersCollectionAuthAdapter({ devMode: true, collection }).init({
        userDatabase: wrap(database)
      }),
      database
    }))
  };
});

describe('conditional-write capability (spec 059)', () => {
  it('refuses, at init, a database that cannot make the last-admin invariant atomic', () => {
    const legacy = { name: 'legacy-db' } as unknown as InMemoryDatabaseAdapter;

    expect(() =>
      new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: legacy })
    ).toThrow(/updateIf\(\), deleteIf\(\) and atomicWrite\(\).*'legacy-db' does not/s);
  });

  it('refuses, at init, a database that has conditional writes but no atomicWrite (spec 060)', () => {
    const half = {
      name: 'half-db',
      updateIf: () => Promise.resolve({ applied: false }),
      deleteIf: () => Promise.resolve({ applied: false })
    } as unknown as InMemoryDatabaseAdapter;

    expect(() =>
      new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: half })
    ).toThrow(/atomicWrite\(\).*'half-db' does not/s);
  });

  it('a user deleted while a demotion is in flight reads as not-found, not as a last-admin refusal', async () => {
    const { adapter, db } = await createAdapterWithUser();
    const second = await adapter.createUser({
      email: 'second@example.com',
      password: 'secret123',
      role: 'admin'
    });
    if (!second.ok) throw new Error('expected success');

    await db.delete('users', second.user.id);
    await expect(adapter.updateUser(second.user.id, { role: 'viewer' })).resolves.toBeNull();
    await expect(adapter.deleteUser(second.user.id)).resolves.toBeUndefined();
  });

  it('updateUser and deleteUser reach the database only through the guarded conditional writes', async () => {
    const { adapter, db } = await createAdapterWithUser();
    const second = await adapter.createUser({
      email: 'second@example.com',
      password: 'secret123',
      role: 'admin'
    });
    if (!second.ok) throw new Error('expected success');

    const calls: string[] = [];
    for (const method of [
      'update',
      'updateIf',
      'delete',
      'deleteIf',
      'findMany',
      'count'
    ] as const) {
      const original = (db[method] as (...args: unknown[]) => unknown).bind(db);
      (db as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
        calls.push(method);
        return original(...args);
      };
    }

    await adapter.updateUser(second.user.id, { role: 'editor' });
    expect(calls).toEqual(['updateIf']);

    calls.length = 0;
    await adapter.updateUser(second.user.id, { name: 'Renamed' });
    expect(calls).toEqual(['update']); // an update that cannot remove admin pays nothing extra

    calls.length = 0;
    await adapter.deleteUser(second.user.id);
    expect(calls).toEqual(['deleteIf']); // no admin-count read, no post-write re-check
  });
});

describe('first-admin provisioning call shape (spec 060)', () => {
  async function freshInstall() {
    const db = new InMemoryDatabaseAdapter();
    const adapter = new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: db });
    await adapter.syncSchema();
    const calls: { method: string; args: unknown[] }[] = [];
    for (const method of ['create', 'atomicWrite', 'update', 'updateIf'] as const) {
      const original = (db[method] as (...args: unknown[]) => unknown).bind(db);
      (db as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        return original(...args);
      };
    }
    return { adapter, db, calls };
  }

  it('the first user is provisioned by ONE atomicWrite — claim and admin together, no standalone claim write', async () => {
    const { adapter, calls } = await freshInstall();

    const result = await adapter.signup({ email: 'first@example.com', password: 'password123' });
    if (!result.ok) throw new Error('expected success');
    expect(result.user.role).toBe('admin');

    expect(calls.map((c) => c.method)).toEqual(['atomicWrite']);
    const operations = calls[0]!.args[0] as { type: string; collection: string; data: object }[];
    expect(operations.map((o) => `${o.type}:${o.collection}`)).toEqual([
      'create:_forge_bootstrap',
      'create:users'
    ]);
    expect(operations[0]?.data).toEqual({ slot: 'users' });
    expect(operations[1]?.data).toMatchObject({ role: 'admin', email: 'first@example.com' });
  });

  it('every later user is an ordinary create — bootstrap adds no write once a user exists', async () => {
    const { adapter, calls } = await freshInstall();
    await adapter.signup({ email: 'first@example.com', password: 'password123' });
    calls.length = 0;

    await adapter.signup({ email: 'second@example.com', password: 'password123' });
    await adapter.createUser({ email: 'third@example.com', password: 'password123' });

    expect(calls.map((c) => c.method)).toEqual(['create', 'create']);
    expect(calls.every((c) => c.args[0] === 'users')).toBe(true);
  });

  it('a caller that loses the claim falls back to an ordinary create of its requested role', async () => {
    const { adapter, db, calls } = await freshInstall();
    await db.create('_forge_bootstrap', { slot: 'users' }); // claim already taken (burned)
    calls.length = 0;

    const signup = await adapter.signup({ email: 'a@example.com', password: 'password123' });
    const trusted = await adapter.createUser({
      email: 'b@example.com',
      password: 'password123',
      role: 'editor'
    });

    expect(signup.ok && signup.user.role).toBe('viewer');
    expect(trusted.ok && trusted.user.role).toBe('editor');
    // The first caller attempted the atomic batch (rolled back by the claim conflict), then created
    // normally; once that user exists, the second caller skips the bootstrap path entirely.
    expect(calls.map((c) => c.method)).toEqual(['atomicWrite', 'create', 'create']);
    expect(await db.count('_forge_bootstrap')).toBe(1);
  });

  it('the claim is scoped to its users collection: a second users collection gets its own first admin', async () => {
    const db = new InMemoryDatabaseAdapter();
    await db.syncSchema([defineUsersCollection(), defineUsersCollection({ slug: 'staff' })]);
    const users = new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: db });
    const staff = new UsersCollectionAuthAdapter({ devMode: true, collection: 'staff' }).init({
      userDatabase: db
    });

    const a = await users.signup({ email: 'a@example.com', password: 'password123' });
    const b = await staff.signup({ email: 'b@example.com', password: 'password123' });

    expect(a.ok && a.user.role).toBe('admin');
    expect(b.ok && b.user.role).toBe('admin');
    expect(await db.count('_forge_bootstrap')).toBe(2);
  });
});

describe('managesCollection (spec 061)', () => {
  it('claims exactly the configured collection — the default slug when none is configured', () => {
    const auth = new UsersCollectionAuthAdapter({ devMode: true });
    expect(auth.managesCollection('users')).toBe(true);
    expect(auth.managesCollection('posts')).toBe(false);
    expect(auth.managesCollection('_forge_bootstrap')).toBe(false);
  });

  it('follows the `collection` option, not the literal name "users"', () => {
    const auth = new UsersCollectionAuthAdapter({ devMode: true, collection: 'members' });
    expect(auth.managesCollection('members')).toBe(true);
    expect(auth.managesCollection('users')).toBe(false);
  });

  it('does not need init() — it is a static property of the configuration', () => {
    expect(
      new UsersCollectionAuthAdapter({ collection: 'accounts' }).managesCollection('accounts')
    ).toBe(true);
  });
});
