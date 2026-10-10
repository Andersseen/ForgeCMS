import { describe, expect, it } from 'vitest';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import type { AtomicWriteOperation } from '@forge-cms/db';
import { ATOMIC_WRITE_MAX_OPERATIONS } from '@forge-cms/db';
import {
  ApiKeyAuthAdapter,
  CompositeAuthAdapter,
  ForgeAuthError,
  InMemoryAuthAdapter,
  UserMutationError,
  UsersCollectionAuthAdapter,
  buildLogoutCookie,
  buildSessionCookie,
  parseCookieToken
} from './index.js';
import type { ManagedDeleteGuard } from './index.js';

// Spec 089 — critical auth evidence owned by @forge-cms/auth itself: the managed-delete guard
// (relation + last-admin invariants), uninitialised adapters failing closed, composite delegation,
// cookie parsing and session expiry. The runtime-level contract (auth-managed-delete) runs these
// paths through a real runtime; these tests pin the adapter's own decisions.

async function setup() {
  const db = new InMemoryDatabaseAdapter();
  const users = new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: db });
  const admin = await users.createUser({
    email: 'admin@x.test',
    password: 'password123',
    role: 'admin'
  });
  const editor = await users.createUser({
    email: 'ed@x.test',
    password: 'password123',
    role: 'editor'
  });
  if (!admin.ok || !editor.ok) throw new Error('fixture users');
  return { db, users, admin: admin.user, editor: editor.user };
}

const refersTo = (collection: string, equals: number, where: Record<string, unknown> = {}) =>
  ({ type: 'assertCount', collection, where, equals }) satisfies AtomicWriteOperation;

function guardFor(
  database: InMemoryDatabaseAdapter,
  make: (id: string) => AtomicWriteOperation[]
): ManagedDeleteGuard {
  return { database, assertions: make };
}

