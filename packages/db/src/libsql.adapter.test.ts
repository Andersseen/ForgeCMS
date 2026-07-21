import { describe, expect, it, beforeEach } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import { LibSqlDatabaseAdapter } from './libsql.adapter.js';

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
      const created = await migrationAdapter.create('articles', { title: 'After migration', views: 5 });
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
