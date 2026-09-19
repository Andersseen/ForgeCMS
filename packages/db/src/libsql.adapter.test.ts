import { describe, expect, it, beforeEach, vi } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import {
  runDatabaseAdapterConstraintContractTests,
  runDatabaseAdapterQueryContractTests,
  runDatabaseAdapterConditionalWriteContractTests,
  runDatabaseAdapterAtomicWriteContractTests
} from '@forge-cms/testing/contracts';
import type { Client } from '@libsql/client';
import { LibSqlDatabaseAdapter } from './libsql.adapter.js';
import { UniqueConstraintError } from './constraint-error.js';

runDatabaseAdapterConstraintContractTests(() => {
  const adapter = new LibSqlDatabaseAdapter('file::memory:');
  adapter.init();
  return adapter;
});

runDatabaseAdapterQueryContractTests(() => {
  const adapter = new LibSqlDatabaseAdapter('file::memory:');
  adapter.init();
  return adapter;
});

runDatabaseAdapterConditionalWriteContractTests(() => {
  const adapter = new LibSqlDatabaseAdapter('file::memory:');
  adapter.init();
  return adapter;
});

runDatabaseAdapterAtomicWriteContractTests(() => {
  const adapter = new LibSqlDatabaseAdapter('file::memory:');
  adapter.init();
  return adapter;
});

