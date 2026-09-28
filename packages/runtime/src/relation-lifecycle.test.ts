import { afterAll, describe, expect, it, vi } from 'vitest';
import { defineCollection, defineField, defineGlobal } from '@forge-cms/core';
import type { CollectionDefinition, GlobalDefinition } from '@forge-cms/core';
import { InMemoryDatabaseAdapter, LibSqlDatabaseAdapter } from '@forge-cms/db';
import type { AtomicWriteOperation, DatabaseAdapter } from '@forge-cms/db';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import {
  relationLifecycleCollections,
  runRelationLifecycleContractTests
} from '@forge-cms/testing/contracts';
import { createClient } from '@libsql/client';
import { ForgeCmsRuntime } from './runtime.js';
import { ConcurrentModificationError, InvalidInputError } from './errors.js';
import { handleCreate, handleDelete } from './handlers.js';
import { findOrphanedDocuments } from './relation-integrity.js';
import { validateRelationSchema } from './relation-lifecycle.js';

// Spec 064 — relation lifecycle consistency.

type Row = Record<string, unknown>;

function runtimeOver(
  database: DatabaseAdapter,
  collections: CollectionDefinition[],
  options: {
    globals?: GlobalDefinition[];
    auth?: InMemoryAuthAdapter;
    storage?: InMemoryStorageAdapter;
  } = {}
): ForgeCmsRuntime {
  const runtime = new ForgeCmsRuntime({
    collections,
    ...(options.globals !== undefined && { globals: options.globals }),
    adapters: {
      database,
      auth: options.auth ?? new InMemoryAuthAdapter(),
      storage: options.storage ?? new InMemoryStorageAdapter()
    }
  });
  runtime.init();
  return runtime;
}

async function setup(
  collections: CollectionDefinition[],
  options: Parameters<typeof runtimeOver>[2] = {}
) {
  const database = new InMemoryDatabaseAdapter();
  const runtime = runtimeOver(database, collections, options);
  await runtime.syncSchema();
  const exists = async (collection: string, id: unknown) =>
    (await database.findById(collection, id as string)) !== null;
  const row = (collection: string, id: unknown) => database.findById(collection, id as string);
  return { runtime, database, exists, row };
}

