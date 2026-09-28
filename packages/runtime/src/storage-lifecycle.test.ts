import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import type { CollectionDefinition } from '@forge-cms/core';
import { InMemoryDatabaseAdapter, LibSqlDatabaseAdapter } from '@forge-cms/db';
import type { DatabaseAdapter } from '@forge-cms/db';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from './runtime.js';
import { handleCreate } from './handlers.js';
import { handleFile } from './files.js';
import { createUpload } from './operations.js';
import {
  STORAGE_INTENTS_COLLECTION,
  recordUploadIntent,
  settleFailedUpload
} from './storage-intents.js';

// Spec 067 — durable storage-cleanup intents and access-checked file reads.

const media = defineCollection({
  slug: 'media',
  upload: true,
  drafts: true,
  access: {
    read: ({ user }) => (user ? { owner: user.id } : { visibility: 'public' }),
    create: () => true,
    delete: () => true
  },
  fields: {
    filename: defineField.text(),
    url: defineField.text(),
    owner: defineField.text(),
    visibility: defineField.text(),
    alt: defineField.text({ required: true })
  }
});

async function setup(
  collections: CollectionDefinition[] = [media],
  database: DatabaseAdapter = new InMemoryDatabaseAdapter()
) {
  const storage = new InMemoryStorageAdapter();
  const auth = new InMemoryAuthAdapter();
  auth.registerSession('alice', { user: { id: 'alice', role: 'editor' } });
  auth.registerSession('bob', { user: { id: 'bob', role: 'editor' } });
  const runtime = new ForgeCmsRuntime({ collections, adapters: { database, auth, storage } });
  runtime.init();
  await runtime.syncSchema();
  const intents = () => database.findMany({ collection: STORAGE_INTENTS_COLLECTION });
  const objects = async () => (await storage.list()).map((o) => o.key);
  const upload = async (fields: Record<string, string>, token = 'alice') => {
    const body = new FormData();
    body.set('file', new File(['secret-bytes'], 'a.txt', { type: 'text/plain' }));
    for (const [name, value] of Object.entries(fields)) body.set(name, value);
    return handleCreate(
      {
        request: new Request('http://x/api/v1/media', {
          method: 'POST',
          body,
          headers: { authorization: `Bearer ${token}` }
        }),
        params: { collection: 'media' },
        env: undefined
      },
      { runtime }
    );
  };
  const file = (key: string, token?: string) =>
    handleFile(
      {
        request: new Request('http://x/api/media/x', {
          ...(token !== undefined && { headers: { authorization: `Bearer ${token}` } })
        }),
        params: { key },
        env: undefined
      },
      { runtime }
    );
  return { database, storage, runtime, intents, objects, upload, file };
}

const failingDelete = () => {
  throw new Error('bucket unavailable (x-amz-secret: do-not-log)');
};

