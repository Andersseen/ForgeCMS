import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LibSqlDatabaseAdapter } from '@forge-cms/db';
import { UsersCollectionAuthAdapter, type AuthUser } from '@forge-cms/auth';
import { ForgeCmsRuntime, handleCreate, handleDelete, handleFile } from '@forge-cms/runtime';
import { S3StorageAdapter, type S3StorageAdapterOptions } from '@forge-cms/s3';
import type { PutObjectOptions, StorageAdapter, StorageObject } from '@forge-cms/storage';
import { collections } from '../server/api/collections';

/**
 * Spec 083 (roadmap 0.10 / P02): the complete upload lifecycle of the portable profile — on-disk libSQL +
 * `@forge-cms/s3` + a real Garage service — driven through Forge's own handlers, never through the raw
 * database or S3 for the happy path. Runs through `pnpm test:s3` (scripts/test-s3.mjs), which owns the
 * Garage container and injects `FORGE_S3_TEST_*`; missing configuration is a hard failure, never a skip.
 *
 * The comparable reference is the real D1 + R2 suite (`packages/cloudflare/test/workers/storage-lifecycle.test.ts`).
 * Faults are injected only at one narrow seam each: `database.atomicWrite` for "the document commit fails
 * after the object was stored" and a delegating `StorageAdapter` for "the object delete fails".
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Run this suite through \`pnpm test:s3\`, which starts the Garage service.`
    );
  }
  return value;
}

const s3Options: S3StorageAdapterOptions = {
  bucket: required('FORGE_S3_TEST_BUCKET'),
  region: required('FORGE_S3_TEST_REGION'),
  endpoint: required('FORGE_S3_TEST_ENDPOINT'),
  forcePathStyle: true,
  credentials: {
    accessKeyId: required('FORGE_S3_TEST_ACCESS_KEY_ID'),
    secretAccessKey: required('FORGE_S3_TEST_SECRET_ACCESS_KEY')
  }
};
const SECRET = s3Options.credentials!.secretAccessKey;

/** Delegates to the real S3 adapter; a test can make one operation fail (and restore it). */
class FaultableStorage implements StorageAdapter {
  readonly name = 's3';
  failDelete = false;
  constructor(private readonly inner: StorageAdapter) {}
  init(): this {
    return this;
  }
  put(options: PutObjectOptions): Promise<StorageObject> {
    return this.inner.put(options);
  }
  get(key: string): Promise<StorageObject | null> {
    return this.inner.get(key);
  }
  async delete(key: string): Promise<void> {
    if (this.failDelete) throw new Error('injected: object delete failed');
    return this.inner.delete(key);
  }
  getPublicUrl(key: string): Promise<string> {
    return this.inner.getPublicUrl(key);
  }
  list(prefix?: string): Promise<StorageObject[]> {
    return this.inner.list(prefix);
  }
}

interface Instance {
  database: LibSqlDatabaseAdapter;
  auth: UsersCollectionAuthAdapter;
  storage: FaultableStorage;
  runtime: ForgeCmsRuntime;
}

/** A complete, independent runtime — what a freshly started process builds from the same file + bucket. */
async function startInstance(
  dbUrl: string,
  storage: StorageAdapter = new S3StorageAdapter(s3Options)
): Promise<Instance> {
  const database = new LibSqlDatabaseAdapter(dbUrl).init();
  const auth = new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: database });
  const faultable = new FaultableStorage(storage);
  const runtime = new ForgeCmsRuntime({
    collections,
    adapters: { database, auth, storage: faultable }
  });
  runtime.init();
  await runtime.syncSchema();
  return { database, auth, storage: faultable, runtime };
}

const ORIGIN = 'https://forge.test';
const bytesOf = (text: string) => new TextEncoder().encode(text);