/** Records every `atomicWrite` batch a database receives, and can run an action right before the next one. */
function observeBatches(database: DatabaseAdapter) {
  const batches: AtomicWriteOperation[][] = [];
  let pending: (() => Promise<unknown>) | undefined;
  const proxied = new Proxy(database, {
    get(target, property) {
      if (property === 'atomicWrite') {
        return async (operations: AtomicWriteOperation[]) => {
          batches.push([...operations]);
          const next = pending;
          pending = undefined;
          if (next) await next();
          return target.atomicWrite(operations);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
    }
  });
  return {
    database: proxied,
    batches,
    beforeNextBatch(action: () => Promise<unknown>) {
      pending = action;
    }
  };
}

async function rejection(promise: Promise<unknown>): Promise<Error & { code?: string }> {
  try {
    await promise;
  } catch (error) {
    return error as Error & { code?: string };
  }
  throw new Error('expected the operation to reject, but it succeeded');
}

// A tiny on-disk temp-dir helper (the runtime package has no Node types in its tsconfig).
const tempDir = await (async () => {
  const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as {
    mkdtempSync(prefix: string): string;
    rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
  };
  const os = (await import(/* @vite-ignore */ 'node:os' as string)) as { tmpdir(): string };
  return {
    make: () => fs.mkdtempSync(`${os.tmpdir()}/forge-relations-`),
    remove: (path: string) => fs.rmSync(path, { recursive: true, force: true })
  };
})();

// --- fixtures ---------------------------------------------------------------------------------------

const authors = defineCollection({
  slug: 'authors',
  fields: { name: defineField.text({ required: true }) }
});

function blogCollections(commentHooks: CollectionDefinition['hooks'] = {}) {
  return [
    authors,
    defineCollection({
      slug: 'posts',
      fields: {
        title: defineField.text({ required: true }),
        author: defineField.relation({ collection: 'authors', onDelete: 'cascade' })
      }
    }),
    defineCollection({
      slug: 'comments',
      fields: {
        text: defineField.text({ required: true }),
        post: defineField.relation({ collection: 'posts', onDelete: 'cascade' })
      },
      hooks: commentHooks
    })
  ];
}

// --- pre-fix reproductions (all failed on main before this spec) -----------------------------------

describe('pre-fix reproductions (spec 064)', () => {
  it('a late dependent hook failure leaves every row in place (was: first post deleted)', async () => {
    const { runtime, exists } = await setup(
      blogCollections({
        beforeDelete: [
          ({ doc }) => {
            if (doc.text === 'boom') throw new Error('comment hook failed');
          }
        ]
      })
    );
    const a = await runtime.create({ collection: 'authors', data: { name: 'A' } });
    const p1 = await runtime.create({ collection: 'posts', data: { title: 'P1', author: a.id } });
    const p2 = await runtime.create({ collection: 'posts', data: { title: 'P2', author: a.id } });
    const c = await runtime.create({ collection: 'comments', data: { text: 'boom', post: p2.id } });

    const error = await rejection(runtime.delete({ collection: 'authors', id: a.id as string }));
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toBe('comment hook failed');

    expect(await exists('authors', a.id)).toBe(true);
    expect(await exists('posts', p1.id)).toBe(true);
    expect(await exists('posts', p2.id)).toBe(true);
    expect(await exists('comments', c.id)).toBe(true);
  });

  it('references in an upload field, a group and a global no longer dangle silently', async () => {
    const media = defineCollection({
      slug: 'media',
      upload: true,
      fields: { filename: defineField.text() }
    });
    const articles = defineCollection({
      slug: 'articles',
      fields: { title: defineField.text(), hero: defineField.upload({ collection: 'media' }) }
    });
    const settings = defineGlobal({
      slug: 'settings',
      fields: { owner: defineField.relation({ collection: 'authors' }) }
    });
    const { runtime, exists } = await setup([authors, media, articles], { globals: [settings] });
    const m = await runtime.create({ collection: 'media', data: { filename: 'a.png' } });
    const owner = await runtime.create({ collection: 'authors', data: { name: 'Owner' } });
    await runtime.create({ collection: 'articles', data: { title: 't', hero: m.id } });
    await runtime.updateGlobalDocument({ global: 'settings', data: { owner: owner.id } });

    await expect(runtime.delete({ collection: 'media', id: m.id as string })).rejects.toThrow(
      /referenced by 1 document\(s\) in 'articles'/
    );
    await expect(runtime.delete({ collection: 'authors', id: owner.id as string })).rejects.toThrow(
      /referenced by global 'settings'/
    );
    expect(await exists('media', m.id)).toBe(true);
    expect(await exists('authors', owner.id)).toBe(true);

    // A missing target used to be accepted outright.
    await expect(
      runtime.create({ collection: 'articles', data: { title: 'x', hero: 'no-such-media' } })
    ).rejects.toThrow(
      /'hero' references a document that does not exist in 'media': 'no-such-media'/
    );

    // A reference inside a group is refused at startup instead of being ignored on delete.
    expect(() =>
      runtimeOver(new InMemoryDatabaseAdapter(), [
        authors,
        defineCollection({
          slug: 'nested',
          fields: {
            meta: defineField.group({
              fields: { author: defineField.relation({ collection: 'authors' }) }
            })
          }
        })
      ])
    ).toThrow(/field 'meta\.author' is a relation\/upload inside a group field/);
  });
});

// --- startup validation (spec 064 §2) ---------------------------------------------------------------

describe('startup validation of reference shapes', () => {
  const managedAuth = () =>
    Object.assign(new InMemoryAuthAdapter(), {
      managesCollection: (slug: string) => slug === 'members',
      // Claims to enforce the user-delete guard (spec 065); a stub that did not is refused at startup.
      setManagedDeleteGuard: () => true
    });
  const members = defineCollection({ slug: 'members', fields: { email: defineField.email() } });

  it.each([
    [
      'a localized relation',
      [
        authors,
        defineCollection({
          slug: 'x',
          locales: ['en', 'es'],
          fields: { a: defineField.relation({ collection: 'authors', localized: true }) }
        })
      ],
      /field 'a' is a localized relation\/upload/
    ],
    [
      'a localized upload',
      [
        authors,
        defineCollection({ slug: 'm', upload: true, fields: { f: defineField.text() } }),
        defineCollection({
          slug: 'x',
          fields: { a: defineField.upload({ collection: 'm', localized: true }) }
        })
      ],
      /field 'a' is a localized relation\/upload/
    ],
    [
      'a relation in an array',
      [
        authors,
        defineCollection({
          slug: 'x',
          fields: {
            rows: defineField.array({
              fields: { a: defineField.relation({ collection: 'authors' }) }
            })
          }
        })
      ],
      /field 'rows\.a' is a relation\/upload inside a array field/
    ],
    [
      'an upload in a block',
      [
        authors,
        defineCollection({ slug: 'm', upload: true, fields: { f: defineField.text() } }),
        defineCollection({
          slug: 'x',
          fields: {
            layout: defineField.blocks({
              blocks: [{ slug: 'hero', fields: { image: defineField.upload({ collection: 'm' }) } }]
            })
          }
        })
      ],
      /field 'layout\.image' is a relation\/upload inside a blocks field/
    ],
    [
      'a relation two composites deep',
      [
        authors,
        defineCollection({
          slug: 'x',
          fields: {
            g: defineField.group({
              fields: {
                rows: defineField.array({
                  fields: { a: defineField.relation({ collection: 'authors' }) }
                })
              }
            })
          }
        })
      ],
      /field 'g\.rows\.a'/
    ],
    [
      'a relation to an unregistered collection',
      [
        defineCollection({
          slug: 'x',
          fields: { a: defineField.relation({ collection: 'ghosts' }) }
        })
      ],
      /references collection 'ghosts', which is not registered/
    ]
  ])('rejects %s', (_label, collections, message) => {
    expect(() => runtimeOver(new InMemoryDatabaseAdapter(), collections)).toThrow(message);
  });

  it('rejects a global relation with onDelete other than restrict', () => {
    const global = defineGlobal({
      slug: 'settings',
      fields: { owner: defineField.relation({ collection: 'authors', onDelete: 'set-null' }) }
    });
    expect(() =>
      runtimeOver(new InMemoryDatabaseAdapter(), [authors], { globals: [global] })
    ).toThrow(/Global 'settings': field 'owner' sets onDelete 'set-null'/);
  });

  it('rejects cascade / set-null onto an auth-managed target, but accepts restrict', () => {
    const posts = (onDelete?: 'cascade' | 'set-null') =>
      defineCollection({
        slug: 'posts',
        fields: {
          author: defineField.relation({
            collection: 'members',
            ...(onDelete !== undefined && { onDelete })
          })
        }
      });
    expect(() =>
      runtimeOver(new InMemoryDatabaseAdapter(), [members, posts('cascade')], {
        auth: managedAuth()
      })
    ).toThrow(/managed by the configured auth adapter/);
    expect(() =>
      runtimeOver(new InMemoryDatabaseAdapter(), [members, posts()], { auth: managedAuth() })
    ).not.toThrow();
  });

  it('reports every problem at once and accepts every supported shape', () => {
    const errors = validateRelationSchema([
      defineCollection({
        slug: 'x',
        fields: {
          ok: defineField.relation({ collection: 'x', many: true, onDelete: 'set-null' }),
          bad1: defineField.relation({ collection: 'nope' }),
          bad2: defineField.group({ fields: { a: defineField.relation({ collection: 'x' }) } })
        }
      })
    ]);
    expect(errors).toHaveLength(2);
    expect(validateRelationSchema(blogCollections())).toEqual([]);
  });
});

// --- delete matrix (spec 064 §1/§5) -----------------------------------------------------------------

describe('delete: restrict, cascade, set-null', () => {
  it('restrict: rejected before any write, both documents remain', async () => {
    const { runtime, database, exists } = await setup([
      authors,
      defineCollection({
        slug: 'books',
        fields: {
          title: defineField.text(),
          author: defineField.relation({ collection: 'authors' })
        }
      })
    ]);
    const spy = vi.spyOn(database, 'atomicWrite');
    const a = await runtime.create({ collection: 'authors', data: { name: 'A' } });
    const b = await runtime.create({ collection: 'books', data: { title: 'B', author: a.id } });
    spy.mockClear();

    const error = await rejection(runtime.delete({ collection: 'authors', id: a.id as string }));
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.message).toMatch(/referenced by 1 document\(s\) in 'books'/);
    expect(spy).not.toHaveBeenCalled();
    expect(await exists('authors', a.id)).toBe(true);
    expect(await exists('books', b.id)).toBe(true);
  });

  it('cascade A ← B ← C: one batch removes all three', async () => {
    const { runtime, database, exists } = await setup(blogCollections());
    const spy = vi.spyOn(database, 'atomicWrite');
    const a = await runtime.create({ collection: 'authors', data: { name: 'A' } });
    const p = await runtime.create({ collection: 'posts', data: { title: 'P', author: a.id } });
    const c = await runtime.create({ collection: 'comments', data: { text: 'C', post: p.id } });
    spy.mockClear();

    await runtime.delete({ collection: 'authors', id: a.id as string });

    expect(spy).toHaveBeenCalledTimes(1);
    const ops = spy.mock.calls[0]![0];
    expect(ops.map((o) => o.type)).toEqual([
      'deleteIf',
      'deleteIf',
      'delete',
      'assertCount',
      'assertCount'
    ]);
    expect(await exists('authors', a.id)).toBe(false);
    expect(await exists('posts', p.id)).toBe(false);
    expect(await exists('comments', c.id)).toBe(false);
  });

  it('a set-null dependent whose beforeChange hook fails: zero mutation', async () => {
    const { runtime, exists, row } = await setup([
      authors,
      defineCollection({
        slug: 'posts',
        fields: { author: defineField.relation({ collection: 'authors', onDelete: 'cascade' }) }
      }),
      defineCollection({
        slug: 'notes',
        fields: { author: defineField.relation({ collection: 'authors', onDelete: 'set-null' }) },
        hooks: {
          beforeChange: [
            () => {
              throw new Error('notes are frozen');
            }
          ]
        }
      })
    ]);
    const a = await runtime.create({ collection: 'authors', data: { name: 'A' } });
    const p = await runtime.create({ collection: 'posts', data: { author: a.id } });
    // Seeded raw so the frozen hook does not refuse the fixture itself.
    await runtime.adapters.database.create('notes', { id: 'n1', author: a.id });

    await expect(runtime.delete({ collection: 'authors', id: a.id as string })).rejects.toThrow(
      'notes are frozen'
    );
    expect(await exists('authors', a.id)).toBe(true);
    expect(await exists('posts', p.id)).toBe(true);
    expect((await row('notes', 'n1'))?.author).toBe(a.id);
  });

  it('set-null clears a single reference and removes the id from a many array', async () => {
    const { runtime, row } = await setup([
      authors,
      defineCollection({
        slug: 'notes',
        fields: {
          author: defineField.relation({ collection: 'authors', onDelete: 'set-null' }),
          watchers: defineField.relation({
            collection: 'authors',
            many: true,
            onDelete: 'set-null'
          })
        }
      })
    ]);
    const [x, t, y] = await Promise.all(
      ['X', 'T', 'Y'].map((name) => runtime.create({ collection: 'authors', data: { name } }))
    );
    const note = await runtime.create({
      collection: 'notes',
      data: { author: t!.id, watchers: [x!.id, t!.id, y!.id] }
    });

    await runtime.delete({ collection: 'authors', id: t!.id as string });

    expect(await row('notes', note.id)).toMatchObject({ author: null, watchers: [x!.id, y!.id] });
    expect(await row('authors', t!.id)).toBeNull();
  });

  it('required set-null is rejected before any hook or write', async () => {
    const beforeDelete = vi.fn();
    const { runtime, database, exists } = await setup([
      defineCollection({
        slug: 'teams',
        fields: { name: defineField.text() },
        hooks: { beforeDelete: [beforeDelete] }
      }),
      defineCollection({
        slug: 'members',
        fields: {
          team: defineField.relation({ collection: 'teams', required: true, onDelete: 'set-null' })
        }
      })
    ]);
    const spy = vi.spyOn(database, 'atomicWrite');
    const team = await runtime.create({ collection: 'teams', data: { name: 'T' } });
    await runtime.create({ collection: 'members', data: { team: team.id } });
    spy.mockClear();

    await expect(runtime.delete({ collection: 'teams', id: team.id as string })).rejects.toThrow(
      /required and configured 'onDelete: set-null'/
    );
    expect(beforeDelete).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    expect(await exists('teams', team.id)).toBe(true);
  });

  it('self relation pointing at itself: set-null does not update the row being deleted', async () => {
    const { runtime, database, exists } = await setup([
      defineCollection({
        slug: 'nodes',
        fields: { next: defineField.relation({ collection: 'nodes', onDelete: 'set-null' }) }
      })
    ]);
    const n = await runtime.create({ collection: 'nodes', data: {} });
    await runtime.update({ collection: 'nodes', id: n.id as string, data: { next: n.id } });
    const spy = vi.spyOn(database, 'atomicWrite');

    await runtime.delete({ collection: 'nodes', id: n.id as string });

    expect(spy.mock.calls[0]![0].map((o) => o.type)).toEqual(['delete', 'assertCount']);
    expect(await exists('nodes', n.id)).toBe(false);
  });

  it('a cascade cycle terminates, deletes each document once and runs each hook once', async () => {
    const deleted: string[] = [];
    const hooks = { afterDelete: [({ doc }: { doc: Row }) => void deleted.push(doc.id as string)] };
    const { runtime, exists } = await setup([
      defineCollection({
        slug: 'cycle_a',
        fields: { b: defineField.relation({ collection: 'cycle_b', onDelete: 'cascade' }) },
        hooks
      }),
      defineCollection({
        slug: 'cycle_b',
        fields: { a: defineField.relation({ collection: 'cycle_a', onDelete: 'cascade' }) },
        hooks
      })
    ]);
    const a = await runtime.create({ collection: 'cycle_a', data: {} });
    const b = await runtime.create({ collection: 'cycle_b', data: { a: a.id } });
    await runtime.update({ collection: 'cycle_a', id: a.id as string, data: { b: b.id } });

    await runtime.delete({ collection: 'cycle_a', id: a.id as string });

    expect(await exists('cycle_a', a.id)).toBe(false);
    expect(await exists('cycle_b', b.id)).toBe(false);
    expect(deleted.sort()).toEqual([a.id, b.id].sort());
  });

  it('a diamond schedules the shared dependent once', async () => {
    const beforeDelete = vi.fn();
    const { runtime, database, exists } = await setup([
      defineCollection({ slug: 'roots', fields: { name: defineField.text() } }),
      defineCollection({
        slug: 'left',
        fields: { root: defineField.relation({ collection: 'roots', onDelete: 'cascade' }) }
      }),
      defineCollection({
        slug: 'right',
        fields: { root: defineField.relation({ collection: 'roots', onDelete: 'cascade' }) }
      }),
      defineCollection({
        slug: 'leaves',
        fields: {
          left: defineField.relation({ collection: 'left', onDelete: 'cascade' }),
          right: defineField.relation({ collection: 'right', onDelete: 'cascade' })
        },
        hooks: { beforeDelete: [beforeDelete] }
      })
    ]);
    const root = await runtime.create({ collection: 'roots', data: {} });
    const l = await runtime.create({ collection: 'left', data: { root: root.id } });
    const r = await runtime.create({ collection: 'right', data: { root: root.id } });
    const leaf = await runtime.create({ collection: 'leaves', data: { left: l.id, right: r.id } });
    const spy = vi.spyOn(database, 'atomicWrite');

    await runtime.delete({ collection: 'roots', id: root.id as string });

    expect(beforeDelete).toHaveBeenCalledTimes(1);
    const leafDeletes = spy.mock.calls[0]![0].filter(
      (o) => o.type === 'deleteIf' && o.collection === 'leaves'
    );
    expect(leafDeletes).toHaveLength(1);
    expect(await exists('leaves', leaf.id)).toBe(false);
  });

  it('restrict is judged on the final state: a referrer deleted in the same plan does not block', async () => {
    const { runtime, exists } = await setup([
      authors,
      defineCollection({
        slug: 'posts',
        fields: { author: defineField.relation({ collection: 'authors', onDelete: 'cascade' }) }
      }),
      defineCollection({
        slug: 'reviews',
        fields: {
          // Restricts deleting the post … but is itself cascade-deleted with the author.
          post: defineField.relation({ collection: 'posts' }),
          author: defineField.relation({ collection: 'authors', onDelete: 'cascade' })
        }
      })
    ]);
    const a = await runtime.create({ collection: 'authors', data: { name: 'A' } });
    const other = await runtime.create({ collection: 'authors', data: { name: 'O' } });
    const p = await runtime.create({ collection: 'posts', data: { author: a.id } });
    const own = await runtime.create({ collection: 'reviews', data: { post: p.id, author: a.id } });

    await runtime.delete({ collection: 'authors', id: a.id as string });
    expect(await exists('posts', p.id)).toBe(false);
    expect(await exists('reviews', own.id)).toBe(false);

    // A surviving restrict referrer (someone else's review of the post) still blocks.
    const p2 = await runtime.create({ collection: 'posts', data: { author: other.id } });
    await runtime.create({ collection: 'reviews', data: { post: p2.id } });
    await expect(runtime.delete({ collection: 'authors', id: other.id as string })).rejects.toThrow(
      /Cannot delete document '.+' from 'posts': referenced by 1 document\(s\) in 'reviews'/
    );
    expect(await exists('authors', other.id)).toBe(true);
    expect(await exists('posts', p2.id)).toBe(true);
  });

  it('an auth-managed dependent is rejected before any hook or write', async () => {
    const beforeDelete = vi.fn();
    const auth = Object.assign(new InMemoryAuthAdapter(), {
      managesCollection: (slug: string) => slug === 'members'
    });
    const { runtime, database, exists } = await setup(
      [
        defineCollection({
          slug: 'teams',
          fields: { name: defineField.text() },
          hooks: { beforeDelete: [beforeDelete] }
        }),
        defineCollection({
          slug: 'members',
          fields: { team: defineField.relation({ collection: 'teams', onDelete: 'cascade' }) }
        })
      ],
      { auth }
    );
    const team = await runtime.create({ collection: 'teams', data: { name: 'T' } });
    await database.create('members', { id: 'm1', team: team.id });
    const spy = vi.spyOn(database, 'atomicWrite');

    await expect(runtime.delete({ collection: 'teams', id: team.id as string })).rejects.toThrow(
      /managed by the configured auth adapter/
    );
    expect(beforeDelete).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    expect(await exists('members', 'm1')).toBe(true);
  });

  it('an oversized cascade is refused before any hook and any write, never chunked', async () => {
    const beforeDelete = vi.fn();
    const { runtime, database } = await setup([
      defineCollection({
        slug: 'authors',
        fields: { name: defineField.text() },
        hooks: { beforeDelete: [beforeDelete] }
      }),
      defineCollection({
        slug: 'threads',
        fields: { author: defineField.relation({ collection: 'authors', onDelete: 'cascade' }) },
        hooks: { beforeDelete: [beforeDelete] }
      })
    ]);
    const a = await runtime.create({ collection: 'authors', data: { name: 'A' } });
    for (let i = 0; i < 25; i++) {
      await runtime.create({ collection: 'threads', data: { author: a.id } });
    }
    const spy = vi.spyOn(database, 'atomicWrite');

    const error = await rejection(runtime.delete({ collection: 'authors', id: a.id as string }));
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.message).toMatch(/more than 25 database operations/);
    expect(beforeDelete).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    expect(await database.count('threads')).toBe(25);
    expect(await database.count('authors')).toBe(1);

    // One fewer fits: 24 cascades + the root + one reference assertion = 26 > 25 — still refused;
    // 23 cascades fit exactly.
    const threads = await database.findMany({ collection: 'threads' });
    for (const t of threads.slice(0, 2)) await database.delete('threads', t.id as string);
    await runtime.delete({ collection: 'authors', id: a.id as string });
    expect(await database.count('threads')).toBe(0);
  });
});