describe('durable storage intents (spec 067)', () => {
  it('a successful upload leaves no intent behind', async () => {
    const { upload, intents, objects } = await setup();
    const response = await upload({ alt: 'a', owner: 'alice' });
    expect(response.status).toBe(201);
    expect(await intents()).toEqual([]);
    expect(await objects()).toHaveLength(1);
  });

  it('a failed create whose cleanup also fails leaves an intent; reconciliation deletes the object', async () => {
    const { storage, runtime, upload, intents, objects } = await setup();
    const original = storage.delete.bind(storage);
    storage.delete = failingDelete;

    // Pre-fix: the object stayed in storage with nothing recording it.
    const response = await upload({ owner: 'alice' }); // `alt` is required → validation fails
    expect(response.status).toBe(400);
    expect(await objects()).toHaveLength(1);
    // The cleanup claimed the upload intent, failed to delete the object, and put back a `delete` intent:
    // the document can no longer commit, so no grace period applies.
    expect(await intents()).toMatchObject([{ reason: 'delete', collection: 'media' }]);

    storage.delete = original;
    const report = await runtime.reconcileStorage();
    expect(report.deleted).toHaveLength(1);
    expect(await objects()).toEqual([]);
    expect(await intents()).toEqual([]);
  });

  it('a process that dies between storing the object and committing the document is recovered', async () => {
    const { database, storage, runtime, intents, objects } = await setup();
    // What handleCreate had done when the process died: the intent, then the object — no document.
    await recordUploadIntent(database, 'media', 'media/crashed.txt');
    await storage.put({ key: 'media/crashed.txt', body: new TextEncoder().encode('x') });

    const later = new Date(Date.now() + 2 * 60 * 60 * 1000);
    expect((await runtime.reconcileStorage({ now: later })).deleted).toEqual(['media/crashed.txt']);
    expect(await objects()).toEqual([]);
    expect(await intents()).toEqual([]);
  });

  it('an upload whose intent reconciliation already claimed is not created, so nothing dangles', async () => {
    const { database, storage, runtime, objects } = await setup();
    const key = 'media/late.txt';
    const intentId = await recordUploadIntent(database, 'media', key);
    await storage.put({ key, body: new TextEncoder().encode('x') });
    await runtime.reconcileStorage({ uploadGraceMs: 0 });

    await expect(
      createUpload(
        runtime,
        { collection: 'media', data: { alt: 'a' } },
        { storageKey: key, intentId }
      )
    ).rejects.toMatchObject({ code: 'CONCURRENT_MODIFICATION' });
    expect(await database.findMany({ collection: 'media' })).toEqual([]);
    expect(await objects()).toEqual([]);
  });

  it('a delete whose object delete fails keeps a deletion intent; reconciliation finishes it', async () => {
    const { storage, runtime, upload, intents, objects } = await setup();
    const doc = (
      (await (await upload({ alt: 'a', owner: 'alice' })).json()) as { data: { id: string } }
    ).data;
    const original = storage.delete.bind(storage);
    storage.delete = failingDelete;

    // Pre-fix: document gone, object left in storage, only a log line.
    await runtime.delete({ collection: 'media', id: doc.id });
    expect(await objects()).toHaveLength(1);
    expect(await intents()).toMatchObject([{ reason: 'delete' }]);

    expect((await runtime.reconcileStorage()).failed).toEqual([
      { key: expect.any(String), error: expect.stringContaining('bucket unavailable') }
    ]);
    expect(await intents()).toHaveLength(1); // put back for the next run

    storage.delete = original;
    expect((await runtime.reconcileStorage()).deleted).toHaveLength(1);
    expect(await objects()).toEqual([]);
    expect(await intents()).toEqual([]);
  });

  it('a normal delete removes the object and leaves no intent', async () => {
    const { runtime, upload, intents, objects } = await setup();
    const doc = (
      (await (await upload({ alt: 'a', owner: 'alice' })).json()) as { data: { id: string } }
    ).data;
    await runtime.delete({ collection: 'media', id: doc.id });
    expect(await objects()).toEqual([]);
    expect(await intents()).toEqual([]);
  });

  it('never deletes an object a document owns, even from a stale intent', async () => {
    const { database, runtime, upload, objects } = await setup();
    const doc = (
      (await (await upload({ alt: 'a', owner: 'alice' })).json()) as {
        data: { id: string };
      }
    ).data;
    const row = await database.findById('media', doc.id);
    await database.create(STORAGE_INTENTS_COLLECTION, {
      key: row?._storageKey,
      reason: 'delete',
      collection: 'media'
    });

    const report = await runtime.reconcileStorage();
    expect(report.kept).toEqual([row?._storageKey]);
    expect(await objects()).toEqual([row?._storageKey]);
  });

  it('counts deletion intents against the atomic batch limit', async () => {
    const owners = defineCollection({ slug: 'owners', fields: { name: defineField.text() } });
    const files = defineCollection({
      slug: 'files',
      upload: true,
      fields: {
        owner: defineField.relation({ collection: 'owners', onDelete: 'cascade' }),
        filename: defineField.text()
      }
    });
    const { database, runtime } = await setup([owners, files]);
    const owner = await runtime.create({ collection: 'owners', data: { name: 'o' } });
    // 12 cascaded upload documents: 1 root + 12 deletes + 12 intents + 1 assertion > 25.
    for (let i = 0; i < 12; i++) {
      await database.create('files', { owner: owner.id, _storageKey: `files/${i}` });
    }
    await expect(runtime.delete({ collection: 'owners', id: owner.id as string })).rejects.toThrow(
      /storage-cleanup records/
    );
    expect(await database.findMany({ collection: 'files' })).toHaveLength(12);
  });
});