describe('LibSqlDatabaseAdapter', () => {
  let adapter: LibSqlDatabaseAdapter;

  const posts = defineCollection({
    slug: 'posts',
    fields: {
      title: defineField.text({ required: true }),
      published: defineField.boolean(),
      views: defineField.number()
    }
  });

  beforeEach(async () => {
    adapter = new LibSqlDatabaseAdapter('file::memory:');
    adapter.init();
    await adapter.syncSchema([posts]);
  });

  it('has a name', () => {
    expect(adapter.name).toBe('libsql');
  });

  it('creates and finds a record', async () => {
    const created = await adapter.create('posts', { title: 'Hello', published: true, views: 5 });
    expect(created.id).toBeTruthy();

    const found = await adapter.findById('posts', created.id as string);
    expect(found?.title).toBe('Hello');
    expect(found?.published).toBe(true);
  });

  it('updates and deletes a record', async () => {
    const created = await adapter.create('posts', { title: 'Old', views: 1 });
    const updated = await adapter.update('posts', created.id as string, { title: 'New' });
    expect(updated.title).toBe('New');

    await adapter.delete('posts', created.id as string);
    expect(await adapter.findById('posts', created.id as string)).toBeNull();
  });

  it('counts records', async () => {
    await adapter.create('posts', { title: 'A' });
    await adapter.create('posts', { title: 'B' });
    expect(await adapter.count('posts')).toBe(2);
  });

  describe('additive schema migrations', () => {
    it('adds a column for a field added to the collection definition after the table exists', async () => {
      const migrationAdapter = new LibSqlDatabaseAdapter('file::memory:');
      migrationAdapter.init();

      const v1 = defineCollection({
        slug: 'articles',
        fields: { title: defineField.text({ required: true }) }
      });
      await migrationAdapter.syncSchema([v1]);
      const existing = await migrationAdapter.create('articles', { title: 'Before migration' });

      const v2 = defineCollection({
        slug: 'articles',
        fields: {
          title: defineField.text({ required: true }),
          views: defineField.number()
        }
      });
      await migrationAdapter.syncSchema([v2]);

      // the pre-migration row is still readable
      const found = await migrationAdapter.findById('articles', existing.id as string);
      expect(found?.title).toBe('Before migration');

      // and the new column is now usable
      const created = await migrationAdapter.create('articles', {
        title: 'After migration',
        views: 5
      });
      const foundNew = await migrationAdapter.findById('articles', created.id as string);
      expect(foundNew?.views).toBe(5);
    });

    it('is idempotent: re-syncing an unchanged collection issues no ALTER TABLE', async () => {
      // syncSchema was already called once in beforeEach; calling it again with the same
      // definition must not throw (no duplicate-column error from a redundant ADD COLUMN).
      await expect(adapter.syncSchema([posts])).resolves.toBeUndefined();
    });
  });

  describe('where operators and sorting', () => {
    beforeEach(async () => {
      await adapter.create('posts', { id: 'p1', title: 'Alpha', views: 10 });
      await adapter.create('posts', { id: 'p2', title: 'Beta', views: 50 });
      await adapter.create('posts', { id: 'p3', title: 'Gamma', views: 100 });
    });

    it('filters with gt/gte/lt/lte/ne', async () => {
      const gt = await adapter.findMany({ collection: 'posts', where: { views: { gt: 10 } } });
      expect(gt.map((r) => r.id).sort()).toEqual(['p2', 'p3']);

      const lt = await adapter.findMany({ collection: 'posts', where: { views: { lt: 50 } } });
      expect(lt.map((r) => r.id)).toEqual(['p1']);

      const gte = await adapter.findMany({ collection: 'posts', where: { views: { gte: 50 } } });
      expect(gte.map((r) => r.id).sort()).toEqual(['p2', 'p3']);

      const lte = await adapter.findMany({ collection: 'posts', where: { views: { lte: 50 } } });
      expect(lte.map((r) => r.id).sort()).toEqual(['p1', 'p2']);

      const ne = await adapter.findMany({ collection: 'posts', where: { title: { ne: 'Alpha' } } });
      expect(ne.map((r) => r.id).sort()).toEqual(['p2', 'p3']);
    });

    it('filters with in', async () => {
      const results = await adapter.findMany({
        collection: 'posts',
        where: { id: { in: ['p1', 'p3'] } }
      });
      expect(results.map((r) => r.id).sort()).toEqual(['p1', 'p3']);
    });

    it('filters with contains', async () => {
      const results = await adapter.findMany({
        collection: 'posts',
        where: { title: { contains: 'et' } }
      });
      expect(results.map((r) => r.id)).toEqual(['p2']);
    });

    it('ANDs multiple operators on the same field', async () => {
      const results = await adapter.findMany({
        collection: 'posts',
        where: { views: { gte: 50, lte: 50 } }
      });
      expect(results.map((r) => r.id)).toEqual(['p2']);
      expect(await adapter.count('posts', { views: { gte: 50, lte: 50 } })).toBe(1);
    });

    it('rejects unsafe collection strings that were not registered', async () => {
      await expect(adapter.findById('posts"; DROP TABLE posts; --', 'p1')).rejects.toThrow(
        'not registered'
      );
      await expect(adapter.count('posts"; DROP TABLE posts; --')).rejects.toThrow('not registered');
    });

    it('still supports bare-value equality', async () => {
      const results = await adapter.findMany({ collection: 'posts', where: { title: 'Alpha' } });
      expect(results.map((r) => r.id)).toEqual(['p1']);
    });

    it('sorts ascending and descending', async () => {
      const asc = await adapter.findMany({ collection: 'posts', sort: 'views', order: 'asc' });
      expect(asc.map((r) => r.id)).toEqual(['p1', 'p2', 'p3']);

      const desc = await adapter.findMany({ collection: 'posts', sort: 'views', order: 'desc' });
      expect(desc.map((r) => r.id)).toEqual(['p3', 'p2', 'p1']);
    });
  });
});

