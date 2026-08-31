import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { D1DatabaseAdapter } from '../../src/d1.adapter.js';
import { R2StorageAdapter } from '../../src/r2.adapter.js';

/**
 * The real-D1 + real-R2 half of the storage-lifecycle fix (spec 051 §12; InMemory half lives in
 * `packages/runtime/src/operations.test.ts`): deleting an upload-enabled document through the Local
 * API — the same code path any Cloudflare deployment actually runs — removes its R2 object too.
 */
describe('Local API delete cleans up a real R2 storage object (spec 051)', () => {
  const media = defineCollection({
    slug: 'lifecycle_media',
    fields: {
      filename: defineField.text({ required: true }),
      url: defineField.text({ required: true })
    },
    upload: true
  });

  function buildMediaRuntime() {
    const database = new D1DatabaseAdapter();
    const storage = new R2StorageAdapter();
    const runtime = new ForgeCmsRuntime({
      collections: [media],
      adapters: { database, auth: new InMemoryAuthAdapter(), storage },
      env
    });
    // ForgeCmsRuntime.init() initialises every adapter from `config.env` — initialising `database`/
    // `storage` separately beforehand would just get overwritten (and fail, since a bare `.init(env)`
    // call outside the runtime's own `config.env` plumbing has nothing to bind to here).
    runtime.init();
    return { runtime, database, storage };
  }

  it('removes the R2 object when the document is deleted through runtime.delete()', async () => {
    const { runtime, database, storage } = buildMediaRuntime();
    await database.syncSchema([media]);
    await storage.put({
      key: 'lifecycle/real.txt',
      body: new TextEncoder().encode('real r2 lifecycle')
    });

    const doc = await runtime.create({
      collection: 'lifecycle_media',
      // `_storageKey` is a system field, not part of the collection's declared, typed fields.
      data: {
        _storageKey: 'lifecycle/real.txt',
        filename: 'real.txt',
        url: '/api/media/lifecycle/real.txt'
      } as Record<string, unknown>
    });

    expect(await storage.get('lifecycle/real.txt')).not.toBeNull();
    await runtime.delete({ collection: 'lifecycle_media', id: doc.id as string });
    expect(await storage.get('lifecycle/real.txt')).toBeNull();

    // And the document itself is really gone from real D1, not just the object from R2.
    await expect(
      runtime.findByID({ collection: 'lifecycle_media', id: doc.id as string })
    ).rejects.toThrow();
  });
});