describe('storage intents — review follow-ups (spec 067)', () => {
  it('a failed object put is settled: no intent, no object', async () => {
    const { storage, upload, intents, objects } = await setup();
    storage.put = () => Promise.reject(new Error('bucket full'));
    const response = await upload({ alt: 'a', owner: 'alice' });
    expect(response.status).toBe(500);
    expect(await intents()).toEqual([]);
    expect(await objects()).toEqual([]);
  });

  it('a failure after the document committed keeps its object', async () => {
    const media2 = defineCollection({
      ...media,
      hooks: {
        afterRead: [
          () => {
            throw new Error('afterRead failed');
          }
        ]
      }
    });
    const { database, upload, intents, objects } = await setup([media2]);
    const response = await upload({ alt: 'a', owner: 'alice' });
    expect(response.status).toBeGreaterThanOrEqual(400);
    const [doc] = await database.findMany({ collection: 'media' });
    expect(doc?._storageKey).toBeDefined();
    expect(await objects()).toEqual([doc?._storageKey]);
    expect(await intents()).toEqual([]);
  });

  it('cleanup never deletes an object whose intent it cannot claim', async () => {
    const { database, storage, runtime, objects } = await setup();
    const key = 'media/claimed-elsewhere.txt';
    const intentId = await recordUploadIntent(database, 'media', key);
    await storage.put({ key, body: new TextEncoder().encode('x') });
    await database.delete(STORAGE_INTENTS_COLLECTION, intentId); // e.g. the document batch committed

    await settleFailedUpload(runtime, intentId, key);
    expect(await objects()).toEqual([key]);
  });

  it('two reconcilers racing on the same intents act on each exactly once', async () => {
    const { database, storage, runtime, intents } = await setup();
    let deletes = 0;
    const original = storage.delete.bind(storage);
    storage.delete = async (key) => {
      deletes++;
      return original(key);
    };
    for (let i = 0; i < 5; i++) {
      await recordUploadIntent(database, 'media', `media/crash-${i}.txt`);
    }
    const [a, b] = await Promise.all([
      runtime.reconcileStorage({ uploadGraceMs: 0 }),
      runtime.reconcileStorage({ uploadGraceMs: 0 })
    ]);
    expect(a.deleted.length + b.deleted.length).toBe(5);
    expect(deletes).toBe(5);
    expect(await intents()).toEqual([]);
  });

  it('a failing ownership lookup keeps the intent and does not abort the run', async () => {
    const { database, runtime, intents } = await setup();
    await recordUploadIntent(database, 'media', 'media/one.txt');
    await recordUploadIntent(database, 'media', 'media/two.txt');
    const findMany = database.findMany.bind(database);
    let failures = 1;
    database.findMany = (options) => {
      if (options.collection === 'media' && failures-- > 0) {
        return Promise.reject(new Error('db down'));
      }
      return findMany(options);
    };

    const report = await runtime.reconcileStorage({ uploadGraceMs: 0 });
    expect(report.failed).toEqual([{ key: 'media/one.txt', error: 'db down' }]);
    expect(report.deleted).toEqual(['media/two.txt']);
    expect((await intents()).map((intent) => intent.key)).toEqual(['media/one.txt']);

    expect((await runtime.reconcileStorage({ uploadGraceMs: 0 })).deleted).toEqual([
      'media/one.txt'
    ]);
  });
});

