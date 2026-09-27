import { afterAll, describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import type { CollectionDefinition, FieldMap, GlobalDefinition } from '@forge-cms/core';
import { InMemoryDatabaseAdapter, LibSqlDatabaseAdapter } from '@forge-cms/db';
import type { DatabaseAdapter } from '@forge-cms/db';
import type { AuthAdapter, ManagedDeleteGuard } from '@forge-cms/auth';
import {
  ApiKeyAuthAdapter,
  CompositeAuthAdapter,
  InMemoryAuthAdapter,
  UserMutationError,
  UsersCollectionAuthAdapter,
  defineUsersCollection
} from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import {
  authManagedDeleteSchema,
  runAuthManagedDeleteContractTests
} from '@forge-cms/testing/contracts';
import { ForgeCmsRuntime } from './runtime.js';
import { findOrphanedDocuments } from './relation-integrity.js';

// Spec 065 — auth-managed user deletion respects content/global relations.

const tempDir = await (async () => {
  const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as {
    mkdtempSync(prefix: string): string;
    rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
  };
  const os = (await import(/* @vite-ignore */ 'node:os' as string)) as { tmpdir(): string };
  return {
    make: () => fs.mkdtempSync(`${os.tmpdir()}/forge-auth-delete-`),
    remove: (path: string) => fs.rmSync(path, { recursive: true, force: true })
  };
})();

function usersAuth(database: DatabaseAdapter, collection = 'users') {
  return new UsersCollectionAuthAdapter({ devMode: true, collection }).init({
    userDatabase: database
  });
}

function runtimeOver(
  database: DatabaseAdapter,
  auth: AuthAdapter,
  collections: CollectionDefinition[],
  globals: GlobalDefinition[] = []
): ForgeCmsRuntime {
  const runtime = new ForgeCmsRuntime({
    collections,
    globals,
    adapters: { database, auth, storage: new InMemoryStorageAdapter() }
  });
  runtime.init();
  return runtime;
}

const posts = (target = 'users', fields: FieldMap = {}) =>
  defineCollection({
    slug: 'posts',
    fields: {
      title: defineField.text(),
      author: defineField.relation({ collection: target, required: true }),
      ...fields
    }
  });

async function blog(collection = 'users') {
  const database = new InMemoryDatabaseAdapter();
  const auth = usersAuth(database, collection);
  const runtime = runtimeOver(database, auth, [
    defineUsersCollection({ slug: collection }),
    posts(collection)
  ]);
  await runtime.syncSchema();
  const make = async (role: 'admin' | 'viewer', email: string) => {
    const result = await auth.createUser({ email, password: 'correct-horse', role });
    if (!result.ok) throw new Error(result.reason);
    return result.user.id;
  };
  const admin = await make('admin', 'admin@example.test');
  const viewer = await make('viewer', 'viewer@example.test');
  return { database, auth, runtime, admin, viewer };
}

async function reasonOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return 'ok';
  } catch (err) {
    return err instanceof UserMutationError ? err.reason : err;
  }
}