describe('UsersCollectionAuthAdapter — managed delete guard', () => {
  it('only accepts guards for its own collection and registers a guard once', async () => {
    const { db, users } = await setup();
    const guard = guardFor(db, () => []);
    expect(users.setManagedDeleteGuard('posts', guard)).toBe(false);
    expect(users.setManagedDeleteGuard('users', guard)).toBe(true);
    expect(users.setManagedDeleteGuard('users', guard)).toBe(true);
  });

  it('refuses to delete a user that content still references and keeps the user', async () => {
    const { db, users, editor } = await setup();
    users.setManagedDeleteGuard(
      'users',
      guardFor(db, (id) => [refersTo('users', 0, { id })])
    );
    await expect(users.deleteUser(editor.id)).rejects.toMatchObject({
      name: 'UserMutationError',
      reason: 'referenced',
      message: expect.stringContaining('still referenced 1 time by content')
    });
    expect(await db.findById('users', editor.id)).not.toBeNull();
  });

  it('pluralises the reference count and counts every violating assertion', async () => {
    const { db, users, editor } = await setup();
    users.setManagedDeleteGuard(
      'users',
      guardFor(db, (id) => [
        refersTo('users', 0, { id }),
        refersTo('users', 0, { id, email: 'ed@x.test' })
      ])
    );
    await expect(users.deleteUser(editor.id)).rejects.toMatchObject({
      reason: 'referenced',
      message: expect.stringContaining('referenced 2 times by content')
    });
  });

  it('deletes atomically when every relation assertion holds', async () => {
    const { db, users, editor } = await setup();
    users.setManagedDeleteGuard(
      'users',
      guardFor(db, (id) => [refersTo('users', 0, { id: `${id}-none` })])
    );
    await users.deleteUser(editor.id);
    expect(await db.findById('users', editor.id)).toBeNull();
  });

  it('deduplicates identical assertions handed over by several guards', async () => {
    const { db, users, editor } = await setup();
    const make = (id: string) => [refersTo('users', 0, { id: `${id}-none` })];
    users.setManagedDeleteGuard('users', guardFor(db, make));
    users.setManagedDeleteGuard('users', guardFor(db, make));
    await users.deleteUser(editor.id);
    expect(await db.findById('users', editor.id)).toBeNull();
  });

  it('a guarded delete of a user that does not exist is a no-op', async () => {
    const { db, users } = await setup();
    users.setManagedDeleteGuard(
      'users',
      guardFor(db, () => [refersTo('users', 0)])
    );
    await expect(users.deleteUser('missing')).resolves.toBeUndefined();
  });

  it('still protects the last admin on the guarded path', async () => {
    const { db, users, admin } = await setup();
    users.setManagedDeleteGuard(
      'users',
      guardFor(db, (id) => [refersTo('users', 0, { id: `${id}-none` })])
    );
    await expect(users.deleteUser(admin.id)).rejects.toMatchObject({ reason: 'last-admin' });
    expect(await db.findById('users', admin.id)).not.toBeNull();
  });

  it('protects the last admin on the unguarded path and tolerates a vanished user', async () => {
    const { db, users, admin } = await setup();
    await expect(users.deleteUser(admin.id)).rejects.toBeInstanceOf(UserMutationError);
    expect(await db.findById('users', admin.id)).not.toBeNull();
    await expect(users.deleteUser('missing')).resolves.toBeUndefined();
  });

  it('turns a reference that appears between preflight and commit into a clean refusal', async () => {
    const { db, users, editor } = await setup();
    let calls = 0;
    // The preflight counts through db.count; make count lie once (0) while the in-batch assertion
    // (which the database evaluates itself) sees the real row — the race the batch exists for.
    const realCount = db.count.bind(db);
    db.count = (async (...args: Parameters<typeof realCount>) => {
      calls++;
      return calls === 1 ? 0 : realCount(...args);
    }) as typeof db.count;
    users.setManagedDeleteGuard(
      'users',
      guardFor(db, (id) => [refersTo('users', 0, { id })])
    );
    await expect(users.deleteUser(editor.id)).rejects.toMatchObject({
      reason: 'referenced',
      message: expect.stringContaining('Nothing was changed')
    });
    expect(await db.findById('users', editor.id)).not.toBeNull();
  });

  it('propagates a database failure inside the delete batch without deleting', async () => {
    const { db, users, editor } = await setup();
    users.setManagedDeleteGuard(
      'users',
      guardFor(db, (id) => [refersTo('users', 0, { id: `${id}-none` })])
    );
    db.atomicWrite = (async () => {
      throw new Error('connection reset');
    }) as typeof db.atomicWrite;
    await expect(users.deleteUser(editor.id)).rejects.toThrow('connection reset');
    expect(await db.findById('users', editor.id)).not.toBeNull();
  });

  it('fails closed on a malformed or cross-database guard', async () => {
    const { db, users, editor } = await setup();
    const other = new InMemoryDatabaseAdapter();

    users.setManagedDeleteGuard(
      'users',
      guardFor(db, () => [{ type: 'delete', collection: 'x', id: '1' } as never])
    );
    await expect(users.deleteUser(editor.id)).rejects.toThrow(/only contain assertCount/);

    const { users: u2, editor: e2, db: db2 } = await setup();
    u2.setManagedDeleteGuard(
      'users',
      guardFor(other, () => [refersTo('users', 0)])
    );
    await expect(u2.deleteUser(e2.id)).rejects.toThrow(/different database/);
    expect(await db2.findById('users', e2.id)).not.toBeNull();
  });

  it('refuses a guard that cannot fit one atomic batch', async () => {
    const { db, users, editor } = await setup();
    users.setManagedDeleteGuard(
      'users',
      guardFor(db, (id) =>
        Array.from({ length: ATOMIC_WRITE_MAX_OPERATIONS }, (_, i) =>
          refersTo('users', 0, { id: `${id}-${i}` })
        )
      )
    );
    await expect(users.deleteUser(editor.id)).rejects.toThrow(/more than 25 database operations/);
    expect(await db.findById('users', editor.id)).not.toBeNull();
  });
});

describe('uninitialised adapters fail closed', () => {
  it('UsersCollectionAuthAdapter needs init() before use', async () => {
    const bare = new UsersCollectionAuthAdapter({ devMode: true });
    await expect(bare.validateSession('x.y.z')).rejects.toThrow(/not initialized/);
    await expect(bare.deleteUser('1')).rejects.toThrow(/not initialized/);
    await expect(bare.planSchema()).rejects.toThrow(/not initialized/);
  });

  it('rejects a database that cannot enforce the last-admin invariant atomically', () => {
    const weak = { name: 'weak-db' } as never;
    expect(() =>
      new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: weak })
    ).toThrow(/requires a DatabaseAdapter that implements updateIf\(\)/);
  });

  it('ApiKeyAuthAdapter needs a database', async () => {
    const bare = new ApiKeyAuthAdapter();
    await expect(bare.syncSchema()).rejects.toThrow(/not initialized/);
    await expect(bare.planSchema()).rejects.toThrow(/not initialized/);
  });

  it('plans schema drift for its internal collections', async () => {
    const { users } = await setup();
    await expect(users.planSchema()).resolves.toMatchObject({ blocking: false });
    const keys = new ApiKeyAuthAdapter().init({ apiKeyDatabase: new InMemoryDatabaseAdapter() });
    await expect(keys.planSchema()).resolves.toMatchObject({ blocking: false });
  });
});

