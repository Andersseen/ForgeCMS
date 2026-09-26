import { afterAll, describe, expect, it } from 'vitest';
import { defineCollection, defineField, defineGlobal } from '@forge-cms/core';
import type { CollectionDefinition, GlobalDefinition } from '@forge-cms/core';
import { InMemoryDatabaseAdapter, LibSqlDatabaseAdapter } from '@forge-cms/db';
import type { DatabaseAdapter, DatabaseRecord } from '@forge-cms/db';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from './runtime.js';
import { createUpload } from './operations.js';
import { InvalidInputError } from './errors.js';

// Spec 063 — the system-field mutation boundary, on InMemory and on real on-disk libSQL.

type Data = Record<string, unknown>;

const posts = defineCollection({
  slug: 'posts',
  fields: { title: defineField.text({ required: true }), body: defineField.text() }
});
const drafted = defineCollection({
  slug: 'drafted',
  drafts: true,
  fields: { title: defineField.text({ required: true }) }
});
const media = defineCollection({
  slug: 'media',
  upload: true,
  versions: true,
  fields: { filename: defineField.text({ required: true }), alt: defineField.text() }
});

/** What the `hooked` collection's `beforeChange` hook merges into its output — set per test. */
let injected: Data = {};
const hooked = defineCollection({
  slug: 'hooked',
  fields: { title: defineField.text() },
  hooks: { beforeChange: [({ data }) => ({ ...data, ...injected })] }
});
/** A hook that returns the whole previous document merged with the change — every system key echoes. */
const echoing = defineCollection({
  slug: 'echoing',
  fields: { title: defineField.text() },
  hooks: { beforeChange: [({ data, previousData }) => ({ ...(previousData ?? {}), ...data })] }
});

let injectedGlobal: Data = {};
const settings = defineGlobal({
  slug: 'settings',
  drafts: true,
  fields: { siteName: defineField.text() },
  hooks: { beforeChange: [({ data }) => ({ ...data, ...injectedGlobal })] }
});

const collections: CollectionDefinition[] = [posts, drafted, media, hooked, echoing];
const globals: GlobalDefinition[] = [settings];

const FORGE_OWNED: Data = {
  id: 'chosen-id',
  created_at: '1999-01-01T00:00:00.000Z',
  updated_at: '1999-01-01T00:00:00.000Z',
  _storageKey: 'private/victim.pdf'
};

/** `node:fs`/`node:os` without `@types/node` — same approach as `version-consistency.test.ts`. */
async function loadTempDir() {
  const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as {
    mkdtempSync(prefix: string): string;
    rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
  };
  const os = (await import(/* @vite-ignore */ 'node:os' as string)) as { tmpdir(): string };
  const directory = fs.mkdtempSync(`${os.tmpdir()}/forge-system-fields-`);
  return { directory, remove: () => fs.rmSync(directory, { recursive: true, force: true }) };
}
const temp = await loadTempDir();
afterAll(() => temp.remove());
let fileCounter = 0;

const backends: Array<[string, () => DatabaseAdapter]> = [
  ['InMemoryDatabaseAdapter', () => new InMemoryDatabaseAdapter()],
  [
    'LibSqlDatabaseAdapter (on-disk file)',
    () => new LibSqlDatabaseAdapter(`file:${temp.directory}/db-${++fileCounter}.db`).init()
  ]
];

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected the operation to be rejected');
}

function expectInvalidInput(err: unknown, key: string): void {
  expect(err).toBeInstanceOf(InvalidInputError);
  expect((err as InvalidInputError).code).toBe('INVALID_INPUT');
  expect((err as InvalidInputError).message).toBe(
    `Field '${key}' is managed by Forge and cannot be written`
  );
}

