import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import type { CollectionDefinition } from '@forge-cms/core';
import { InMemoryDatabaseAdapter, LibSqlDatabaseAdapter } from '@forge-cms/db';
import type { DatabaseAdapter } from '@forge-cms/db';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { runVersionHistoryContractTests } from '@forge-cms/testing/contracts';
import { createClient } from '@libsql/client';
import { ForgeCmsRuntime } from './runtime.js';
import {
  ConcurrentModificationError,
  NotFoundError,
  UniqueConstraintError,
  ValidationFailedError,
  AccessDeniedError
} from './errors.js';
import { handleUpdate } from './handlers.js';
import { handleSetNullOnDelete } from './relation-integrity.js';

// Spec 062 — document and version history consistency.

/**
 * Lets a test run an action right before the next `atomicWrite()` — after the operation did all its
 * reads — so a conflicting version row appears exactly where a concurrent writer's would.
 */
function interceptBatches(database: DatabaseAdapter) {
  let pending: (() => Promise<unknown>) | undefined;
  const proxied = new Proxy(database, {
    get(target, property) {
      if (property === 'atomicWrite') {
        return async (...args: Parameters<DatabaseAdapter['atomicWrite']>) => {
          const next = pending;
          pending = undefined;
          if (next) await next();
          return target.atomicWrite(...args);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
    }
  });
  return {
    database: proxied,
    beforeNextBatch(action: () => Promise<unknown>) {
      pending = action;
    }
  };
}

function plantVersion(database: DatabaseAdapter, documentId: string, versionNumber: number) {
  return database.create('_versions_posts', {
    id: `planted-${versionNumber}`,
    documentId,
    versionNumber,
    data: '{}',
    createdAt: new Date().toISOString()
  });
}

function historyCollection(slug: string): CollectionDefinition {
  return defineCollection({
    slug,
    versions: true,
    fields: {
      title: defineField.text({ required: true }),
      body: defineField.text(),
      tag: defineField.text()
    }
  });
}

function runtimeOver(
  database: DatabaseAdapter,
  collections: CollectionDefinition[],
  auth = new InMemoryAuthAdapter()
): ForgeCmsRuntime {
  const runtime = new ForgeCmsRuntime({
    collections,
    adapters: { database, auth, storage: new InMemoryStorageAdapter() }
  });
  runtime.init();
  return runtime;
}

/**
 * `node:fs`/`node:os` through a variable specifier with a local type: this package carries no
 * `@types/node` (its source must stay edge-safe) — same approach as the auth package's libSQL tests.
 */
async function loadTempDir() {
  const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as {
    mkdtempSync(prefix: string): string;
    rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
  };
  const os = (await import(/* @vite-ignore */ 'node:os' as string)) as { tmpdir(): string };
  return {
    make: () => fs.mkdtempSync(`${os.tmpdir()}/forge-versions-`),
    remove: (directory: string) => fs.rmSync(directory, { recursive: true, force: true })
  };
}
const tempDir = await loadTempDir();

// --- the shared contract on InMemory and on real on-disk libSQL ---------------------------------

describe('InMemoryDatabaseAdapter (one process, runtimes share the adapter instance)', () => {
  runVersionHistoryContractTests(async ({ collection, parties, gate }) => {
    const database = new InMemoryDatabaseAdapter();
    const contenders = await Promise.all(
      Array.from({ length: parties }, async () => {
        const runtime = runtimeOver(gate.wrap(database), [historyCollection(collection)]);
        await runtime.syncSchema();
        return runtime;
      })
    );
    return { contenders, database };
  });
});

describe('LibSqlDatabaseAdapter — independent clients on one database file', () => {
  const directory = tempDir.make();
  afterAll(() => tempDir.remove(directory));
  let fileCounter = 0;
  let currentUrl = '';

  runVersionHistoryContractTests(
    async ({ collection, parties, gate }) => {
      currentUrl = `file:${directory}/history-${++fileCounter}.db`;
      const contenders = [];
      for (let i = 0; i < parties; i++) {
        // Its own adapter => its own libSQL client / SQLite connection.
        const runtime = runtimeOver(gate.wrap(new LibSqlDatabaseAdapter(currentUrl).init()), [
          historyCollection(collection)
        ]);
        await runtime.syncSchema();
        contenders.push(runtime);
      }
      // Raw, ungated handle: its own runtime's syncSchema registers the version table on it too.
      const raw = runtimeOver(new LibSqlDatabaseAdapter(currentUrl).init(), [
        historyCollection(collection)
      ]);
      await raw.syncSchema();
      const database = raw.adapters.database;
      return { contenders, database };
    },
    {
      // A real database-side failure of the snapshot INSERT that is not a constraint violation.
      failSnapshotInserts: async (versionsCollection) => {
        const client = createClient({ url: currentUrl });
        await client.execute(
          `CREATE TRIGGER "fail_${versionsCollection}" BEFORE INSERT ON "${versionsCollection}" ` +
            `BEGIN SELECT RAISE(ABORT, 'injected snapshot failure'); END`
        );
        return async () => {
          await client.execute(`DROP TRIGGER "fail_${versionsCollection}"`);
          client.close();
        };
      }
    }
  );
});

// --- focused semantics (InMemory) ---------------------------------------------------------------

describe('full snapshots across field types (spec 062 §5/§6)', () => {
  const authors = defineCollection({
    slug: 'authors',
    fields: { name: defineField.text({ required: true }) }
  });
  const articles = defineCollection({
    slug: 'articles',
    versions: true,
    drafts: true,
    locales: ['en', 'es'],
    fields: {
      title: defineField.text({ required: true, localized: true }),
      body: defineField.textarea(),
      featured: defineField.boolean(),
      category: defineField.select({ options: ['news', 'guide'] }),
      author: defineField.relation({ collection: 'authors' }),
      seo: defineField.group({
        fields: { metaTitle: defineField.text(), noIndex: defineField.boolean() }
      })
    }
  });

  let runtime: ForgeCmsRuntime;
  let authorA: string;
  let authorB: string;

  beforeEach(async () => {
    runtime = runtimeOver(new InMemoryDatabaseAdapter(), [authors, articles]);
    await runtime.syncSchema();
    authorA = (await runtime.create({ collection: 'authors', data: { name: 'A' } })).id as string;
    authorB = (await runtime.create({ collection: 'authors', data: { name: 'B' } })).id as string;
  });

  it('an update touching one field still snapshots every untouched field, then restores exactly', async () => {
    const doc = await runtime.create({
      collection: 'articles',
      locale: 'en',
      data: {
        title: 'Hello',
        body: 'Body',
        featured: true,
        category: 'news',
        author: authorA,
        seo: { metaTitle: 'Meta', noIndex: false }
      }
    });
    const id = doc.id as string;
    await runtime.update({ collection: 'articles', id, locale: 'es', data: { title: 'Hola' } });

    const [v2, v1] = await runtime.listVersions({ collection: 'articles', documentId: id });
    const expectedV2 = {
      title: { en: 'Hello', es: 'Hola' },
      body: 'Body',
      featured: true,
      category: 'news',
      author: authorA,
      seo: { metaTitle: 'Meta', noIndex: false },
      _status: 'draft'
    };
    expect(v2!.data).toEqual(expectedV2);
    expect(v1!.data).toEqual({ ...expectedV2, title: { en: 'Hello' } });
    // No system metadata in a snapshot.
    for (const key of ['id', 'created_at', 'updated_at', '_storageKey']) {
      expect(v2!.data).not.toHaveProperty(key);
    }

    // Move everything away from v2, then restore it.
    await runtime.update({
      collection: 'articles',
      id,
      data: {
        title: { en: 'Changed' },
        body: null,
        featured: false,
        category: 'guide',
        author: authorB,
        seo: { metaTitle: 'Other', noIndex: true },
        _status: 'published'
      }
    });
    const created = await runtime.adapters.database.findById('articles', id);
    await runtime.restoreVersion({ collection: 'articles', versionId: v2!.id });

    const restored = await runtime.adapters.database.findById('articles', id);
    const { id: restoredId, created_at, updated_at, ...content } = restored!;
    void updated_at;
    expect(content).toEqual(expectedV2);
    expect(restoredId).toBe(id);
    expect(created_at).toBe(created!.created_at);

    const history = await runtime.listVersions({ collection: 'articles', documentId: id });
    expect(history.map((v) => v.versionNumber)).toEqual([4, 3, 2, 1]);
    expect(history[0]!.data).toEqual(expectedV2);
    expect(history[0]!.label).toBe('Restored from version 2');
  });
});

describe('restore semantics (spec 062 §6)', () => {
  it('invalid old-schema restore: validation error, document and history unchanged', async () => {
    const database = new InMemoryDatabaseAdapter();
    const before = runtimeOver(database, [
      defineCollection({
        slug: 'posts',
        versions: true,
        fields: { title: defineField.text({ required: true }) }
      })
    ]);
    await before.syncSchema();
    const doc = await before.create({ collection: 'posts', data: { title: 'Old' } });
    const id = doc.id as string;

    // The schema evolves: `category` becomes required. Existing documents are brought up to date.
    const after = runtimeOver(database, [
      defineCollection({
        slug: 'posts',
        versions: true,
        fields: {
          title: defineField.text({ required: true }),
          category: defineField.text({ required: true })
        }
      })
    ]);
    await after.syncSchema();
    await after.update({ collection: 'posts', id, data: { title: 'New', category: 'C' } });
    const [, oldVersion] = await after.listVersions({ collection: 'posts', documentId: id });
    expect(oldVersion!.data).toEqual({ title: 'Old' });

    const historyBefore = await after.listVersions({ collection: 'posts', documentId: id });
    await expect(
      after.restoreVersion({ collection: 'posts', versionId: oldVersion!.id })
    ).rejects.toBeInstanceOf(ValidationFailedError);

    const current = await after.findByID({ collection: 'posts', id });
    expect({ title: current.title, category: current.category }).toEqual({
      title: 'New',
      category: 'C'
    });
    expect(await after.listVersions({ collection: 'posts', documentId: id })).toEqual(
      historyBefore
    );
  });

  it('a legacy (pre-062) patch snapshot restores only the fields it contains, never system metadata', async () => {
    const runtime = runtimeOver(new InMemoryDatabaseAdapter(), [historyCollection('posts')]);
    await runtime.syncSchema();
    const doc = await runtime.create({
      collection: 'posts',
      data: { title: 'Now', body: 'kept body', tag: 'kept' }
    });
    const id = doc.id as string;
    const createdAt = (await runtime.adapters.database.findById('posts', id))!.created_at;

    // What a pre-062 update wrote: the patch only, no `snapshotFormat` — here also carrying system keys.
    await runtime.adapters.database.create('_versions_posts', {
      id: 'legacy',
      documentId: id,
      versionNumber: 2,
      data: JSON.stringify({
        title: 'Legacy',
        id: 'hijack',
        created_at: '1999-01-01T00:00:00.000Z',
        _storageKey: 'elsewhere/object'
      }),
      createdAt: new Date().toISOString()
    });

    await runtime.restoreVersion({ collection: 'posts', versionId: 'legacy' });
    const row = await runtime.adapters.database.findById('posts', id);
    expect(row).toMatchObject({ id, title: 'Legacy', body: 'kept body', tag: 'kept' });
    expect(row!.created_at).toBe(createdAt);
    expect(row).not.toHaveProperty('_storageKey');
  });

  it('only the fields that change are write-checked: a restore touching no protected field is allowed', async () => {
    const auth = new InMemoryAuthAdapter();
    const posts = defineCollection({
      slug: 'posts',
      versions: true,
      access: { read: () => true, update: () => true },
      fields: {
        title: defineField.text({ required: true }),
        featured: defineField.boolean({ access: { write: ['admin'] } })
      }
    });
    const runtime = runtimeOver(new InMemoryDatabaseAdapter(), [posts], auth);
    await runtime.syncSchema();
    const editor = { id: 'e', email: 'e@example.com', role: 'editor', roles: ['editor'] };

    const doc = await runtime.create({
      collection: 'posts',
      data: { title: 'v1', featured: true }
    });
    const id = doc.id as string;
    await runtime.update({ collection: 'posts', id, data: { title: 'v2' } });
    const [, v1] = await runtime.listVersions({ collection: 'posts', documentId: id });

    // `featured` is identical in v1 and now, so the editor's restore only writes `title`.
    await runtime.restoreVersion({
      collection: 'posts',
      versionId: v1!.id,
      user: editor,
      overrideAccess: false
    });
    expect((await runtime.findByID({ collection: 'posts', id })).title).toBe('v1');

    // A restore that would change the admin-only field is refused, and writes nothing.
    await runtime.update({ collection: 'posts', id, data: { featured: false } });
    const history = await runtime.listVersions({ collection: 'posts', documentId: id });
    await expect(
      runtime.restoreVersion({
        collection: 'posts',
        versionId: v1!.id,
        user: editor,
        overrideAccess: false
      })
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect(await runtime.listVersions({ collection: 'posts', documentId: id })).toEqual(history);
  });
});

describe('read ordering (spec 062 §3)', () => {
  it("a writer that commits between another writer's reads makes that writer conflict, never lose its update", async () => {
    const store = new InMemoryDatabaseAdapter();
    const a = runtimeOver(store, [historyCollection('posts')]);
    await a.syncSchema();
    const doc = await a.create({ collection: 'posts', data: { title: 'v1', body: 'original' } });
    const id = doc.id as string;

    // B's first read (whatever it is) completes, then A commits a full update, then B continues.
    let interleave: (() => Promise<unknown>) | undefined = () =>
      a.update({ collection: 'posts', id, data: { body: 'changed by A' } });
    const readsThenA = new Proxy(store, {
      get(target, property) {
        if (property === 'findById' || property === 'findMany') {
          return async (...args: unknown[]) => {
            const result = await (target[property] as (...a: unknown[]) => Promise<unknown>)(
              ...args
            );
            const next = interleave;
            interleave = undefined;
            if (next) await next();
            return result;
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      }
    });
    const b = runtimeOver(readsThenA, [historyCollection('posts')]);

    await expect(
      b.update({ collection: 'posts', id, data: { title: 'B' } })
    ).rejects.toBeInstanceOf(ConcurrentModificationError);

    const row = await store.findById('posts', id);
    const [latest] = await a.listVersions({ collection: 'posts', documentId: id });
    expect(row).toMatchObject({ title: 'v1', body: 'changed by A' });
    expect(latest!.data).toEqual({ title: 'v1', body: 'changed by A', tag: null });
  });
});

describe('hooks around the atomic batch (spec 062 §10)', () => {
  it('before* hooks run, after* hooks do not, when the batch rolls back; all run on commit', async () => {
    const calls: string[] = [];
    const posts = defineCollection({
      slug: 'posts',
      versions: true,
      fields: { title: defineField.text({ required: true }) },
      hooks: {
        beforeOperation: [({ operation }) => void calls.push(`beforeOperation:${operation}`)],
        beforeValidate: [({ data }) => (calls.push('beforeValidate'), data)],
        beforeChange: [({ data }) => (calls.push('beforeChange'), data)],
        afterChange: [() => void calls.push('afterChange')],
        afterOperation: [({ operation }) => void calls.push(`afterOperation:${operation}`)]
      }
    });
    const store = new InMemoryDatabaseAdapter();
    const intercepted = interceptBatches(store);
    const runtime = runtimeOver(intercepted.database, [posts]);
    await runtime.syncSchema();
    const doc = await runtime.create({ collection: 'posts', data: { title: 'v1' } });
    const id = doc.id as string;

    intercepted.beforeNextBatch(() => plantVersion(store, id, 2));
    calls.length = 0;
    await expect(
      runtime.update({ collection: 'posts', id, data: { title: 'lost' } })
    ).rejects.toBeInstanceOf(ConcurrentModificationError);
    expect(calls).toEqual(['beforeOperation:update', 'beforeValidate', 'beforeChange']);

    calls.length = 0;
    await runtime.update({ collection: 'posts', id, data: { title: 'v3' } });
    expect(calls).toEqual([
      'beforeOperation:update',
      'beforeValidate',
      'beforeChange',
      'afterChange',
      'afterOperation:update'
    ]);
  });
});

describe('retention and deleted owners (spec 062 §9)', () => {
  let runtime: ForgeCmsRuntime;
  let auth: InMemoryAuthAdapter;

  beforeEach(async () => {
    auth = new InMemoryAuthAdapter();
    runtime = runtimeOver(new InMemoryDatabaseAdapter(), [historyCollection('posts')], auth);
    await runtime.syncSchema();
  });

  it('deleting a document keeps its history; trusted reads see it, untrusted reads 404, restore 404s', async () => {
    const doc = await runtime.create({
      collection: 'posts',
      data: { id: 'owner-1', title: 'secret' }
    });
    await runtime.update({ collection: 'posts', id: 'owner-1', data: { title: 'secret 2' } });
    const [latest] = await runtime.listVersions({ collection: 'posts', documentId: 'owner-1' });
    await runtime.delete({ collection: 'posts', id: doc.id as string });

    const orphaned = await runtime.listVersions({ collection: 'posts', documentId: 'owner-1' });
    expect(orphaned.map((v) => v.versionNumber)).toEqual([2, 1]);

    const reader = { id: 'r', email: 'r@example.com', roles: ['admin'] };
    await expect(
      runtime.listVersions({
        collection: 'posts',
        documentId: 'owner-1',
        user: reader,
        overrideAccess: false
      })
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      runtime.getVersion({
        collection: 'posts',
        versionId: latest!.id,
        user: reader,
        overrideAccess: false
      })
    ).rejects.toBeInstanceOf(NotFoundError);

    await expect(
      runtime.restoreVersion({ collection: 'posts', versionId: latest!.id })
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await runtime.listVersions({ collection: 'posts', documentId: 'owner-1' })).toEqual(
      orphaned
    );
  });

  it('re-creating a deleted document id does not adopt its history', async () => {
    await runtime.create({ collection: 'posts', data: { id: 'reused', title: 'secret v1' } });
    await runtime.delete({ collection: 'posts', id: 'reused' });

    const error = await runtime
      .create({ collection: 'posts', data: { id: 'reused', title: 'newcomer' } })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UniqueConstraintError);
    expect((error as UniqueConstraintError).fields).toEqual(['id']);
    expect((error as Error).message).not.toContain('_versions_');

    expect(await runtime.adapters.database.findById('posts', 'reused')).toBeNull();
    const history = await runtime.listVersions({ collection: 'posts', documentId: 'reused' });
    expect(history.map((v) => v.data.title)).toEqual(['secret v1']);
  });
});

describe('manual createVersion (spec 062 §7)', () => {
  it('gives up after a bounded number of attempts with ConcurrentModificationError', async () => {
    const database = new InMemoryDatabaseAdapter();
    const runtime = runtimeOver(database, [historyCollection('posts')]);
    await runtime.syncSchema();
    const doc = await runtime.create({ collection: 'posts', data: { title: 'v1' } });
    const documentId = doc.id as string;

    // Every read of the latest number is stale: someone always took the next one just before.
    let versionCreates = 0;
    const stale = new Proxy(database, {
      get(target, property) {
        if (property === 'create') {
          return (collection: string, data: Record<string, unknown>) => {
            if (collection === '_versions_posts') versionCreates++;
            return target.create(collection, { ...data, versionNumber: 1 });
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      }
    });
    const contended = runtimeOver(stale, [historyCollection('posts')]);
    await contended.syncSchema();

    await expect(
      contended.createVersion({ collection: 'posts', documentId, data: { title: 'v1' } })
    ).rejects.toBeInstanceOf(ConcurrentModificationError);
    expect(versionCreates).toBe(3);
    expect(await runtime.listVersions({ collection: 'posts', documentId })).toHaveLength(1);
  });

  it('stores caller data verbatim and does not require the owner to exist (unchanged)', async () => {
    const runtime = runtimeOver(new InMemoryDatabaseAdapter(), [historyCollection('posts')]);
    await runtime.syncSchema();
    const version = await runtime.createVersion({
      collection: 'posts',
      documentId: 'no-such-document',
      data: { title: 'partial' },
      label: 'checkpoint',
      autosave: true
    });
    expect(version).toMatchObject({
      versionNumber: 1,
      data: { title: 'partial' },
      label: 'checkpoint',
      autosave: true
    });
  });
});

describe('boundaries', () => {
  it('HTTP: a version conflict is a 409 CONCURRENT_MODIFICATION with no internal table name', async () => {
    const auth = new InMemoryAuthAdapter();
    auth.registerSession('admin-token', {
      user: { id: 'admin', email: 'a@example.com', role: 'admin', roles: ['admin'] }
    });
    const store = new InMemoryDatabaseAdapter();
    const intercepted = interceptBatches(store);
    const runtime = runtimeOver(intercepted.database, [historyCollection('posts')], auth);
    await runtime.syncSchema();
    const doc = await runtime.create({ collection: 'posts', data: { title: 'v1' } });
    intercepted.beforeNextBatch(() => plantVersion(store, doc.id as string, 2));

    const response = await handleUpdate(
      {
        request: new Request(`https://forge.test/api/v1/posts/${String(doc.id)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', authorization: 'Bearer admin-token' },
          body: JSON.stringify({ title: 'v2' })
        }),
        env: {},
        params: { collection: 'posts', id: doc.id as string }
      },
      { runtime }
    );
    expect(response.status).toBe(409);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      error: { code: 'CONCURRENT_MODIFICATION', message: expect.any(String) }
    });
    expect(text).not.toContain('_versions_');
  });

  it('non-versioned collections keep their single-write path', async () => {
    const database = new InMemoryDatabaseAdapter();
    let batches = 0;
    const counted = new Proxy(database, {
      get(target, property) {
        if (property === 'atomicWrite') {
          return (...args: Parameters<DatabaseAdapter['atomicWrite']>) => {
            batches++;
            return target.atomicWrite(...args);
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      }
    });
    const runtime = runtimeOver(counted, [
      defineCollection({ slug: 'notes', fields: { title: defineField.text() } })
    ]);
    await runtime.syncSchema();
    const doc = await runtime.create({ collection: 'notes', data: { title: 'a' } });
    await runtime.update({ collection: 'notes', id: doc.id as string, data: { title: 'b' } });
    expect(batches).toBe(0);
  });

  it('the raw relation fallback refuses to write a versioned document without its snapshot', async () => {
    const authors = defineCollection({ slug: 'authors', fields: { name: defineField.text() } });
    const posts = defineCollection({
      slug: 'posts',
      versions: true,
      fields: {
        title: defineField.text({ required: true }),
        author: defineField.relation({ collection: 'authors', onDelete: 'set-null' })
      }
    });
    const runtime = runtimeOver(new InMemoryDatabaseAdapter(), [authors, posts]);
    await runtime.syncSchema();
    const author = await runtime.create({ collection: 'authors', data: { name: 'a' } });
    const post = await runtime.create({
      collection: 'posts',
      data: { title: 't', author: author.id }
    });

    await expect(handleSetNullOnDelete(runtime, authors, author.id as string)).rejects.toThrow(
      /versions enabled/
    );
    expect((await runtime.findByID({ collection: 'posts', id: post.id as string })).author).toBe(
      author.id
    );
  });

  it('syncSchema refuses a versioned collection on an adapter without atomicWrite()', async () => {
    const database = new InMemoryDatabaseAdapter();
    const legacy = new Proxy(database, {
      get(target, property) {
        if (property === 'atomicWrite') return undefined;
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      }
    });
    const runtime = runtimeOver(legacy, [historyCollection('posts')]);
    await expect(runtime.syncSchema()).rejects.toThrow(
      /require a DatabaseAdapter implementing atomicWrite\(\)/
    );
  });
});

// --- upgrading an existing libSQL database (spec 062 §8) ----------------------------------------

describe('upgrading a pre-062 libSQL version table', () => {
  const directory = tempDir.make();
  afterAll(() => tempDir.remove(directory));
  let fileCounter = 0;

  /** The exact table a pre-062 `syncSchema()` created: no `snapshotFormat`, no unique index. */
  async function seedOldTable(url: string, rows: [string, string, number, string][]) {
    const client = createClient({ url });
    await client.execute(
      'CREATE TABLE "posts" ("id" TEXT PRIMARY KEY, "created_at" TEXT, "updated_at" TEXT, "title" TEXT, "body" TEXT, "tag" TEXT)'
    );
    await client.execute(
      'CREATE TABLE "_versions_posts" ("id" TEXT PRIMARY KEY, "created_at" TEXT, "updated_at" TEXT, "documentId" TEXT, "versionNumber" REAL, "data" TEXT, "createdAt" TEXT, "createdBy" TEXT, "autosave" INTEGER, "label" TEXT)'
    );
    await client.execute(
      `INSERT INTO "posts" ("id", "title", "body", "tag") VALUES ('d1', 'current', 'body', 'tag')`
    );
    for (const [id, documentId, versionNumber, data] of rows) {
      await client.execute({
        sql: 'INSERT INTO "_versions_posts" ("id", "documentId", "versionNumber", "data", "createdAt") VALUES (?, ?, ?, ?, ?)',
        args: [id, documentId, versionNumber, data, '2026-01-01T00:00:00.000Z']
      });
    }
    return client;
  }

  it('historical duplicates: syncSchema fails loudly and leaves every row untouched', async () => {
    const url = `file:${directory}/dupes-${++fileCounter}.db`;
    const client = await seedOldTable(url, [
      ['a', 'd1', 1, '{"title":"one"}'],
      ['b', 'd1', 2, '{"title":"two"}'],
      ['c', 'd1', 2, '{"title":"two again"}']
    ]);

    const runtime = runtimeOver(new LibSqlDatabaseAdapter(url).init(), [
      historyCollection('posts')
    ]);
    const error = await runtime.syncSchema().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('"_versions_posts"');
    expect(message).toContain('1 duplicate version identity');
    expect(message).toContain('document "d1" version 2 (2 rows)');
    expect(message).toContain('will not delete, renumber or merge');

    const rows = await client.execute('SELECT "id" FROM "_versions_posts" ORDER BY "id"');
    expect(rows.rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    client.close();
  });

  it('clean history upgrades in place; legacy patch rows stay readable and restore with merge semantics', async () => {
    const url = `file:${directory}/clean-${++fileCounter}.db`;
    const client = await seedOldTable(url, [
      ['a', 'd1', 1, '{"title":"one","body":"old body"}'],
      ['b', 'd1', 2, '{"title":"patched"}']
    ]);

    const runtime = runtimeOver(new LibSqlDatabaseAdapter(url).init(), [
      historyCollection('posts')
    ]);
    await runtime.syncSchema();

    const indexes = await client.execute(`PRAGMA index_list("_versions_posts")`);
    expect(
      indexes.rows.some(
        (r) => r.name === 'idx__versions_posts_documentId_versionNumber' && Number(r.unique) === 1
      )
    ).toBe(true);

    const history = await runtime.listVersions({ collection: 'posts', documentId: 'd1' });
    expect(history.map((v) => v.data)).toEqual([
      { title: 'patched' },
      { title: 'one', body: 'old body' }
    ]);

    // The next update continues the numbering with a full snapshot.
    await runtime.update({ collection: 'posts', id: 'd1', data: { tag: 'new tag' } });
    const [v3] = await runtime.listVersions({ collection: 'posts', documentId: 'd1' });
    expect(v3).toMatchObject({
      versionNumber: 3,
      data: { title: 'current', body: 'body', tag: 'new tag' }
    });

    // A legacy patch restores only what it contains.
    await runtime.restoreVersion({ collection: 'posts', versionId: 'b' });
    const row = await runtime.findByID({ collection: 'posts', id: 'd1' });
    expect({ title: row.title, body: row.body, tag: row.tag }).toEqual({
      title: 'patched',
      body: 'body',
      tag: 'new tag'
    });
    client.close();
  });
});