// --- versions and uploads (spec 064 §5, spec 062/063) -----------------------------------------------

describe('delete: versioned and upload-enabled dependents', () => {
  it('a versioned set-null dependent gets exactly one matching snapshot, in the same batch', async () => {
    const { runtime, database } = await setup([
      authors,
      defineCollection({
        slug: 'notes',
        versions: true,
        fields: {
          body: defineField.text(),
          author: defineField.relation({ collection: 'authors', onDelete: 'set-null' })
        }
      })
    ]);
    const a = await runtime.create({ collection: 'authors', data: { name: 'A' } });
    const note = await runtime.create({ collection: 'notes', data: { body: 'b', author: a.id } });
    const spy = vi.spyOn(database, 'atomicWrite');

    await runtime.delete({ collection: 'authors', id: a.id as string });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].map((o) => `${o.type}:${o.collection}`)).toEqual([
      'update:notes',
      'create:_versions_notes',
      'delete:authors',
      'assertCount:notes'
    ]);
    const history = await runtime.listVersions({
      collection: 'notes',
      documentId: note.id as string
    });
    expect(history.map((v) => v.versionNumber)).toEqual([2, 1]);
    expect(history[0]!.data).toMatchObject({ body: 'b', author: null });
    expect(
      (await runtime.findByID({ collection: 'notes', id: note.id as string })).author
    ).toBeNull();
  });

  it('a versioned cascade-deleted dependent keeps its history (spec 062 §9)', async () => {
    const { runtime, database } = await setup([
      authors,
      defineCollection({
        slug: 'drafts',
        versions: true,
        fields: { author: defineField.relation({ collection: 'authors', onDelete: 'cascade' }) }
      })
    ]);
    const a = await runtime.create({ collection: 'authors', data: { name: 'A' } });
    const d = await runtime.create({ collection: 'drafts', data: { author: a.id } });

    await runtime.delete({ collection: 'authors', id: a.id as string });

    expect(await database.findById('drafts', d.id as string)).toBeNull();
    expect(await database.count('_versions_drafts', { documentId: d.id })).toBe(1);
  });

  it('a cascaded upload document is deleted atomically, then its own _storageKey is cleaned up', async () => {
    const storage = new InMemoryStorageAdapter();
    const { runtime, database, exists } = await setup(
      [
        authors,
        defineCollection({
          slug: 'media',
          upload: true,
          fields: {
            filename: defineField.text(),
            owner: defineField.relation({ collection: 'authors', onDelete: 'cascade' })
          }
        }),
        defineCollection({
          slug: 'articles',
          fields: {
            hero: defineField.upload({ collection: 'media' }),
            author: defineField.relation({ collection: 'authors', onDelete: 'cascade' })
          }
        })
      ],
      { storage }
    );
    const a = await runtime.create({ collection: 'authors', data: { name: 'A' } });
    await storage.put({
      key: 'uploads/owned.png',
      body: new TextEncoder().encode('x'),
      contentType: 'image/png'
    });
    await database.create('media', { id: 'm1', owner: a.id, _storageKey: 'uploads/owned.png' });
    // References the media through an upload field — but is itself deleted in the same plan.
    const art = await runtime.create({
      collection: 'articles',
      data: { hero: 'm1', author: a.id }
    });

    await runtime.delete({ collection: 'authors', id: a.id as string });

    expect(await exists('media', 'm1')).toBe(false);
    expect(await exists('articles', art.id)).toBe(false);
    expect(await storage.get('uploads/owned.png')).toBeNull();
  });

  it('a storage cleanup failure is logged; the committed database delete stands', async () => {
    const storage = new InMemoryStorageAdapter();
    vi.spyOn(storage, 'delete').mockRejectedValueOnce(new Error('R2 down'));
    const { runtime, database, exists } = await setup(
      [
        authors,
        defineCollection({
          slug: 'media',
          upload: true,
          fields: { owner: defineField.relation({ collection: 'authors', onDelete: 'cascade' }) }
        })
      ],
      { storage }
    );
    const a = await runtime.create({ collection: 'authors', data: { name: 'A' } });
    await database.create('media', { id: 'm1', owner: a.id, _storageKey: 'k' });

    await runtime.delete({ collection: 'authors', id: a.id as string });
    expect(await exists('media', 'm1')).toBe(false);
    expect(await exists('authors', a.id)).toBe(false);
  });
});