describe('UsersCollectionAuthAdapter.deleteUser — referenced users (spec 065)', () => {
  it('refuses a referenced viewer; the user and the reference stay valid', async () => {
    const { database, auth, runtime, viewer } = await blog();
    const post = await runtime.create({
      collection: 'posts',
      data: { title: 'P', author: viewer }
    });

    await expect(auth.deleteUser(viewer)).rejects.toThrow(
      /cannot be deleted: it is still referenced 1 time by content/
    );
    expect(await reasonOf(auth.deleteUser(viewer))).toBe('referenced');
    expect(await database.findById('users', viewer)).not.toBeNull();
    expect((await database.findById('posts', post.id as string))?.author).toBe(viewer);
    expect(await findOrphanedDocuments(runtime, runtime.getCollection('posts')!)).toEqual([]);
  });

  it('never leaks the referencing documents or their collection', async () => {
    const { auth, runtime, viewer } = await blog();
    await runtime.create({ collection: 'posts', data: { title: 'Secret plan', author: viewer } });
    const message = await auth.deleteUser(viewer).catch((err: Error) => err.message);
    expect(message).not.toMatch(/Secret plan|posts/);
  });

  it('deletes the user once the reference is changed', async () => {
    const { database, auth, runtime, admin, viewer } = await blog();
    const post = await runtime.create({ collection: 'posts', data: { author: viewer } });
    await runtime.update({ collection: 'posts', id: post.id as string, data: { author: admin } });

    await auth.deleteUser(viewer);
    expect(await database.findById('users', viewer)).toBeNull();
    expect(await findOrphanedDocuments(runtime, runtime.getCollection('posts')!)).toEqual([]);
  });

  it('commits the relation guards, the last-admin guard and the delete as one batch', async () => {
    const { database, auth, viewer } = await blog();
    const batches: unknown[][] = [];
    const original = database.atomicWrite.bind(database);
    database.atomicWrite = (operations) => {
      batches.push([...operations]);
      return original(operations);
    };

    await auth.deleteUser(viewer);
    expect(batches).toEqual([
      [
        {
          type: 'assertCount',
          collection: 'posts',
          where: { author: { in: [viewer] } },
          equals: 0
        },
        {
          type: 'deleteIf',
          collection: 'users',
          id: viewer,
          condition: { keepAtLeast: { where: { role: 'admin' }, others: 1 } }
        }
      ]
    ]);
  });

  it('follows a renamed managed collection, and leaves an unmanaged collection named users alone', async () => {
    const database = new InMemoryDatabaseAdapter();
    const auth = usersAuth(database, 'members');
    const plainUsers = defineCollection({ slug: 'users', fields: { name: defineField.text() } });
    const runtime = runtimeOver(database, auth, [
      defineUsersCollection({ slug: 'members' }),
      plainUsers,
      defineCollection({
        slug: 'articles',
        fields: {
          author: defineField.relation({ collection: 'members', required: true }),
          owner: defineField.relation({ collection: 'users' })
        }
      })
    ]);
    await runtime.syncSchema();
    const admin = await auth.createUser({ email: 'a@x.test', password: 'correct-horse' });
    const member = await auth.createUser({ email: 'm@x.test', password: 'correct-horse' });
    if (!admin.ok || !member.ok) throw new Error('setup');
    const plain = await runtime.create({ collection: 'users', data: { name: 'plain' } });
    await runtime.create({
      collection: 'articles',
      data: { author: member.user.id, owner: plain.id }
    });

    expect(await reasonOf(auth.deleteUser(member.user.id))).toBe('referenced');
    expect(await database.findById('members', member.user.id)).not.toBeNull();

    // `users` here is ordinary content: generic CRUD applies, with its normal restrict semantics.
    await expect(runtime.delete({ collection: 'users', id: plain.id as string })).rejects.toThrow(
      /referenced by 1 document/
    );
  });

  it('reaches the managing child of a CompositeAuthAdapter', async () => {
    const database = new InMemoryDatabaseAdapter();
    const users = usersAuth(database);
    const composite = new CompositeAuthAdapter([
      new ApiKeyAuthAdapter().init({ apiKeyDatabase: database }),
      users
    ]);
    const runtime = runtimeOver(database, composite, [defineUsersCollection(), posts()]);
    await runtime.syncSchema();
    await users.createUser({ email: 'a@x.test', password: 'correct-horse' });
    const v = await users.createUser({ email: 'v@x.test', password: 'correct-horse' });
    if (!v.ok) throw new Error('setup');
    await runtime.create({ collection: 'posts', data: { author: v.user.id } });

    expect(await reasonOf(users.deleteUser(v.user.id))).toBe('referenced');
  });

  it('wires every child that claims the collection, and reports whether all of them enforce it', () => {
    const guard: ManagedDeleteGuard = {
      database: new InMemoryDatabaseAdapter(),
      assertions: () => []
    };
    const a = usersAuth(new InMemoryDatabaseAdapter());
    const b = usersAuth(new InMemoryDatabaseAdapter());
    expect(new CompositeAuthAdapter([a, b]).setManagedDeleteGuard('users', guard)).toBe(true);
    expect(new CompositeAuthAdapter([a, b]).setManagedDeleteGuard('others', guard)).toBe(false);

    const legacy = Object.assign(new InMemoryAuthAdapter(), { managesCollection: () => true });
    expect(new CompositeAuthAdapter([a, legacy]).setManagedDeleteGuard('users', guard)).toBe(false);
  });

  it('refuses at startup a referenced collection managed by an adapter that cannot enforce guards', () => {
    const legacy = Object.assign(new InMemoryAuthAdapter(), {
      managesCollection: (slug: string) => slug === 'users'
    });
    const database = new InMemoryDatabaseAdapter();
    expect(() => runtimeOver(database, legacy, [defineUsersCollection(), posts()])).toThrow(
      /'users' is managed by the auth adapter 'in-memory'.*cannot enforce/s
    );

    // Without references to it there is nothing to protect: still accepted.
    expect(() => runtimeOver(database, legacy, [defineUsersCollection()])).not.toThrow();
    // Adapters that manage nothing are untouched.
    expect(() =>
      runtimeOver(database, new InMemoryAuthAdapter(), [defineUsersCollection(), posts()])
    ).not.toThrow();
  });

  it('keeps every runtime guard: a second runtime sharing the adapter cannot lift protection', async () => {
    const { database, auth, runtime, viewer } = await blog();
    await runtime.create({ collection: 'posts', data: { author: viewer } });
    // An auxiliary runtime (seed script, …) over the same adapter, whose schema references nothing.
    runtimeOver(database, auth, [defineUsersCollection()]);
    // And one with the same schema: identical assertions are committed once.
    runtimeOver(database, auth, [defineUsersCollection(), posts()]);

    expect(await reasonOf(auth.deleteUser(viewer))).toBe('referenced');
    expect(await database.findById('users', viewer)).not.toBeNull();
  });

  it('keeps deleting a missing user a no-op', async () => {
    const { auth, runtime, admin } = await blog();
    await runtime.create({ collection: 'posts', data: { author: admin } });
    await expect(auth.deleteUser('no-such-user')).resolves.toBeUndefined();
  });

  it('refuses before any write a delete whose guards do not fit one atomic batch', async () => {
    const database = new InMemoryDatabaseAdapter();
    const auth = usersAuth(database);
    const many: FieldMap = {};
    for (let i = 0; i < 25; i++) many[`ref${i}`] = defineField.relation({ collection: 'users' });
    const runtime = runtimeOver(database, auth, [
      defineUsersCollection(),
      defineCollection({ slug: 'wide', fields: many })
    ]);
    await runtime.syncSchema();
    await auth.createUser({ email: 'a@x.test', password: 'correct-horse' });
    const v = await auth.createUser({ email: 'v@x.test', password: 'correct-horse' });
    if (!v.ok) throw new Error('setup');
    let batches = 0;
    const original = database.atomicWrite.bind(database);
    database.atomicWrite = (operations) => {
      batches++;
      return original(operations);
    };

    await expect(auth.deleteUser(v.user.id)).rejects.toThrow(/more than 25 database operations/);
    expect(batches).toBe(0);
    expect(await database.findById('users', v.user.id)).not.toBeNull();
  });

  it('fails closed when the users live in a different database than the content referencing them', async () => {
    const content = new InMemoryDatabaseAdapter();
    const auth = usersAuth(new InMemoryDatabaseAdapter());
    const runtime = runtimeOver(content, auth, [defineUsersCollection(), posts()]);
    await runtime.syncSchema();
    await auth.createUser({ email: 'a@x.test', password: 'correct-horse' });
    const v = await auth.createUser({ email: 'v@x.test', password: 'correct-horse' });
    if (!v.ok) throw new Error('setup');

    await expect(auth.deleteUser(v.user.id)).rejects.toThrow(/different database/);
  });

  it('keeps the generic content delete of the users collection refused (spec 061)', async () => {
    const { runtime, viewer } = await blog();
    await expect(runtime.delete({ collection: 'users', id: viewer })).rejects.toThrow(
      /managed by the configured auth adapter/
    );
  });
});