describe('handleFile enforces the owning document’s read access (spec 067)', () => {
  it('serves a file only to callers who may read its document', async () => {
    const { upload, file, database } = await setup();
    const doc = (
      (await (await upload({ alt: 'a', owner: 'alice' })).json()) as {
        data: { id: string };
      }
    ).data;
    const key = (await database.findById('media', doc.id))?._storageKey as string;

    // Pre-fix: an anonymous caller got 200 and the bytes.
    expect((await file(key)).status).toBe(404);
    expect((await file(key, 'bob')).status).toBe(404);
    const own = await file(key, 'alice');
    expect(own.status).toBe(200);
    expect(await own.text()).toBe('secret-bytes');
    expect(own.headers.get('cache-control')).toBe('private, no-store');
  });

  it('serves a publicly readable, published document’s file to anyone, with a public cache header', async () => {
    const { upload, file, database, runtime } = await setup();
    const doc = (
      (await (await upload({ alt: 'a', owner: 'alice', visibility: 'public' })).json()) as {
        data: { id: string };
      }
    ).data;
    const key = (await database.findById('media', doc.id))?._storageKey as string;
    await runtime.update({ collection: 'media', id: doc.id, data: { _status: 'published' } });

    const response = await file(key);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
  });

  it('hides a draft document’s file from anonymous callers', async () => {
    const { upload, file, database } = await setup();
    const doc = (
      (await (await upload({ alt: 'a', owner: 'alice', visibility: 'public' })).json()) as {
        data: { id: string };
      }
    ).data;
    const key = (await database.findById('media', doc.id))?._storageKey as string;
    expect((await file(key)).status).toBe(404);
  });

  it('404s a key no document owns — including a real object outside Forge', async () => {
    const { storage, file } = await setup();
    await storage.put({ key: 'media/stray.txt', body: new TextEncoder().encode('x') });
    await storage.put({ key: 'backups/db.sqlite', body: new TextEncoder().encode('x') });
    // Pre-fix: both were served with 200.
    expect((await file('media/stray.txt')).status).toBe(404);
    expect((await file('backups/db.sqlite')).status).toBe(404);
  });

  it('rejects a malformed key and never caches an error response', async () => {
    const { file } = await setup();
    expect((await file('media/%E0%A4%A.txt')).status).toBe(400);
    const missing = await file('media/nothing.txt');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('no-store');
  });

  it('never returns a storage error message to the client', async () => {
    const { storage, upload, file, database, runtime } = await setup();
    const doc = (
      (await (await upload({ alt: 'a', owner: 'alice', visibility: 'public' })).json()) as {
        data: { id: string };
      }
    ).data;
    const key = (await database.findById('media', doc.id))?._storageKey as string;
    await runtime.update({ collection: 'media', id: doc.id, data: { _status: 'published' } });
    storage.get = () => {
      throw new Error('R2 bucket forge-prod credentials rejected');
    };
    const response = await file(key);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toMatch(/forge-prod|credentials/);
  });
});

describe('durable storage intents on on-disk libSQL (spec 067)', () => {
  it('a delete whose object delete fails leaves an intent row; reconciliation finishes it', async () => {
    const url = `file:${(await import(/* @vite-ignore */ 'node:os' as string)).tmpdir()}/forge-intents-${Date.now()}.db`;
    const { storage, runtime, upload, intents, objects } = await setup(
      [media],
      new LibSqlDatabaseAdapter(url).init()
    );
    const doc = (
      (await (await upload({ alt: 'a', owner: 'alice' })).json()) as {
        data: { id: string };
      }
    ).data;
    expect(await intents()).toEqual([]);

    const original = storage.delete.bind(storage);
    storage.delete = failingDelete;
    await runtime.delete({ collection: 'media', id: doc.id });
    expect(await intents()).toMatchObject([{ reason: 'delete', collection: 'media' }]);

    storage.delete = original;
    expect((await runtime.reconcileStorage()).deleted).toHaveLength(1);
    expect(await objects()).toEqual([]);
    expect(await intents()).toEqual([]);
  });
});