// --- target validation on writes (spec 064 §4) ------------------------------------------------------

describe('writes validate relation targets', () => {
  const tags = defineCollection({ slug: 'tags', fields: { label: defineField.text() } });
  const posts = defineCollection({
    slug: 'posts',
    fields: {
      title: defineField.text(),
      author: defineField.relation({ collection: 'authors' }),
      tags: defineField.relation({ collection: 'tags', many: true })
    }
  });

  it('a missing single target is a 400 naming the field and id; nothing is written', async () => {
    const { runtime, database } = await setup([authors, tags, posts]);
    const error = await rejection(
      runtime.create({ collection: 'posts', data: { title: 't', author: 'ghost' } })
    );
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toBe(
      "Field 'author' references a document that does not exist in 'authors': 'ghost'"
    );
    expect(await database.count('posts')).toBe(0);
  });

  it('many targets: unique ids, one count read and one assertion per target collection', async () => {
    const { runtime, database } = await setup([authors, tags, posts]);
    const t1 = await runtime.create({ collection: 'tags', data: { label: '1' } });
    const t2 = await runtime.create({ collection: 'tags', data: { label: '2' } });
    const count = vi.spyOn(database, 'count');
    const batch = vi.spyOn(database, 'atomicWrite');

    await runtime.create({
      collection: 'posts',
      data: { title: 't', tags: [t1.id, t2.id, t1.id] }
    });

    expect(count).toHaveBeenCalledTimes(1);
    expect(count).toHaveBeenCalledWith('tags', { id: { in: [t1.id, t2.id] } });
    expect(batch.mock.calls[0]![0][0]).toEqual({
      type: 'assertCount',
      collection: 'tags',
      where: { id: { in: [t1.id, t2.id] } },
      equals: 2
    });

    await expect(
      runtime.create({ collection: 'posts', data: { tags: [t1.id, 'ghost-1', 'ghost-2'] } })
    ).rejects.toThrow(
      "Field 'tags' references documents that do not exist in 'tags': 'ghost-1', 'ghost-2'"
    );
  });

  it('a partial update never fails over a reference it does not touch (historical orphans)', async () => {
    const { runtime, database } = await setup([authors, tags, posts]);
    const a = await runtime.create({ collection: 'authors', data: { name: 'A' } });
    const t = await runtime.create({ collection: 'tags', data: { label: 'x' } });
    const post = await runtime.create({
      collection: 'posts',
      data: { title: 'old', author: a.id, tags: [t.id] }
    });
    // Orphans written before spec 064 (or through the raw adapter).
    await database.delete('authors', a.id as string);
    await database.delete('tags', t.id as string);
    const batch = vi.spyOn(database, 'atomicWrite');

    const updated = await runtime.update({
      collection: 'posts',
      id: post.id as string,
      data: { title: 'new', author: a.id, tags: [t.id] } // echoes of the stored values
    });
    expect(updated.title).toBe('new');
    // Echoes are not target-checked; the write only requires the row to still hold them.
    const ops = batch.mock.calls.flatMap((call) => call[0]);
    expect(ops.some((o) => o.type === 'assertCount')).toBe(false);

    // Adding a new, valid tag next to the orphan validates only the new one.
    const t2 = await runtime.create({ collection: 'tags', data: { label: 'y' } });
    await runtime.update({
      collection: 'posts',
      id: post.id as string,
      data: { tags: [t.id, t2.id] }
    });

    // Writing a missing value is refused.
    await expect(
      runtime.update({ collection: 'posts', id: post.id as string, data: { author: 'ghost' } })
    ).rejects.toThrow(/'author' references a document that does not exist/);
  });

  it('a versioned write carries its target assertions in the same batch as its snapshot', async () => {
    const { runtime, database } = await setup([
      authors,
      defineCollection({
        slug: 'notes',
        versions: true,
        fields: { author: defineField.relation({ collection: 'authors' }) }
      })
    ]);
    const a = await runtime.create({ collection: 'authors', data: { name: 'A' } });
    const batch = vi.spyOn(database, 'atomicWrite');

    const note = await runtime.create({ collection: 'notes', data: { author: a.id } });
    const b = await runtime.create({ collection: 'authors', data: { name: 'B' } });
    await runtime.update({ collection: 'notes', id: note.id as string, data: { author: b.id } });

    expect(batch.mock.calls.map((c) => c[0].map((o) => o.type))).toEqual([
      ['assertCount', 'create', 'create'],
      ['assertCount', 'update', 'create']
    ]);
  });

  describe('a target deleted after it was verified: 409, nothing written', () => {
    async function withInterceptor(collections: CollectionDefinition[]) {
      const inner = new InMemoryDatabaseAdapter();
      const observed = observeBatches(inner);
      const runtime = runtimeOver(observed.database, collections);
      await runtime.syncSchema();
      const a = await runtime.create({ collection: 'authors', data: { name: 'A' } });
      observed.beforeNextBatch(() => inner.delete('authors', a.id as string));
      return { runtime, inner, authorId: a.id as string };
    }

    it('create', async () => {
      const { runtime, inner, authorId } = await withInterceptor([authors, tags, posts]);
      const error = await rejection(
        runtime.create({ collection: 'posts', data: { author: authorId } })
      );
      expect(error).toBeInstanceOf(ConcurrentModificationError);
      expect(error.message).toMatch(/referenced by this write to 'posts' was deleted/);
      expect(await inner.count('posts')).toBe(0);
    });

    it('update', async () => {
      const inner = new InMemoryDatabaseAdapter();
      const observed = observeBatches(inner);
      const runtime = runtimeOver(observed.database, [authors, tags, posts]);
      await runtime.syncSchema();
      const a = await runtime.create({ collection: 'authors', data: { name: 'A' } });
      const post = await runtime.create({ collection: 'posts', data: { title: 'kept' } });
      observed.beforeNextBatch(() => inner.delete('authors', a.id as string));

      const error = await rejection(
        runtime.update({
          collection: 'posts',
          id: post.id as string,
          data: { author: a.id, title: 'x' }
        })
      );
      expect(error.code).toBe('CONCURRENT_MODIFICATION');
      const stored = await inner.findById('posts', post.id as string);
      expect(stored?.title).toBe('kept');
      expect(stored?.author ?? null).toBeNull();
    });

    it('versioned update', async () => {
      const notes = defineCollection({
        slug: 'notes',
        versions: true,
        fields: { author: defineField.relation({ collection: 'authors' }) }
      });
      const inner = new InMemoryDatabaseAdapter();
      const observed = observeBatches(inner);
      const runtime = runtimeOver(observed.database, [authors, notes]);
      await runtime.syncSchema();
      const a = await runtime.create({ collection: 'authors', data: { name: 'A' } });
      const note = await runtime.create({ collection: 'notes', data: {} });
      observed.beforeNextBatch(() => inner.delete('authors', a.id as string));

      const error = await rejection(
        runtime.update({ collection: 'notes', id: note.id as string, data: { author: a.id } })
      );
      expect(error.code).toBe('CONCURRENT_MODIFICATION');
      expect(await inner.count('_versions_notes')).toBe(1);
    });

    it('global', async () => {
      const settings = defineGlobal({
        slug: 'settings',
        fields: { owner: defineField.relation({ collection: 'authors' }) }
      });
      const inner = new InMemoryDatabaseAdapter();
      const observed = observeBatches(inner);
      const runtime = runtimeOver(observed.database, [authors], { globals: [settings] });
      await runtime.syncSchema();
      await expect(
        runtime.updateGlobalDocument({ global: 'settings', data: { owner: 'ghost' } })
      ).rejects.toThrow(InvalidInputError);
      const a = await runtime.create({ collection: 'authors', data: { name: 'A' } });
      observed.beforeNextBatch(() => inner.delete('authors', a.id as string));
      const error = await rejection(
        runtime.updateGlobalDocument({ global: 'settings', data: { owner: a.id } })
      );
      expect(error.code).toBe('CONCURRENT_MODIFICATION');
      expect(await inner.count('_global_settings')).toBe(0);
    });
  });

  it('restoreVersion cannot resurrect a reference to a deleted document', async () => {
    const { runtime, database } = await setup([
      authors,
      defineCollection({
        slug: 'notes',
        versions: true,
        fields: { author: defineField.relation({ collection: 'authors', onDelete: 'set-null' }) }
      })
    ]);
    const a = await runtime.create({ collection: 'authors', data: { name: 'A' } });
    const note = await runtime.create({ collection: 'notes', data: { author: a.id } });
    await runtime.delete({ collection: 'authors', id: a.id as string });
    const [, first] = await runtime.listVersions({
      collection: 'notes',
      documentId: note.id as string
    });

    await expect(
      runtime.restoreVersion({ collection: 'notes', versionId: first!.id })
    ).rejects.toThrow(/'author' references a document that does not exist/);
    expect(await database.count('_versions_notes')).toBe(2);
  });
});