// Spec 059: `updateIf`/`deleteIf` are decided by the database inside ONE statement — not a read that
// returns to JavaScript followed by a separate write — and a failure is never reported as not-applied.
describe('LibSqlDatabaseAdapter conditional writes (spec 059)', () => {
  const people = defineCollection({
    slug: 'cw_people',
    fields: { email: defineField.text({ required: true, unique: true }), role: defineField.text() }
  });
  const guard = { keepAtLeast: { where: { role: 'admin' }, others: 1 } };
  let adapter: LibSqlDatabaseAdapter;
  let statements: string[];

  beforeEach(async () => {
    adapter = new LibSqlDatabaseAdapter('file::memory:');
    adapter.init();
    await adapter.syncSchema([people]);
    await adapter.create('cw_people', { id: 'a', email: 'a@x.test', role: 'admin' });
    await adapter.create('cw_people', { id: 'b', email: 'b@x.test', role: 'admin' });

    statements = [];
    const client = (adapter as unknown as { client: { execute: (s: { sql: string }) => unknown } })
      .client;
    const execute = client.execute.bind(client);
    client.execute = (statement) => {
      statements.push(statement.sql);
      return execute(statement);
    };
  });

  it('issues exactly one SQL statement per call, and the guard is inside it', async () => {
    await adapter.updateIf('cw_people', 'a', { role: 'editor' }, guard);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^update "cw_people" set .* returning /);
    expect(statements[0]).toContain('SELECT COUNT(*) FROM "cw_people"');

    statements.length = 0;
    await adapter.deleteIf('cw_people', 'b', guard); // last admin now: refused, still one statement
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^delete from "cw_people" where .* returning /);
    expect(statements[0]).toContain('SELECT COUNT(*) FROM "cw_people"');
  });

  it('rejects an unregistered collection instead of reporting not-applied', async () => {
    await expect(adapter.updateIf('cw_never', 'x', { role: 'a' }, guard)).rejects.toThrow(
      "Collection 'cw_never' not registered. Call syncSchema first."
    );
    await expect(adapter.deleteIf('cw_never', 'x', guard)).rejects.toThrow(
      "Collection 'cw_never' not registered. Call syncSchema first."
    );
  });

  it('rejects an unknown column before any statement runs, leaving the row untouched', async () => {
    await expect(adapter.updateIf('cw_people', 'a', { role: 'x', nope: 1 }, {})).rejects.toThrow(
      "Unknown column 'nope'"
    );
    await expect(
      adapter.updateIf('cw_people', 'a', { role: 'x' }, { targetMatches: { nope: 1 } })
    ).rejects.toThrow("Unknown column 'nope'");
    expect(statements).toHaveLength(0);
    expect((await adapter.findById('cw_people', 'a'))?.role).toBe('admin');
  });

  it('a table that disappears out-of-band fails as a database error, not as applied: false', async () => {
    const client = (adapter as unknown as { client: { execute: (s: string) => Promise<unknown> } })
      .client;
    await client.execute('DROP TABLE "cw_people"');

    // drizzle wraps the driver error ("Failed query: …") and keeps the real one on `cause`.
    for (const attempt of [
      () => adapter.updateIf('cw_people', 'a', { role: 'x' }, guard),
      () => adapter.deleteIf('cw_people', 'a', guard)
    ]) {
      const error = await attempt().then(
        (result) => {
          throw new Error(`expected a rejection, got ${JSON.stringify(result)}`);
        },
        (e: unknown) => e as { message: string; cause?: unknown }
      );
      expect(`${error.message} ${String(error.cause)}`).toMatch(/no such table/i);
    }
  });
});