describe('portable upload lifecycle — on-disk libSQL + @forge-cms/s3 + Garage (spec 083)', () => {
  let dir: string;
  let dbUrl: string;
  let app: Instance;
  let admin: { user: AuthUser; token: string };
  let editor: { user: AuthUser; token: string };

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  async function upload(
    instance: Instance,
    file: { name: string; type: string; body: Uint8Array | string },
    fields: Record<string, string> = {},
    options: { token?: string; limits?: { maxFileSize?: number; mimeTypes?: string[] } } = {}
  ): Promise<Response> {
    const form = new FormData();
    form.set('file', new File([file.body as BlobPart], file.name, { type: file.type }));
    for (const [name, value] of Object.entries(fields)) form.set(name, value);
    return handleCreate(
      {
        request: new Request(`${ORIGIN}/api/v1/media`, {
          method: 'POST',
          body: form,
          headers: bearer(options.token ?? admin.token)
        }),
        params: { collection: 'media' },
        env: undefined
      },
      { runtime: instance.runtime, ...(options.limits && { upload: options.limits }) }
    );
  }

  async function created(response: Response): Promise<Record<string, unknown>> {
    expect(response.status).toBe(201);
    return ((await response.json()) as { data: Record<string, unknown> }).data;
  }

  /** The URL a document advertises, requested through `handleFile` exactly as the mounted route would. */
  function serve(instance: Instance, url: string, token?: string): Promise<Response> {
    const key = url.replace(/^\/api\/media\//, '');
    return handleFile(
      {
        request: new Request(`${ORIGIN}${url}`, { headers: token ? bearer(token) : {} }),
        params: { key },
        env: undefined
      },
      { runtime: instance.runtime }
    );
  }

  const intents = (instance: Instance) =>
    instance.database.findMany({ collection: '_forge_storage_intents' });
  const objectKeys = async (instance: Instance) =>
    (await instance.storage.list('media/')).map((object) => object.key).sort();
  const storedKey = async (instance: Instance, id: string) =>
    (await instance.database.findById('media', id))?._storageKey as string;

  beforeAll(async () => {
    // Garage needs a moment after its port opens before the default bucket/key are usable.
    const probe = new S3StorageAdapter(s3Options);
    let last: unknown;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        await probe.list(`readiness-${crypto.randomUUID()}/`);
        last = undefined;
        break;
      } catch (err) {
        last = err;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    if (last) throw last;

    // A real on-disk database file (not `file::memory:`): the restart tests reopen exactly this file.
    dir = mkdtempSync(join(tmpdir(), 'forge-portable-storage-'));
    dbUrl = `file:${join(dir, 'forge.db')}`;
    app = await startInstance(dbUrl);

    const owner = await app.auth.createUser({ email: 'owner@tiny.test', password: 'password123' });
    const staff = await app.auth.createUser({
      email: 'editor@tiny.test',
      password: 'password123',
      role: 'editor'
    });
    if (!owner.ok || !staff.ok) throw new Error('could not create the fixture users');
    admin = { user: owner.user, token: owner.token };
    editor = { user: staff.user, token: staff.token };
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  describe('successful upload and access-checked serving', () => {
    const payload = Uint8Array.from([0, 1, 2, 254, 255, 10, 13, 0, 42]);
    let publicDoc: Record<string, unknown>;
    let privateDoc: Record<string, unknown>;

    it('stores the bytes in S3, the document in libSQL, and leaves no storage intent', async () => {
      publicDoc = await created(
        await upload(
          app,
          { name: 'logo.bin', type: 'application/octet-stream', body: payload },
          { alt: 'A logo', visibility: 'public' }
        )
      );
      privateDoc = await created(
        await upload(
          app,
          { name: 'private note.txt', type: 'text/plain', body: 'staff only' },
          { visibility: 'private' },
          { token: editor.token }
        )
      );

      const key = await storedKey(app, publicDoc['id'] as string);
      expect(key).toMatch(/^media\/[0-9a-f-]{36}-logo\.bin$/);
      expect(publicDoc).toMatchObject({
        filename: 'logo.bin',
        contentType: 'application/octet-stream',
        filesize: payload.byteLength,
        alt: 'A logo',
        visibility: 'public'
      });
      expect(publicDoc['url']).toBe(`/api/media/${key}`);

      const stored = await new S3StorageAdapter(s3Options).get(key);
      expect([...new Uint8Array(stored!.body!)]).toEqual([...payload]);
      expect(stored!.contentType).toBe('application/octet-stream');

      expect(await intents(app)).toHaveLength(0);
      // A filename with a space round-trips through the percent-encoded URL.
      expect(privateDoc['url']).toMatch(/^\/api\/media\/media\/[0-9a-f-]{36}-private%20note\.txt$/);
    });

    it('serves a public file anonymously with the exact bytes, type and public caching', async () => {
      const response = await serve(app, publicDoc['url'] as string);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/octet-stream');
      expect(response.headers.get('cache-control')).toBe('public, max-age=60');
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...payload]);
    });

    it('serves an authenticated caller privately, never through a shared cache', async () => {
      const response = await serve(app, publicDoc['url'] as string, admin.token);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    });

    it('keeps a private file invisible anonymously and readable by staff', async () => {
      const anonymous = await serve(app, privateDoc['url'] as string);
      expect(anonymous.status).toBe(404);
      expect(anonymous.headers.get('cache-control')).toBe('no-store');

      const staff = await serve(app, privateDoc['url'] as string, admin.token);
      expect(staff.status).toBe(200);
      expect(await staff.text()).toBe('staff only');
      expect(staff.headers.get('cache-control')).toBe('private, no-store');
    });

    it('does not serve an object that exists in the bucket but belongs to no document', async () => {
      const key = `media/${crypto.randomUUID()}-stray.txt`;
      await new S3StorageAdapter(s3Options).put({
        key,
        body: bytesOf('stray'),
        contentType: 'text/plain'
      });
      try {
        for (const token of [undefined, admin.token]) {
          const response = await serve(app, `/api/media/${key}`, token);
          expect(response.status).toBe(404);
        }
      } finally {
        await new S3StorageAdapter(s3Options).delete(key);
      }
    });

    it('rejects an anonymous upload, and stores nothing', async () => {
      const before = await objectKeys(app);
      const form = new FormData();
      form.set('file', new File(['x'], 'x.txt', { type: 'text/plain' }));
      const response = await handleCreate(
        {
          request: new Request(`${ORIGIN}/api/v1/media`, { method: 'POST', body: form }),
          params: { collection: 'media' },
          env: undefined
        },
        { runtime: app.runtime }
      );
      expect(response.status).toBe(401);
      expect(await objectKeys(app)).toEqual(before);
    });
  });

  describe('validation parity with the R2 profile', () => {
    const limits = { maxFileSize: 16, mimeTypes: ['text/plain'] };

    it('refuses an unsupported MIME type and an oversized file before anything is stored', async () => {
      const before = await objectKeys(app);

      const wrongType = await upload(
        app,
        { name: 'a.png', type: 'image/png', body: 'png' },
        {},
        { limits }
      );
      expect(wrongType.status).toBe(400);

      const tooBig = await upload(
        app,
        { name: 'big.txt', type: 'text/plain', body: 'x'.repeat(17) },
        {},
        { limits }
      );
      expect(tooBig.status).toBe(400);

      const noFile = await handleCreate(
        {
          request: new Request(`${ORIGIN}/api/v1/media`, {
            method: 'POST',
            body: (() => {
              const form = new FormData();
              form.set('file', 'not a file');
              form.set('alt', 'x');
              return form;
            })(),
            headers: bearer(admin.token)
          }),
          params: { collection: 'media' },
          env: undefined
        },
        { runtime: app.runtime, upload: limits }
      );
      expect(noFile.status).toBe(400);

      expect(await objectKeys(app)).toEqual(before);
      expect(await intents(app)).toHaveLength(0);
    });

    it('compensates a validation failure that happens after the object was stored', async () => {
      const before = await objectKeys(app);
      const response = await upload(
        app,
        { name: 'late.txt', type: 'text/plain', body: 'late' },
        { visibility: 'not-a-visibility' }
      );
      expect(response.status).toBe(400);
      expect(await objectKeys(app)).toEqual(before);
      expect(await intents(app)).toHaveLength(0);
      expect(await app.database.count('media', {})).toBe(2);
    });
  });

  describe('database failure after the object was stored', () => {
    /** Fails the one batch that creates the owning media document, once the object is already in S3. */
    function failDocumentCommit(instance: Instance): () => void {
      const original = instance.database.atomicWrite.bind(instance.database);
      instance.database.atomicWrite = (async (operations) => {
        if (operations.some((op) => op.type === 'create' && op.collection === 'media')) {
          throw new Error('injected: database commit failed');
        }
        return original(operations);
      }) as typeof instance.database.atomicWrite;
      return () => {
        instance.database.atomicWrite = original;
      };
    }

    it('removes the object again when storage is healthy: no row, no object, no intent', async () => {
      const before = await objectKeys(app);
      const restore = failDocumentCommit(app);
      try {
        const response = await upload(app, {
          name: 'doomed.txt',
          type: 'text/plain',
          body: 'doomed'
        });
        expect(response.status).toBe(500);
      } finally {
        restore();
      }
      expect(await objectKeys(app)).toEqual(before);
      expect(await intents(app)).toHaveLength(0);
      expect(await app.database.count('media', { filename: 'doomed.txt' })).toBe(0);
    });

    it('keeps a durable delete intent when the cleanup fails too, and reconciliation removes the orphan', async () => {
      const before = await objectKeys(app);
      const restore = failDocumentCommit(app);
      app.storage.failDelete = true;
      try {
        const response = await upload(app, {
          name: 'orphan.txt',
          type: 'text/plain',
          body: 'orphan'
        });
        expect(response.status).toBe(500);
      } finally {
        restore();
        app.storage.failDelete = false;
      }

      // The object is temporarily orphaned in S3 — and the libSQL row that remembers it is durable.
      const orphans = (await objectKeys(app)).filter((key) => !before.includes(key));
      expect(orphans).toHaveLength(1);
      expect(await app.database.count('media', { filename: 'orphan.txt' })).toBe(0);
      const remaining = await intents(app);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toMatchObject({
        key: orphans[0],
        reason: 'delete',
        collection: 'media'
      });

      const report = await app.runtime.reconcileStorage();
      expect(report.deleted).toEqual(orphans);
      expect(report.failed).toEqual([]);
      expect(await objectKeys(app)).toEqual(before);
      expect(await intents(app)).toHaveLength(0);
    });
  });

  describe('delete lifecycle', () => {
    it('deleting a document removes its object and leaves no intent', async () => {
      const doc = await created(
        await upload(app, { name: 'gone.txt', type: 'text/plain', body: 'bye' })
      );
      const key = await storedKey(app, doc['id'] as string);
      expect(await app.storage.get(key)).not.toBeNull();

      const response = await handleDelete(
        {
          request: new Request(`${ORIGIN}/api/v1/media/${doc['id']}`, {
            method: 'DELETE',
            headers: bearer(admin.token)
          }),
          params: { collection: 'media', id: doc['id'] as string },
          env: undefined
        },
        { runtime: app.runtime }
      );
      expect(response.status).toBe(204);

      expect(await app.database.findById('media', doc['id'] as string)).toBeNull();
      expect(await app.storage.get(key)).toBeNull();
      expect(await intents(app)).toHaveLength(0);
      expect((await serve(app, doc['url'] as string, admin.token)).status).toBe(404);
    });

    it('a failed object delete keeps a durable intent; reconciliation finishes it, idempotently', async () => {
      const doc = await created(
        await upload(app, { name: 'stuck.txt', type: 'text/plain', body: 'stuck' })
      );
      const key = await storedKey(app, doc['id'] as string);

      app.storage.failDelete = true;
      try {
        await app.runtime.delete({ collection: 'media', id: doc['id'] as string });
      } finally {
        app.storage.failDelete = false;
      }
      // No cross-store transaction: the document is gone while the object survives, remembered by an intent.
      expect(await app.database.findById('media', doc['id'] as string)).toBeNull();
      expect(await app.storage.get(key)).not.toBeNull();
      expect(await intents(app)).toMatchObject([{ key, reason: 'delete', collection: 'media' }]);
      expect((await serve(app, doc['url'] as string, admin.token)).status).toBe(404);

      const report = await app.runtime.reconcileStorage();
      expect(report).toMatchObject({ deleted: [key], kept: [], failed: [] });
      expect(await app.storage.get(key)).toBeNull();
      expect(await intents(app)).toHaveLength(0);

      const again = await app.runtime.reconcileStorage();
      expect(again).toEqual({ deleted: [], kept: [], pending: 0, failed: [] });
    });
  });

  describe('reconciliation safety', () => {
    it('never deletes an owned object because of a stale intent', async () => {
      const doc = await created(
        await upload(app, { name: 'owned.txt', type: 'text/plain', body: 'owned' })
      );
      const key = await storedKey(app, doc['id'] as string);
      await app.database.create('_forge_storage_intents', {
        key,
        reason: 'delete',
        collection: 'media'
      });

      const report = await app.runtime.reconcileStorage();
      expect(report).toMatchObject({ deleted: [], kept: [key], failed: [] });
      expect(await app.storage.get(key)).not.toBeNull();
      expect((await serve(app, doc['url'] as string, admin.token)).status).toBe(200);
      expect(await intents(app)).toHaveLength(0);

      await app.runtime.delete({ collection: 'media', id: doc['id'] as string });
    });

    it('leaves a young upload intent alone (grace period), then removes the abandoned object', async () => {
      const key = `media/${crypto.randomUUID()}-abandoned.txt`;
      await app.storage.put({ key, body: bytesOf('abandoned'), contentType: 'text/plain' });
      await app.database.create('_forge_storage_intents', {
        key,
        reason: 'upload',
        collection: 'media'
      });

      expect(await app.runtime.reconcileStorage()).toMatchObject({ pending: 1, deleted: [] });
      expect(await app.storage.get(key)).not.toBeNull();

      const later = new Date(Date.now() + 2 * 60 * 60 * 1000);
      expect(await app.runtime.reconcileStorage({ now: later })).toMatchObject({ deleted: [key] });
      expect(await app.storage.get(key)).toBeNull();
      expect(await intents(app)).toHaveLength(0);
    });

    it('keeps the intent when the object delete fails, with a message free of provider secrets', async () => {
      const key = `media/${crypto.randomUUID()}-unlucky.txt`;
      await app.storage.put({ key, body: bytesOf('unlucky'), contentType: 'text/plain' });
      await app.database.create('_forge_storage_intents', {
        key,
        reason: 'delete',
        collection: 'media'
      });

      app.storage.failDelete = true;
      try {
        const report = await app.runtime.reconcileStorage();
        expect(report.failed).toEqual([{ key, error: 'injected: object delete failed' }]);
      } finally {
        app.storage.failDelete = false;
      }
      expect(await intents(app)).toMatchObject([{ key, reason: 'delete' }]);

      expect(await app.runtime.reconcileStorage()).toMatchObject({ deleted: [key] });
      expect(await intents(app)).toHaveLength(0);
    });
  });

  describe('missing object versus storage outage', () => {
    it('answers 404 for an owned document whose object is missing from the bucket', async () => {
      const doc = await created(
        await upload(app, { name: 'lost.txt', type: 'text/plain', body: 'lost' })
      );
      await new S3StorageAdapter(s3Options).delete(await storedKey(app, doc['id'] as string));

      const response = await serve(app, doc['url'] as string, admin.token);
      expect(response.status).toBe(404);
      await app.runtime.delete({ collection: 'media', id: doc['id'] as string });
    });

    it('answers a generic 500 when S3 is unreachable or refuses the credentials, leaking nothing', async () => {
      const doc = await created(
        await upload(app, { name: 'outage.txt', type: 'text/plain', body: 'out' })
      );
      const goodKey = await storedKey(app, doc['id'] as string);

      const unreachable = new S3StorageAdapter({ ...s3Options, endpoint: 'http://127.0.0.1:1' });
      const forbidden = new S3StorageAdapter({
        ...s3Options,
        credentials: {
          accessKeyId: s3Options.credentials!.accessKeyId,
          secretAccessKey: 'wrong-secret'
        }
      });
      for (const broken of [unreachable, forbidden]) {
        const other = await startInstance(dbUrl, broken);
        const response = await serve(other, doc['url'] as string, admin.token);
        expect(response.status).toBe(500);
        const body = await response.text();
        expect(JSON.parse(body)).toEqual({ error: 'Failed to read file' });
        for (const secret of [SECRET, s3Options.bucket, s3Options.endpoint!, goodKey]) {
          expect(body).not.toContain(secret);
        }
      }

      // The same outage during reconciliation: the report carries messages only, and the intent survives.
      const down = await startInstance(dbUrl, unreachable);
      await app.runtime.delete({ collection: 'media', id: doc['id'] as string });
      await app.database.create('_forge_storage_intents', {
        key: goodKey,
        reason: 'delete',
        collection: 'media'
      });
      const report = await down.runtime.reconcileStorage();
      expect(report.failed).toHaveLength(1);
      expect(typeof report.failed[0]!.error).toBe('string');
      expect(JSON.stringify(report)).not.toContain(SECRET);
      expect(await intents(down)).toHaveLength(1);
      await app.runtime.reconcileStorage();
      expect(await intents(app)).toHaveLength(0);
    }, 60_000);
  });

  describe('restart persistence', () => {
    it('a brand-new runtime on the same database file and bucket serves and deletes persisted files', async () => {
      const body = Uint8Array.from([7, 7, 7, 0, 255]);
      const publicDoc = await created(
        await upload(
          app,
          { name: 'persist.bin', type: 'application/octet-stream', body },
          { visibility: 'public' }
        )
      );
      const privateDoc = await created(
        await upload(
          app,
          { name: 'persist-private.txt', type: 'text/plain', body: 'secret file' },
          { visibility: 'private' }
        )
      );
      const key = await storedKey(app, publicDoc['id'] as string);
      const before = await objectKeys(app);

      // Nothing is shared with the first instance: a new database client, auth, S3 client and runtime.
      const restarted = await startInstance(dbUrl);
      expect(restarted.runtime).not.toBe(app.runtime);

      const doc = await restarted.runtime.findByID({
        collection: 'media',
        id: publicDoc['id'] as string,
        overrideAccess: false,
        user: null
      });
      expect(doc).toMatchObject({ filename: 'persist.bin', filesize: body.byteLength });

      const anonymous = await serve(restarted, publicDoc['url'] as string);
      expect([...new Uint8Array(await anonymous.arrayBuffer())]).toEqual([...body]);
      expect((await serve(restarted, privateDoc['url'] as string)).status).toBe(404);

      // Sessions are signed with the same secret, so the original token still authenticates.
      const session = await restarted.auth.validateSession(admin.token);
      expect(session).not.toBeNull();
      const staff = await serve(restarted, privateDoc['url'] as string, admin.token);
      expect(await staff.text()).toBe('secret file');
      expect(await objectKeys(restarted)).toEqual(before);

      await restarted.runtime.delete({ collection: 'media', id: publicDoc['id'] as string });
      expect(await restarted.storage.get(key)).toBeNull();
      expect(await intents(restarted)).toHaveLength(0);
      await restarted.runtime.delete({ collection: 'media', id: privateDoc['id'] as string });
    });
  });
});