// --- HTTP mapping -----------------------------------------------------------------------------------

describe('HTTP envelope', () => {
  it('a missing target is 400 INVALID_INPUT; a blocked delete is 400; internal tables never leak', async () => {
    const { runtime } = await setup([
      authors,
      defineCollection({
        slug: 'books',
        fields: { author: defineField.relation({ collection: 'authors' }) }
      })
    ]);
    const post = (body: unknown) => ({
      request: new Request('https://forge.test/api/v1/books', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      }),
      env: {},
      params: { collection: 'books' }
    });

    const created = await handleCreate(post({ author: 'ghost' }), { runtime });
    expect(created.status).toBe(400);
    const body = (await created.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INVALID_INPUT');
    expect(body.error.message).not.toMatch(/_versions_|_global_/);

    const a = await runtime.create({ collection: 'authors', data: { name: 'A' } });
    await runtime.create({ collection: 'books', data: { author: a.id } });
    const deleted = await handleDelete(
      {
        request: new Request(`https://forge.test/api/v1/authors/${String(a.id)}`, {
          method: 'DELETE'
        }),
        env: {},
        params: { collection: 'authors', id: a.id as string }
      },
      { runtime }
    );
    expect(deleted.status).toBe(400);
  });
});

// --- findOrphanedDocuments stays diagnostic ----------------------------------------------------------