/** A tick long enough that a fresh ISO timestamp differs from one taken before it. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe.each(backends)('%s', (_name, makeDatabase) => {
  async function setup() {
    injected = {};
    injectedGlobal = {};
    const database = makeDatabase();
    const runtime = new ForgeCmsRuntime({
      collections,
      globals,
      adapters: { database, auth: new InMemoryAuthAdapter(), storage: new InMemoryStorageAdapter() }
    });
    runtime.init();
    await runtime.syncSchema();
    const raw = (collection: string, id: string) => database.findById(collection, id);
    return { runtime, database, raw };
  }

  describe('create', () => {
    for (const trusted of [false, true]) {
      for (const key of ['created_at', 'updated_at', '_storageKey']) {
        it(`rejects ${key} (overrideAccess: ${!trusted}) and writes nothing`, async () => {
          const { runtime, database } = await setup();
          const err = await rejection(
            runtime.create({
              collection: 'posts',
              data: { title: 'x', [key]: FORGE_OWNED[key] } as Data,
              overrideAccess: trusted
            })
          );
          expectInvalidInput(err, key);
          expect(await database.count('posts')).toBe(0);
        });
      }
    }

    it('rejects a caller-chosen id when untrusted', async () => {
      const { runtime, database } = await setup();
      const err = await rejection(
        runtime.create({
          collection: 'posts',
          data: { id: 'chosen-id', title: 'x' } as Data,
          overrideAccess: false
        })
      );
      expectInvalidInput(err, 'id');
      expect(await database.count('posts')).toBe(0);
    });

    it('keeps a trusted explicit id (seeds/imports) and still stamps timestamps', async () => {
      const { runtime } = await setup();
      const doc = await runtime.create({
        collection: 'posts',
        data: { id: 'seed-1', title: 'x' } as Data
      });
      expect(doc.id).toBe('seed-1');
      expect(typeof doc.created_at).toBe('string');
      expect(doc.created_at).not.toBe(FORGE_OWNED.created_at);
    });

    it('rejects a trusted explicit id that is not a non-empty string', async () => {
      const { runtime, database } = await setup();
      for (const id of ['', 42]) {
        const err = await rejection(
          runtime.create({ collection: 'posts', data: { id, title: 'x' } as Data })
        );
        expect(err).toBeInstanceOf(InvalidInputError);
      }
      expect(await database.count('posts')).toBe(0);
    });
  });

  describe('update', () => {
    for (const trusted of [false, true]) {
      for (const key of Object.keys(FORGE_OWNED)) {
        it(`rejects a changed ${key} (overrideAccess: ${!trusted}); the row is unchanged`, async () => {
          const { runtime, raw } = await setup();
          const doc = await runtime.create({ collection: 'posts', data: { title: 'before' } });
          const before = await raw('posts', doc.id as string);

          const err = await rejection(
            runtime.update({
              collection: 'posts',
              id: doc.id as string,
              data: { title: 'after', [key]: FORGE_OWNED[key] } as Data,
              overrideAccess: trusted
            })
          );
          expectInvalidInput(err, key);
          expect(await raw('posts', doc.id as string)).toEqual(before);
          if (key === 'id') expect(await raw('posts', 'chosen-id')).toBeNull();
        });
      }
    }

    it('accepts an echo of the whole read document and lets the adapter stamp updated_at', async () => {
      const { runtime } = await setup();
      const doc = await runtime.create({ collection: 'posts', data: { title: 'before' } });
      await tick();

      // Exactly what the admin form used to PATCH: the document it read plus one edit.
      const updated = await runtime.update({
        collection: 'posts',
        id: doc.id as string,
        data: { ...doc, title: 'after' } as Data,
        overrideAccess: false
      });

      expect(updated.title).toBe('after');
      expect(updated.id).toBe(doc.id);
      expect(updated.created_at).toBe(doc.created_at);
      expect(updated.updated_at).not.toBe(doc.updated_at);
    });

    it('treats null as an echo of an absent key', async () => {
      const { runtime } = await setup();
      const doc = await runtime.create({ collection: 'posts', data: { title: 'before' } });
      const updated = await runtime.update({
        collection: 'posts',
        id: doc.id as string,
        data: { title: 'after', _storageKey: null } as Data,
        overrideAccess: false
      });
      expect(updated.title).toBe('after');
    });
  });

  describe('drafts: _status stays lifecycle input', () => {
    it('creates a draft and publishes it, untrusted and trusted', async () => {
      const { runtime } = await setup();
      for (const overrideAccess of [false, true]) {
        const draft = await runtime.create({
          collection: 'drafted',
          data: { title: 'Draft', _status: 'draft' } as Data,
          overrideAccess
        });
        expect(draft._status).toBe('draft');
        const published = await runtime.update({
          collection: 'drafted',
          id: draft.id as string,
          data: { _status: 'published' } as Data,
          overrideAccess
        });
        expect(published._status).toBe('published');
      }
    });
  });

  describe('hooks cannot reintroduce Forge-owned metadata', () => {
    for (const key of Object.keys(FORGE_OWNED)) {
      it(`a beforeChange hook setting ${key} fails the create and the update; nothing is written`, async () => {
        const { runtime, database, raw } = await setup();
        const doc = await runtime.create({ collection: 'hooked', data: { title: 'before' } });
        const before = await raw('hooked', doc.id as string);

        injected = { [key]: FORGE_OWNED[key] };
        const onCreate = await rejection(
          runtime.create({ collection: 'hooked', data: { title: 'x' } })
        );
        const onUpdate = await rejection(
          runtime.update({ collection: 'hooked', id: doc.id as string, data: { title: 'after' } })
        );

        for (const err of [onCreate, onUpdate]) {
          // A server-code bug, not the caller's bad request: a plain Error (500), not INVALID_INPUT.
          expect(err).toBeInstanceOf(Error);
          expect(err).not.toBeInstanceOf(InvalidInputError);
          expect((err as Error).message).toContain(`Forge-owned field '${key}'`);
        }
        expect(await database.count('hooked')).toBe(1);
        expect(await raw('hooked', doc.id as string)).toEqual(before);
      });
    }

    it('a collection beforeValidate hook and an in-place field hook are screened too', async () => {
      const { runtime, database } = await setup();
      const viaBeforeValidate = defineCollection({
        slug: 'hooked',
        fields: { title: defineField.text() },
        hooks: { beforeValidate: [({ data }) => ({ ...data, _storageKey: 'victim' })] }
      });
      const viaFieldHook = defineCollection({
        slug: 'hooked',
        fields: {
          title: defineField.text({
            hooks: {
              beforeChange: [
                ({ value, data }) => {
                  // Field hooks get the document object itself — an in-place write must not stick.
                  (data as Data).created_at = FORGE_OWNED.created_at;
                  return value;
                }
              ]
            }
          })
        }
      });

      for (const [collection, stage] of [
        [viaBeforeValidate, 'beforeValidate'],
        [viaFieldHook, 'beforeChange']
      ] as const) {
        const hookRuntime = new ForgeCmsRuntime({
          collections: [collection],
          adapters: runtime.adapters
        });
        hookRuntime.init();
        const err = await rejection(
          hookRuntime.create({ collection: 'hooked', data: { title: 'x' } })
        );
        expect(err).not.toBeInstanceOf(InvalidInputError);
        expect((err as Error).message).toContain(`${stage} hook on 'hooked'`);
      }
      expect(await database.count('hooked')).toBe(0);
    });

    it('a hook that echoes the previous document (system keys included) still works', async () => {
      const { runtime } = await setup();
      const doc = await runtime.create({ collection: 'echoing', data: { title: 'before' } });
      const updated = await runtime.update({
        collection: 'echoing',
        id: doc.id as string,
        data: { title: 'after' }
      });
      expect(updated.title).toBe('after');
      expect(updated.created_at).toBe(doc.created_at);
    });

    it('hook data never carries a trusted explicit id', async () => {
      const { runtime } = await setup();
      injected = {};
      let seen: Data | undefined;
      const spy = defineCollection({
        slug: 'hooked',
        fields: { title: defineField.text() },
        hooks: {
          beforeChange: [
            ({ data }) => {
              seen = data;
              return data;
            }
          ]
        }
      });
      const spyRuntime = new ForgeCmsRuntime({
        collections: [spy],
        adapters: runtime.adapters
      });
      spyRuntime.init();
      const doc = await spyRuntime.create({
        collection: 'hooked',
        data: { id: 'explicit', title: 'x' } as Data
      });
      expect(doc.id).toBe('explicit');
      expect(seen).toBeDefined();
      expect(seen && 'id' in seen).toBe(false);
    });
  });

  describe('preview follows the same input policy', () => {
    for (const key of ['created_at', 'updated_at', '_storageKey', 'id']) {
      it(`rejects ${key} in a new-document preview (untrusted)`, async () => {
        const { runtime } = await setup();
        const err = await rejection(
          runtime.preview({
            collection: 'posts',
            data: { title: 'x', [key]: FORGE_OWNED[key] } as Data,
            overrideAccess: false
          })
        );
        expectInvalidInput(err, key);
      });

      it(`rejects a changed ${key} in an existing-document preview (trusted)`, async () => {
        const { runtime } = await setup();
        const doc = await runtime.create({ collection: 'posts', data: { title: 'x' } });
        const err = await rejection(
          runtime.preview({
            collection: 'posts',
            id: doc.id as string,
            data: { [key]: FORGE_OWNED[key] } as Data
          })
        );
        expectInvalidInput(err, key);
      });
    }

    it('accepts echoes and _status, returning the stored metadata', async () => {
      const { runtime } = await setup();
      const doc = await runtime.create({ collection: 'drafted', data: { title: 'x' } });
      const previewed = await runtime.preview({
        collection: 'drafted',
        id: doc.id as string,
        data: { ...doc, title: 'y', _status: 'published' } as Data,
        overrideAccess: false,
        user: { id: 'u', role: 'admin' }
      });
      expect(previewed.title).toBe('y');
      expect(previewed._status).toBe('published');
      expect(previewed.created_at).toBe(doc.created_at);
    });
  });

  describe('globals', () => {
    for (const key of Object.keys(FORGE_OWNED)) {
      it(`rejects ${key} on the first write and a changed ${key} later`, async () => {
        const { runtime, raw } = await setup();
        const first = await rejection(
          runtime.updateGlobalDocument({
            global: 'settings',
            data: { siteName: 'x', [key]: FORGE_OWNED[key] }
          })
        );
        expectInvalidInput(first, key);
        expect(await raw('_global_settings', 'global')).toBeNull();

        await runtime.updateGlobalDocument({ global: 'settings', data: { siteName: 'x' } });
        const before = await raw('_global_settings', 'global');
        const later = await rejection(
          runtime.updateGlobalDocument({
            global: 'settings',
            data: { siteName: 'y', [key]: FORGE_OWNED[key] },
            overrideAccess: false
          })
        );
        expectInvalidInput(later, key);
        expect(await raw('_global_settings', 'global')).toEqual(before);
      });
    }

    it('accepts an echo of the read global and keeps _status writable', async () => {
      const { runtime } = await setup();
      const first = await runtime.updateGlobalDocument({
        global: 'settings',
        data: { siteName: 'x' }
      });
      expect(first._status).toBe('draft');
      await tick();
      const second = await runtime.updateGlobalDocument({
        global: 'settings',
        data: { ...first, siteName: 'y', _status: 'published' }
      });
      expect(second.siteName).toBe('y');
      expect(second._status).toBe('published');
      expect(second.id).toBe('global');
      expect(second.created_at).toBe(first.created_at);
    });

    it('a global beforeChange hook cannot set Forge-owned metadata', async () => {
      const { runtime, raw } = await setup();
      injectedGlobal = { created_at: FORGE_OWNED.created_at };
      const err = await rejection(
        runtime.updateGlobalDocument({ global: 'settings', data: { siteName: 'x' } })
      );
      expect(err).not.toBeInstanceOf(InvalidInputError);
      expect(await raw('_global_settings', 'global')).toBeNull();
    });
  });

  describe('versioned upload collection', () => {
    async function uploaded() {
      const ctx = await setup();
      const doc = await createUpload(
        ctx.runtime,
        { collection: 'media', data: { filename: 'a.pdf', alt: 'one' } },
        'media/a.pdf'
      );
      return { ...ctx, doc };
    }

    it('records the Forge-generated key on the row but never in a snapshot', async () => {
      const { runtime, raw, doc } = await uploaded();
      expect((await raw('media', doc.id as string))?._storageKey).toBe('media/a.pdf');
      const [v1] = await runtime.listVersions({
        collection: 'media',
        documentId: doc.id as string
      });
      expect(v1?.data).not.toHaveProperty('_storageKey');
    });

    it('a rejected _storageKey update writes neither the row nor a version', async () => {
      const { runtime, raw, doc } = await uploaded();
      const err = await rejection(
        runtime.update({
          collection: 'media',
          id: doc.id as string,
          data: { alt: 'two', _storageKey: 'private/victim.pdf' } as Data
        })
      );
      expectInvalidInput(err, '_storageKey');
      expect((await raw('media', doc.id as string))?.alt).toBe('one');
      expect(
        await runtime.listVersions({ collection: 'media', documentId: doc.id as string })
      ).toHaveLength(1);
    });

    it('update + restore never change the storage association', async () => {
      const { runtime, raw, doc } = await uploaded();
      await runtime.update({ collection: 'media', id: doc.id as string, data: { alt: 'two' } });
      const versions = await runtime.listVersions({
        collection: 'media',
        documentId: doc.id as string
      });
      const v1 = versions.find((v) => v.versionNumber === 1);
      await runtime.restoreVersion({ collection: 'media', versionId: v1!.id });

      const row = (await raw('media', doc.id as string)) as DatabaseRecord;
      expect(row.alt).toBe('one');
      expect(row._storageKey).toBe('media/a.pdf');
    });
  });
});