describe('LibSqlDatabaseAdapter atomicWrite (spec 060)', () => {
  let adapter: LibSqlDatabaseAdapter;

  const posts = defineCollection({
    slug: 'posts',
    fields: { title: defineField.text({ required: true }) }
  });

  beforeEach(async () => {
    adapter = new LibSqlDatabaseAdapter('file::memory:');
    adapter.init();
    await adapter.syncSchema([posts]);
  });

  // Spec 060: the batch must be libSQL's real transactional batch, not a loop of independent statements.
  describe('atomicWrite uses the native transactional batch', () => {
    type BatchSpy = ReturnType<typeof vi.spyOn>;
    let executeSpy: BatchSpy;
    let batchSpy: BatchSpy;

    beforeEach(() => {
      const client = (adapter as unknown as { client: Client }).client;
      executeSpy = vi.spyOn(client, 'execute');
      batchSpy = vi.spyOn(client, 'batch');
    });

    it('issues exactly one client.batch(statements, "write") and no per-statement execute', async () => {
      await adapter.atomicWrite([
        { type: 'create', collection: 'posts', data: { id: 'p1', title: 'One' } },
        { type: 'update', collection: 'posts', id: 'p1', data: { title: 'Two' } },
        { type: 'delete', collection: 'posts', id: 'nothing' }
      ]);

      expect(executeSpy).not.toHaveBeenCalled();
      expect(batchSpy).toHaveBeenCalledTimes(1);
      const [statements, mode] = batchSpy.mock.calls[0] as [{ sql: string }[], string];
      expect(mode).toBe('write');
      // create, update (+ its must-apply guard), delete
      expect(statements).toHaveLength(4);
      expect(statements[0]?.sql).toMatch(/^insert into "posts"/i);
      expect(statements[1]?.sql).toMatch(/^update "posts"/i);
      expect(statements[2]?.sql).toMatch(/^select abs\(/i);
      expect(statements[3]?.sql).toMatch(/^delete from "posts"/i);
    });

    it('adds a guard only after operations that must apply', async () => {
      await adapter.atomicWrite([
        { type: 'create', collection: 'posts', data: { id: 'p1', title: 'One' } },
        { type: 'updateIf', collection: 'posts', id: 'p1', data: { title: 'x' }, condition: {} },
        { type: 'deleteIf', collection: 'posts', id: 'p1', condition: {}, requireApplied: true }
      ]);

      const [statements] = batchSpy.mock.calls[0] as [{ sql: string }[]];
      expect(statements.map((s) => s.sql.split(' ')[0]?.toLowerCase())).toEqual([
        'insert',
        'update',
        'delete',
        'select'
      ]);
    });

    it('binds every value as a parameter — no operation input is interpolated into SQL', async () => {
      const hostile = "x'); DROP TABLE posts; --";
      await adapter.atomicWrite([
        { type: 'create', collection: 'posts', data: { id: hostile, title: hostile } }
      ]);

      const [statements] = batchSpy.mock.calls[0] as [{ sql: string; args: unknown[] }[]];
      expect(statements[0]?.sql).not.toContain('DROP TABLE');
      expect(statements[0]?.args).toContain(hostile);
      expect(await adapter.count('posts')).toBe(1);
    });

    it('validates before sending: a bad operation never reaches the client', async () => {
      await expect(
        adapter.atomicWrite([
          { type: 'create', collection: 'posts', data: { title: 'fine' } },
          { type: 'create', collection: 'posts', data: { nonexistent: 1 } }
        ])
      ).rejects.toThrow("Unknown column 'nonexistent'");
      await expect(
        adapter.atomicWrite([{ type: 'create', collection: 'never_registered', data: {} }])
      ).rejects.toThrow("Collection 'never_registered' not registered");

      expect(batchSpy).not.toHaveBeenCalled();
      expect(executeSpy).not.toHaveBeenCalled();
    });

    it('fails loudly, rather than reporting applied: false, when the driver returns too few result sets', async () => {
      await adapter.create('posts', { id: 'p1', title: 'One' });
      batchSpy.mockResolvedValueOnce([]);

      await expect(
        adapter.atomicWrite([{ type: 'deleteIf', collection: 'posts', id: 'p1', condition: {} }])
      ).rejects.toThrow(/returned 0 result sets for 1 statements/);
    });

    it('does not touch the client for an empty batch', async () => {
      expect(await adapter.atomicWrite([])).toEqual([]);
      expect(batchSpy).not.toHaveBeenCalled();
    });

    it('maps a unique violation to UniqueConstraintError naming the conflicting table', async () => {
      await adapter.syncSchema([
        defineCollection({ slug: 'slots', fields: { key: defineField.text({ unique: true }) } })
      ]);
      await adapter.create('slots', { key: 'k' });

      const error = await adapter
        .atomicWrite([
          { type: 'create', collection: 'posts', data: { title: 'fine' } },
          { type: 'create', collection: 'slots', data: { key: 'k' } }
        ])
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UniqueConstraintError);
      expect((error as UniqueConstraintError).collection).toBe('slots');
      expect(await adapter.count('posts')).toBe(0);
    });
  });
});