describe('findOrphanedDocuments after supported operations', () => {
  it('finds nothing after committed cascades / set-nulls, and still reports a raw-written orphan', async () => {
    const media = defineCollection({ slug: 'media', upload: true, fields: {} });
    const notes = defineCollection({
      slug: 'notes',
      fields: {
        author: defineField.relation({ collection: 'authors', onDelete: 'set-null' }),
        image: defineField.upload({ collection: 'media' })
      }
    });
    const { runtime, database } = await setup([...blogCollections(), media, notes]);
    const a = await runtime.create({ collection: 'authors', data: { name: 'A' } });
    const p = await runtime.create({ collection: 'posts', data: { title: 'P', author: a.id } });
    await runtime.create({ collection: 'comments', data: { text: 'C', post: p.id } });
    const m = await runtime.create({ collection: 'media', data: {} });
    await runtime.create({ collection: 'notes', data: { author: a.id, image: m.id } });

    await runtime.delete({ collection: 'authors', id: a.id as string });
    for (const slug of ['posts', 'comments', 'notes']) {
      expect(await findOrphanedDocuments(runtime, runtime.getCollection(slug)!)).toEqual([]);
    }

    await database.delete('media', m.id as string);
    const orphans = await findOrphanedDocuments(runtime, runtime.getCollection('notes')!);
    expect(orphans.map((o) => [o.fieldName, o.missingId])).toEqual([['image', m.id]]);
  });
});