describe('UsersCollectionAuthAdapter — session and signup edges', () => {
  it('a session issued before a password change is rejected, a fresh one is accepted', async () => {
    const { users, admin } = await setup();
    const login = await users.login('admin@x.test', 'password123');
    if (!login.ok) throw new Error('login');
    expect(await users.validateSession(login.token)).not.toBeNull();
    await users.updateUser(admin.id, { password: 'brand-new-password' });
    expect(await users.validateSession(login.token)).toBeNull();
    const again = await users.login('admin@x.test', 'brand-new-password');
    expect(again.ok).toBe(true);
  });

  it('a deleted user session is rejected and requireAuth maps it to Unauthorized', async () => {
    const { users, editor } = await setup();
    const login = await users.login('ed@x.test', 'password123');
    if (!login.ok) throw new Error('login');
    await users.deleteUser(editor.id);
    expect(await users.validateSession(login.token)).toBeNull();
    await expect(
      users.requireAuth(
        new Request('https://x.test', { headers: { authorization: `Bearer ${login.token}` } })
      )
    ).rejects.toBeInstanceOf(ForgeAuthError);
    await expect(users.requireAuth(new Request('https://x.test'))).rejects.toMatchObject({
      code: 'unauthorized'
    });
  });

  it('signup rejects an invalid name without writing', async () => {
    const { db, users } = await setup();
    const result = await users.signup({
      email: 'new@x.test',
      password: 'password123',
      name: 'x'.repeat(10_000)
    });
    expect(result).toEqual({ ok: false, reason: 'invalid-name' });
    expect(await db.count('users', { email: 'new@x.test' })).toBe(0);
  });

  it('updating a user that does not exist (non-admin role path) reports null, not a last-admin error', async () => {
    const { users } = await setup();
    expect(await users.updateUser('missing', { role: 'viewer' })).toBeNull();
  });
});

describe('API key header and record edges', () => {
  async function keys() {
    const db = new InMemoryDatabaseAdapter();
    const adapter = new ApiKeyAuthAdapter().init({ apiKeyDatabase: db });
    await adapter.syncSchema();
    return { db, adapter };
  }

  it('extractToken ignores missing, non-Bearer and empty Authorization headers', async () => {
    const { adapter } = await keys();
    const req = (h?: string) =>
      new Request('https://x.test', h ? { headers: { authorization: h } } : {});
    expect(adapter.extractToken(req())).toBeNull();
    expect(adapter.extractToken(req('Basic abc'))).toBeNull();
    expect(adapter.extractToken(req('Bearer    '))).toBeNull();
    expect(adapter.extractToken(req('bearer tok'))).toBe('tok');
  });

  it('rejects malformed keys without touching the database', async () => {
    const { adapter, db } = await keys();
    let reads = 0;
    const find = db.findById.bind(db);
    db.findById = (async (...a: Parameters<typeof find>) => {
      reads++;
      return find(...a);
    }) as typeof db.findById;
    for (const token of [
      'forge_',
      'forge__secret',
      'forge_id_',
      'other_x_y',
      'forge_' + 'a'.repeat(5000)
    ]) {
      expect(await adapter.validateSession(token)).toBeNull();
    }
    expect(reads).toBe(0);
  });

  it('rejects a key whose stored hash is missing, wrong, or revoked', async () => {
    const { adapter, db } = await keys();
    const key = await adapter.createApiKey({ name: 'k', scopes: ['content:read'] });
    expect(await adapter.validateSession(key.secret)).not.toBeNull();

    const id = key.secret.split('_')[1]!;
    const tampered = key.secret.slice(0, -2) + (key.secret.endsWith('aa') ? 'bb' : 'aa');
    expect(await adapter.validateSession(tampered)).toBeNull();

    await db.update('_forge_api_keys', id, { secretHash: '' });
    expect(await adapter.validateSession(key.secret)).toBeNull();

    const second = await adapter.createApiKey({ name: 'k2' });
    await adapter.revokeApiKey(second.apiKey.id);
    expect(await adapter.validateSession(second.secret)).toBeNull();
  });

  it('a key record with malformed scopes authenticates with no scopes rather than throwing', async () => {
    const { adapter, db } = await keys();
    const key = await adapter.createApiKey({ name: 'k' });
    await db.update('_forge_api_keys', key.apiKey.id, { scopes: 'not-an-array' });
    const session = await adapter.validateSession(key.secret);
    expect(session?.user.scopes).toEqual([]);
  });

  it('still authenticates when the lastUsedAt bookkeeping write fails', async () => {
    const { adapter, db } = await keys();
    const key = await adapter.createApiKey({ name: 'k' });
    db.update = (async () => {
      throw new Error('write failed');
    }) as typeof db.update;
    expect(await adapter.validateSession(key.secret)).not.toBeNull();
  });
});

