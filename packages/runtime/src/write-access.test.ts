import { afterAll, describe, expect, it } from 'vitest';
import { defineCollection, defineField, defineGlobal } from '@forge-cms/core';
import type { CollectionDefinition, GlobalDefinition } from '@forge-cms/core';
import { InMemoryDatabaseAdapter, LibSqlDatabaseAdapter } from '@forge-cms/db';
import type { DatabaseAdapter } from '@forge-cms/db';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { runWriteAccessContractTests, writeAccessSchema } from '@forge-cms/testing/contracts';
import { ForgeCmsRuntime } from './runtime.js';

// Spec 068 — write responses honour read access; update/delete access queries hold at the write.

const tempDir = await (async () => {
  const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as {
    mkdtempSync(prefix: string): string;
    rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
  };
  const os = (await import(/* @vite-ignore */ 'node:os' as string)) as { tmpdir(): string };
  return {
    make: () => fs.mkdtempSync(`${os.tmpdir()}/forge-write-access-`),
    remove: (path: string) => fs.rmSync(path, { recursive: true, force: true })
  };
})();

function runtimeOver(
  database: DatabaseAdapter,
  collections: CollectionDefinition[],
  globals: GlobalDefinition[] = []
): ForgeCmsRuntime {
  const runtime = new ForgeCmsRuntime({
    collections,
    globals,
    adapters: { database, auth: new InMemoryAuthAdapter(), storage: new InMemoryStorageAdapter() }
  });
  runtime.init();
  return runtime;
}

const bob = { id: 'bob', role: 'editor' } as const;
const alice = { id: 'alice', role: 'editor' } as const;

const docs = defineCollection({
  slug: 'docs',
  access: {
    read: ({ user }) => (user ? { owner: user.id } : false),
    create: () => true,
    update: () => true,
    delete: () => true
  },
  fields: {
    title: defineField.text(),
    owner: defineField.text(),
    secret: defineField.text({ access: { read: () => false } })
  }
});

const site = defineGlobal({
  slug: 'site',
  access: { read: () => ({ region: 'eu' }), update: () => true },
  fields: { title: defineField.text(), region: defineField.text() }
});

async function setup() {
  const database = new InMemoryDatabaseAdapter();
  const runtime = runtimeOver(database, [docs], [site]);
  await runtime.syncSchema();
  return { database, runtime };
}