// --- two-writer contract ------------------------------------------------------------------------------

function contender(database: DatabaseAdapter, prefix: string) {
  const schema = authManagedDeleteSchema(prefix);
  const users = usersAuth(database, schema.members);
  const runtime = runtimeOver(
    database,
    users,
    [defineUsersCollection({ slug: schema.members }), ...schema.collections],
    schema.globals
  );
  return { runtime, users };
}

describe('InMemoryDatabaseAdapter (one process, contenders share the adapter instance)', () => {
  runAuthManagedDeleteContractTests(async ({ prefix, parties, gate }) => {
    const shared = new InMemoryDatabaseAdapter();
    const contenders = [];
    for (let i = 0; i < parties; i++) {
      const c = contender(gate.wrap(shared, i), prefix);
      await c.runtime.syncSchema();
      contenders.push(c);
    }
    return { contenders, database: shared };
  });
});

describe('LibSqlDatabaseAdapter — independent clients on one database file', () => {
  const directory = tempDir.make();
  afterAll(() => tempDir.remove(directory));

  runAuthManagedDeleteContractTests(async ({ prefix, parties, gate }) => {
    const url = `file:${directory}/${prefix}.db`;
    const contenders = [];
    for (let i = 0; i < parties; i++) {
      const c = contender(gate.wrap(new LibSqlDatabaseAdapter(url).init(), i), prefix);
      await c.runtime.syncSchema();
      contenders.push(c);
    }
    const raw = contender(new LibSqlDatabaseAdapter(url).init(), prefix);
    await raw.runtime.syncSchema();
    return { contenders, database: raw.runtime.adapters.database };
  });
});