describe('CompositeAuthAdapter — schema and managed-delete delegation', () => {
  it('merges every child plan and ignores children without one', async () => {
    const db = new InMemoryDatabaseAdapter();
    const users = new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: db });
    const keys = new ApiKeyAuthAdapter().init({ apiKeyDatabase: db });
    const composite = new CompositeAuthAdapter([users, keys, new InMemoryAuthAdapter()]);
    await expect(composite.planSchema()).resolves.toMatchObject({ blocking: false });
  });

  it('reports a guard as enforced only if every managing child accepts it', async () => {
    const db = new InMemoryDatabaseAdapter();
    const users = new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: db });
    const guard = guardFor(db, () => []);
    expect(new CompositeAuthAdapter([users]).setManagedDeleteGuard('users', guard)).toBe(true);
    expect(new CompositeAuthAdapter([users]).setManagedDeleteGuard('posts', guard)).toBe(false);

    const refusing = {
      name: 'refusing',
      init() {
        return this;
      },
      managesCollection: () => true,
      setManagedDeleteGuard: () => false,
      extractToken: () => null,
      validateSession: async () => null,
      requireAuth: async () => {
        throw new ForgeAuthError('Unauthorized', 'unauthorized');
      }
    };
    expect(new CompositeAuthAdapter([users, refusing]).setManagedDeleteGuard('users', guard)).toBe(
      false
    );
  });

  it('routing survives a child whose extractToken throws', async () => {
    const throwing = {
      name: 'throws',
      init() {
        return this;
      },
      canHandleToken: () => true,
      extractToken: () => {
        throw new Error('boom');
      },
      validateSession: async () => null,
      requireAuth: async () => {
        throw new ForgeAuthError('Unauthorized', 'unauthorized');
      }
    };
    const memory = new InMemoryAuthAdapter();
    memory.registerSession('tok', { user: { id: 'u', role: 'viewer' } as never });
    const composite = new CompositeAuthAdapter([throwing, memory]);
    const user = await composite.requireAuth(
      new Request('https://x.test', { headers: { authorization: 'Bearer tok' } })
    );
    expect(user.id).toBe('u');
  });
});

describe('cookie helpers', () => {
  const withCookie = (cookie: string) => new Request('https://x.test', { headers: { cookie } });

  it('reads only the Forge session cookie, tolerating junk and bad encoding', () => {
    expect(parseCookieToken(new Request('https://x.test'))).toBeNull();
    expect(parseCookieToken(withCookie('junk; other=1'))).toBeNull();
    expect(parseCookieToken(withCookie('forge_session='))).toBeNull();
    expect(parseCookieToken(withCookie('a=1; forge_session=tok%2Eone; b=2'))).toBe('tok.one');
    expect(parseCookieToken(withCookie('forge_session=%E0%A4%A'))).toBe('%E0%A4%A');
    expect(parseCookieToken(withCookie('custom=v'), 'custom')).toBe('v');
  });

  it('builds hardened Set-Cookie values, dropping Secure only when asked', () => {
    const secure = buildSessionCookie('t o k');
    expect(secure).toContain('forge_session=t%20o%20k');
    expect(secure).toContain('HttpOnly');
    expect(secure).toContain('SameSite=Lax');
    expect(secure).toContain('Secure');
    expect(buildSessionCookie('t', { secure: false, maxAgeSeconds: 5 })).not.toContain('Secure');
    expect(buildLogoutCookie()).toContain('Max-Age=0');
    expect(buildLogoutCookie({ secure: false })).not.toContain('Secure');
  });
});

describe('InMemoryAuthAdapter', () => {
  it('expires sessions and rejects empty tokens', async () => {
    const adapter = new InMemoryAuthAdapter().init();
    adapter.registerSession('old', {
      user: { id: 'u', role: 'viewer' } as never,
      expiresAt: new Date(Date.now() - 1000)
    });
    expect(await adapter.validateSession('')).toBeNull();
    expect(await adapter.validateSession('old')).toBeNull();
    expect(await adapter.validateSession('old')).toBeNull();
    await expect(adapter.requireAuth(new Request('https://x.test'))).rejects.toBeInstanceOf(
      ForgeAuthError
    );
  });
});