// --- injected database failure on a real backend ---------------------------------------------------

describe('LibSqlDatabaseAdapter — a database failure late in the batch rolls back every row', () => {
  const directory = tempDir.make();
  afterAll(() => tempDir.remove(directory));

  it('a trigger failing the last cascaded delete leaves A, B and C in place', async () => {
    const url = `file:${directory}/fault.db`;
    const runtime = runtimeOver(new LibSqlDatabaseAdapter(url).init(), blogCollections());
    await runtime.syncSchema();
    const a = await runtime.create({ collection: 'authors', data: { name: 'A' } });
    const p = await runtime.create({ collection: 'posts', data: { title: 'P', author: a.id } });
    const c = await runtime.create({ collection: 'comments', data: { text: 'C', post: p.id } });
    const client = createClient({ url });
    await client.execute(
      `CREATE TRIGGER "fail_comment_delete" BEFORE DELETE ON "comments" BEGIN SELECT RAISE(ABORT, 'injected'); END`
    );

    await expect(runtime.delete({ collection: 'authors', id: a.id as string })).rejects.toThrow();

    const db = runtime.adapters.database;
    expect(await db.findById('authors', a.id as string)).not.toBeNull();
    expect(await db.findById('posts', p.id as string)).not.toBeNull();
    expect(await db.findById('comments', c.id as string)).not.toBeNull();
    await client.execute(`DROP TRIGGER "fail_comment_delete"`);
    client.close();
  });
});

// --- two-writer contract ------------------------------------------------------------------------------

describe('InMemoryDatabaseAdapter (one process, runtimes share the adapter instance)', () => {
  runRelationLifecycleContractTests(async ({ prefix, parties, gate }) => {
    const shared = new InMemoryDatabaseAdapter();
    const contenders = [];
    for (let i = 0; i < parties; i++) {
      const runtime = runtimeOver(gate.wrap(shared, i), relationLifecycleCollections(prefix));
      await runtime.syncSchema();
      contenders.push(runtime);
    }
    return { contenders, database: shared };
  });
});

describe('LibSqlDatabaseAdapter — independent clients on one database file', () => {
  const directory = tempDir.make();
  afterAll(() => tempDir.remove(directory));

  runRelationLifecycleContractTests(async ({ prefix, parties, gate }) => {
    const url = `file:${directory}/${prefix}.db`;
    const contenders = [];
    for (let i = 0; i < parties; i++) {
      const runtime = runtimeOver(
        gate.wrap(new LibSqlDatabaseAdapter(url).init(), i),
        relationLifecycleCollections(prefix)
      );
      await runtime.syncSchema();
      contenders.push(runtime);
    }
    const raw = runtimeOver(
      new LibSqlDatabaseAdapter(url).init(),
      relationLifecycleCollections(prefix)
    );
    await raw.syncSchema();
    return { contenders, database: raw.adapters.database };
  });
});

// --- review follow-ups ----------------------------------------------------------------------------

