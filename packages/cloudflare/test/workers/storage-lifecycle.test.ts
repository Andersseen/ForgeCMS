import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import {
  ForgeCmsRuntime,
  handleCreate,
  handleDelete,
  handleUpdate,
  InvalidInputError
} from '@forge-cms/runtime';
import { D1DatabaseAdapter } from '../../src/d1.adapter.js';
import { R2StorageAdapter } from '../../src/r2.adapter.js';

/**
 * The real-D1 + real-R2 half of the storage lifecycle (spec 051 §12; InMemory half lives in
 * `packages/runtime/src/operations.test.ts`) and of the spec 063 system-field boundary: deleting an
 * upload-enabled document removes exactly its own R2 object, and no caller can repoint which object
 * that is.
 */
describe('upload storage lifecycle on real D1 + R2 (specs 051, 063)', () => {
  const media = defineCollection({
    slug: 'lifecycle_media',
    fields: {
      filename: defineField.text({ required: true }),
      url: defineField.text({ required: true }),
      contentType: defineField.text(),
      filesize: defineField.number(),
      alt: defineField.text()
    },
    upload: true,
    access: { read: () => true, create: () => true, update: () => true, delete: () => true }
  });
  const notes = defineCollection({
    slug: 'lifecycle_notes',
    fields: { title: defineField.text({ required: true }) }
  });

  async function buildRuntime() {
    const database = new D1DatabaseAdapter();
    const storage = new R2StorageAdapter();
    const auth = new InMemoryAuthAdapter();
    auth.registerSession('editor-token', {
      user: { id: 'editor-1', email: 'editor@example.com', role: 'editor' }
    });
    const runtime = new ForgeCmsRuntime({
      collections: [media, notes],
      adapters: { database, auth, storage },
      env
    });
    // ForgeCmsRuntime.init() initialises every adapter from `config.env` — initialising `database`/
    // `storage` separately beforehand would just get overwritten.
    runtime.init();
    await database.syncSchema([media, notes]);
    return { runtime, database, storage };
  }

  const headers = { authorization: 'Bearer editor-token' };

  function jsonRequest(method: string, id: string, body?: unknown) {
    return {
      request: new Request(`https://forge.test/api/v1/lifecycle_media/${id}`, {
        method,
        headers: { ...headers, 'content-type': 'application/json' },
        ...(body !== undefined && { body: JSON.stringify(body) })
      }),
      env,
      params: { collection: 'lifecycle_media', id }
    };
  }

  async function upload(runtime: ForgeCmsRuntime, name: string) {
    const form = new FormData();
    form.set('file', new File([`contents of ${name}`], name, { type: 'text/plain' }));
    form.set('_storageKey', 'spoofed/key.txt');
    const response = await handleCreate(
      {
        request: new Request('https://forge.test/api/v1/lifecycle_media', {
          method: 'POST',
          body: form,
          headers
        }),
        env,
        params: { collection: 'lifecycle_media' }
      },
      { runtime }
    );
    expect(response.status).toBe(201);
    return ((await response.json()) as { data: { id: string } }).data;
  }

  it('removes the R2 object when the document is deleted through runtime.delete()', async () => {
    const { runtime, database, storage } = await buildRuntime();
    const doc = await upload(runtime, 'real.txt');
    const key = (await database.findById('lifecycle_media', doc.id))?._storageKey as string;

    expect(key).toMatch(/^lifecycle_media\/[0-9a-f-]{36}-real\.txt$/);
    expect(await storage.get(key)).not.toBeNull();
    await runtime.delete({ collection: 'lifecycle_media', id: doc.id });
    expect(await storage.get(key)).toBeNull();

    // And the document itself is really gone from real D1, not just the object from R2.
    await expect(runtime.findByID({ collection: 'lifecycle_media', id: doc.id })).rejects.toThrow();
  });

  it('spec 063: PATCH { _storageKey: <B> } is refused and deleting A leaves B’s R2 object alone', async () => {
    const { runtime, database, storage } = await buildRuntime();
    const a = await upload(runtime, 'a.txt');
    const b = await upload(runtime, 'victim.txt');
    const aKey = (await database.findById('lifecycle_media', a.id))?._storageKey as string;
    const bBefore = await database.findById('lifecycle_media', b.id);
    const bKey = bBefore?._storageKey as string;

    const patch = await handleUpdate(jsonRequest('PATCH', a.id, { _storageKey: bKey }), {
      runtime
    });
    expect(patch.status).toBe(400);
    expect(((await patch.json()) as { error: { code: string } }).error.code).toBe('INVALID_INPUT');
    expect((await database.findById('lifecycle_media', a.id))?._storageKey).toBe(aKey);

    expect((await handleDelete(jsonRequest('DELETE', a.id), { runtime })).status).toBe(204);
    expect(await storage.get(aKey)).toBeNull();
    expect(await storage.get(bKey)).not.toBeNull();
    expect(await database.findById('lifecycle_media', b.id)).toEqual(bBefore);
  });

  it('spec 063: timestamps and id are Forge-owned on D1; an echoed read document still bumps updated_at', async () => {
    const { runtime, database } = await buildRuntime();
    const forged = '1999-01-01T00:00:00.000Z';

    for (const key of ['created_at', 'updated_at', '_storageKey']) {
      await expect(
        runtime.create({
          collection: 'lifecycle_notes',
          data: { title: 'x', [key]: forged } as Record<string, unknown>
        })
      ).rejects.toThrow(InvalidInputError);
    }
    await expect(
      runtime.create({
        collection: 'lifecycle_notes',
        data: { id: 'chosen', title: 'x' } as Record<string, unknown>,
        overrideAccess: false
      })
    ).rejects.toThrow(InvalidInputError);

    const doc = await runtime.create({ collection: 'lifecycle_notes', data: { title: 'before' } });
    for (const key of ['id', 'created_at', 'updated_at']) {
      await expect(
        runtime.update({
          collection: 'lifecycle_notes',
          id: doc.id as string,
          data: { [key]: forged } as Record<string, unknown>
        })
      ).rejects.toThrow(InvalidInputError);
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
    const updated = await runtime.update({
      collection: 'lifecycle_notes',
      id: doc.id as string,
      data: { ...doc, title: 'after' } as Record<string, unknown>,
      overrideAccess: false
    });
    const row = await database.findById('lifecycle_notes', doc.id as string);
    expect(updated.title).toBe('after');
    expect(row?.created_at).toBe(doc.created_at);
    expect(row?.updated_at).not.toBe(doc.updated_at);
  });
});