describe('write responses honour the caller’s read access (spec 068)', () => {
  it('an update of a document the caller cannot read returns only its id', async () => {
    const { runtime, database } = await setup();
    const doc = await runtime.create({
      collection: 'docs',
      data: { title: 'alice doc', owner: 'alice', secret: 's3cret' }
    });

    // Pre-fix: the whole document came back to bob.
    const result = await runtime.update({
      collection: 'docs',
      id: doc.id as string,
      user: bob,
      overrideAccess: false,
      data: { title: 'edited' }
    });
    expect(result).toEqual({ id: doc.id });
    expect((await database.findById('docs', doc.id as string))?.title).toBe('edited');
  });

  it('a create the caller cannot read back returns only its id', async () => {
    const { runtime } = await setup();
    const result = await runtime.create({
      collection: 'docs',
      user: bob,
      overrideAccess: false,
      data: { title: 'for alice', owner: 'alice' }
    });
    expect(Object.keys(result)).toEqual(['id']);
  });

  it('a readable write still returns the document, with read-denied fields removed', async () => {
    const { runtime } = await setup();
    const result = await runtime.create({
      collection: 'docs',
      user: alice,
      overrideAccess: false,
      data: { title: 'mine', owner: 'alice', secret: 's3cret' }
    });
    expect(result).toMatchObject({ title: 'mine', owner: 'alice' });
    expect(result).not.toHaveProperty('secret');
  });

  it('an access-checked delete never returns read-denied fields or unreadable documents', async () => {
    const { runtime } = await setup();
    const own = await runtime.create({
      collection: 'docs',
      data: { title: 'mine', owner: 'alice', secret: 's3cret' }
    });
    const other = await runtime.create({
      collection: 'docs',
      data: { title: 'theirs', owner: 'alice', secret: 's3cret' }
    });

    // Pre-fix: the raw row, `secret` included.
    const deletedOwn = await runtime.delete({
      collection: 'docs',
      id: own.id as string,
      user: alice,
      overrideAccess: false
    });
    expect(deletedOwn).toMatchObject({ title: 'mine' });
    expect(deletedOwn).not.toHaveProperty('secret');

    expect(
      await runtime.delete({
        collection: 'docs',
        id: other.id as string,
        user: bob,
        overrideAccess: false
      })
    ).toEqual({ id: other.id });

    // A trusted delete keeps returning the stored row.
    const trusted = await runtime.create({ collection: 'docs', data: { secret: 'kept' } });
    expect(await runtime.delete({ collection: 'docs', id: trusted.id as string })).toMatchObject({
      secret: 'kept'
    });
  });

  it('preview of a document the caller may update but not read is a 404', async () => {
    const { runtime } = await setup();
    const doc = await runtime.create({
      collection: 'docs',
      data: { title: 'alice', owner: 'alice' }
    });
    // Pre-fix (found in review): the whole stored document, merged with the preview data.
    await expect(
      runtime.preview({
        collection: 'docs',
        id: doc.id as string,
        user: bob,
        overrideAccess: false,
        data: {}
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(
      await runtime.preview({
        collection: 'docs',
        id: doc.id as string,
        user: alice,
        overrideAccess: false,
        data: { title: 'draft title' }
      })
    ).toMatchObject({ title: 'draft title', owner: 'alice' });
  });

  it('a read rule that inspects `doc` answers a write result exactly as findByID does', async () => {
    const database = new InMemoryDatabaseAdapter();
    const inspecting = defineCollection({
      slug: 'inspected',
      access: {
        read: ({ doc }) => doc?.visibility === 'public',
        create: () => true,
        update: () => true
      },
      fields: { title: defineField.text(), visibility: defineField.text() }
    });
    const runtime = runtimeOver(database, [inspecting]);
    await runtime.syncSchema();
    const doc = await runtime.create({
      collection: 'inspected',
      data: { title: 't', visibility: 'public' }
    });
    const read = runtime.findByID({
      collection: 'inspected',
      id: doc.id as string,
      user: bob,
      overrideAccess: false
    });
    const write = runtime.update({
      collection: 'inspected',
      id: doc.id as string,
      user: bob,
      overrideAccess: false,
      data: {}
    });
    // findByID never passes `doc` to the read rule, so it denies; the write result must too.
    await expect(read).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await write).toEqual({ id: doc.id });
  });

  it('a global write the caller cannot read back returns only its id', async () => {
    const { runtime } = await setup();
    await runtime.updateGlobalDocument({ global: 'site', data: { title: 'hidden', region: 'us' } });
    // Pre-fix: `{ title: 'hidden', region: 'us', … }`.
    expect(
      await runtime.updateGlobalDocument({
        global: 'site',
        user: bob,
        overrideAccess: false,
        data: { title: 'still hidden' }
      })
    ).toEqual({ id: 'global' });
    expect(
      await runtime.updateGlobalDocument({
        global: 'site',
        user: bob,
        overrideAccess: false,
        data: { region: 'eu' }
      })
    ).toMatchObject({ title: 'still hidden', region: 'eu' });
  });
});

// --- write-time access queries under independent writers -----------------------------------------------

describe('InMemoryDatabaseAdapter (one process, runtimes share the adapter instance)', () => {
  runWriteAccessContractTests(async ({ prefix, hold }) => {
    const shared = new InMemoryDatabaseAdapter();
    const { collections, globals } = writeAccessSchema(prefix);
    const caller = runtimeOver(hold.wrap(shared), collections, globals);
    const mover = runtimeOver(shared, collections, globals);
    await caller.syncSchema();
    return { contenders: [caller, mover], database: shared };
  });
});

describe('LibSqlDatabaseAdapter — independent clients on one database file', () => {
  const directory = tempDir.make();
  afterAll(() => tempDir.remove(directory));

  runWriteAccessContractTests(async ({ prefix, hold }) => {
    const url = `file:${directory}/${prefix}.db`;
    const { collections, globals } = writeAccessSchema(prefix);
    const caller = runtimeOver(
      hold.wrap(new LibSqlDatabaseAdapter(url).init()),
      collections,
      globals
    );
    const mover = runtimeOver(new LibSqlDatabaseAdapter(url).init(), collections, globals);
    await caller.syncSchema();
    await mover.syncSchema();
    return { contenders: [caller, mover], database: mover.adapters.database };
  });
});