describe('review follow-ups (spec 064)', () => {
  it("a set-null dependent's hook cannot write a reference to a missing document", async () => {
    const { runtime, exists, row } = await setup([
      authors,
      defineCollection({
        slug: 'notes',
        fields: {
          author: defineField.relation({ collection: 'authors', onDelete: 'set-null' }),
          reviewer: defineField.relation({ collection: 'authors' })
        },
        hooks: {
          beforeChange: [
            ({ data, operation }) =>
              operation === 'update' && data.author === null ? { ...data, reviewer: 'ghost' } : data
          ]
        }
      })
    ]);
    const a = await runtime.create({ collection: 'authors', data: { name: 'A' } });
    const note = await runtime.create({ collection: 'notes', data: { author: a.id } });

    await expect(runtime.delete({ collection: 'authors', id: a.id as string })).rejects.toThrow(
      /'reviewer' references a document that does not exist/
    );
    expect(await exists('authors', a.id)).toBe(true);
    expect((await row('notes', note.id))?.author).toBe(a.id);
  });

  it("a large many write is checked in chunks that fit D1's bound-parameter limit", async () => {
    const tags = defineCollection({ slug: 'tags', fields: { label: defineField.text() } });
    const posts = defineCollection({
      slug: 'posts',
      fields: { tags: defineField.relation({ collection: 'tags', many: true }) }
    });
    const { runtime, database } = await setup([tags, posts]);
    const ids = Array.from({ length: 200 }, (_, i) => `t${i}`);
    for (const id of ids) await database.create('tags', { id, label: id });
    const batch = vi.spyOn(database, 'atomicWrite');

    await runtime.create({ collection: 'posts', data: { tags: ids } });

    const assertions = batch.mock.calls[0]![0].filter((o) => o.type === 'assertCount');
    expect(assertions.map((o) => (o.type === 'assertCount' ? o.equals : 0))).toEqual([90, 90, 20]);
    await expect(
      runtime.create({ collection: 'posts', data: { tags: [...ids, 'ghost'] } })
    ).rejects.toThrow(/'ghost'/);
  });
});

describe('matrix cells and failure injection (spec 064 review)', () => {
  it('a set-null dependent whose validation fails: zero mutation', async () => {
    const { runtime, exists, row } = await setup([
      authors,
      defineCollection({
        slug: 'notes',
        fields: {
          title: defineField.text(),
          author: defineField.relation({ collection: 'authors', onDelete: 'set-null' })
        },
        hooks: {
          // Produces an invalid value for a touched field, so the dependent's validation fails.
          beforeValidate: [
            ({ data, operation }) => (operation === 'update' ? { ...data, title: 42 } : data)
          ]
        }
      })
    ]);
    const a = await runtime.create({ collection: 'authors', data: { name: 'A' } });
    const note = await runtime.create({ collection: 'notes', data: { title: 't', author: a.id } });

    const error = await rejection(runtime.delete({ collection: 'authors', id: a.id as string }));
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(await exists('authors', a.id)).toBe(true);
    expect(await row('notes', note.id)).toMatchObject({ title: 't', author: a.id });
  });

  it('set-null on an upload-enabled referrer keeps its file; restrict from a versioned referrer blocks', async () => {
    const storage = new InMemoryStorageAdapter();
    const { runtime, database, exists } = await setup(
      [
        authors,
        defineCollection({
          slug: 'media',
          upload: true,
          fields: { owner: defineField.relation({ collection: 'authors', onDelete: 'set-null' }) }
        }),
        defineCollection({
          slug: 'drafts',
          versions: true,
          fields: { author: defineField.relation({ collection: 'authors' }) }
        })
      ],
      { storage }
    );
    const a = await runtime.create({ collection: 'authors', data: { name: 'A' } });
    await storage.put({ key: 'k', body: new TextEncoder().encode('x'), contentType: 'text/plain' });
    await database.create('media', { id: 'm1', owner: a.id, _storageKey: 'k' });
    const d = await runtime.create({ collection: 'drafts', data: { author: a.id } });

    await expect(runtime.delete({ collection: 'authors', id: a.id as string })).rejects.toThrow(
      /referenced by 1 document\(s\) in 'drafts'/
    );
    await runtime.delete({ collection: 'drafts', id: d.id as string });
    await runtime.delete({ collection: 'authors', id: a.id as string });
    expect((await database.findById('media', 'm1'))?.owner).toBeNull();
    expect(await storage.get('k')).not.toBeNull();
    expect(await exists('authors', a.id)).toBe(false);
  });

  it('auth-managed referrers: restrict blocks, set-null is refused; writes to an auth-managed target are checked', async () => {
    const auth = Object.assign(new InMemoryAuthAdapter(), {
      managesCollection: (slug: string) => slug === 'members',
      // Claims to enforce the user-delete guard (spec 065); a stub that did not is refused at startup.
      setManagedDeleteGuard: () => true
    });
    const { runtime, database, exists } = await setup(
      [
        defineCollection({ slug: 'teams', fields: { name: defineField.text() } }),
        defineCollection({ slug: 'squads', fields: { name: defineField.text() } }),
        defineCollection({
          slug: 'members',
          fields: {
            team: defineField.relation({ collection: 'teams' }),
            squad: defineField.relation({ collection: 'squads', onDelete: 'set-null' })
          }
        }),
        defineCollection({
          slug: 'posts',
          fields: { author: defineField.relation({ collection: 'members' }) }
        })
      ],
      { auth }
    );
    const team = await runtime.create({ collection: 'teams', data: { name: 'T' } });
    const squad = await runtime.create({ collection: 'squads', data: { name: 'S' } });
    await database.create('members', { id: 'u1', team: team.id, squad: squad.id });

    await expect(runtime.delete({ collection: 'teams', id: team.id as string })).rejects.toThrow(
      /referenced by 1 document\(s\) in 'members'/
    );
    await expect(runtime.delete({ collection: 'squads', id: squad.id as string })).rejects.toThrow(
      /managed by the configured auth adapter/
    );
    expect(await exists('teams', team.id)).toBe(true);
    expect(await exists('squads', squad.id)).toBe(true);

    await expect(
      runtime.create({ collection: 'posts', data: { author: 'no-such-user' } })
    ).rejects.toThrow(/does not exist in 'members'/);
    await runtime.create({ collection: 'posts', data: { author: 'u1' } });
  });

  it('self restrict blocks; a document created with an explicit id may reference itself', async () => {
    const { runtime, exists } = await setup([
      defineCollection({
        slug: 'categories',
        fields: { parent: defineField.relation({ collection: 'categories' }) }
      })
    ]);
    const root = await runtime.create({
      collection: 'categories',
      data: { id: 'root', parent: 'root' }
    });
    expect(root.parent).toBe('root');
    const child = await runtime.create({ collection: 'categories', data: { parent: 'root' } });

    await expect(runtime.delete({ collection: 'categories', id: 'root' })).rejects.toThrow(
      /referenced by 1 document\(s\) in 'categories'/
    );
    await runtime.delete({ collection: 'categories', id: child.id as string });
    await runtime.delete({ collection: 'categories', id: 'root' });
    expect(await exists('categories', 'root')).toBe(false);
  });
});
