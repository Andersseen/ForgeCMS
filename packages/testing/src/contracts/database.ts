import { beforeEach, describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';

interface ContractDatabaseAdapter {
  readonly name: string;
  init(env?: unknown): unknown;
  findById(collection: string, id: string): Promise<Record<string, unknown> | null>;
  findMany(options: {
    collection: string;
    limit?: number;
    offset?: number;
    where?: Record<string, unknown>;
    sort?: string;
    order?: 'asc' | 'desc';
  }): Promise<Record<string, unknown>[]>;
  create(collection: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
  update(
    collection: string,
    id: string,
    data: Partial<Record<string, unknown>>
  ): Promise<Record<string, unknown>>;
  count(collection: string, where?: Record<string, unknown>): Promise<number>;
  delete(collection: string, id: string): Promise<void>;
  syncSchema(collections: unknown[]): Promise<void>;
}

export function runDatabaseAdapterContractTests(createAdapter: () => ContractDatabaseAdapter) {
  describe('DatabaseAdapter contract', () => {
    let adapter: ContractDatabaseAdapter;

    beforeEach(() => {
      adapter = createAdapter();
    });

    it('has a name', () => {
      expect(adapter.name).toBeTruthy();
      expect(typeof adapter.name).toBe('string');
    });

    it('creates a record with auto-generated id', async () => {
      const data = { title: 'Hello' };
      const result = await adapter.create('posts', data);
      expect(result.id).toBeTruthy();
      expect(typeof result.id).toBe('string');
      expect(result.title).toBe('Hello');
    });

    it('creates a record with provided id', async () => {
      const data = { id: '1', title: 'Hello' };
      const result = await adapter.create('posts', data);
      expect(result).toEqual(expect.objectContaining(data));
    });

    // Every adapter must stamp these, or "newest first" means different things per deployment.
    it('stamps created_at and updated_at on create', async () => {
      const created = await adapter.create('posts', { title: 'Timestamped' });

      expect(typeof created.created_at).toBe('string');
      expect(typeof created.updated_at).toBe('string');
      expect(Number.isNaN(Date.parse(String(created.created_at)))).toBe(false);

      const stored = await adapter.findById('posts', String(created.id));
      expect(stored?.created_at).toBe(created.created_at);
    });

    it('refreshes updated_at on update but keeps created_at', async () => {
      const created = await adapter.create('posts', { title: 'Before' });
      const updated = await adapter.update('posts', String(created.id), { title: 'After' });

      expect(updated.created_at).toBe(created.created_at);
      expect(Date.parse(String(updated.updated_at))).toBeGreaterThanOrEqual(
        Date.parse(String(created.updated_at))
      );
    });

    it('finds a record by id', async () => {
      const data = { id: '2', title: 'World' };
      await adapter.create('posts', data);
      const found = await adapter.findById('posts', '2');
      expect(found).toEqual(expect.objectContaining(data));
    });

    it('returns null when record not found', async () => {
      const found = await adapter.findById('posts', 'nonexistent');
      expect(found).toBeNull();
    });

    it('finds many records', async () => {
      await adapter.create('posts', { id: '3', title: 'A' });
      await adapter.create('posts', { id: '4', title: 'B' });
      const results = await adapter.findMany({ collection: 'posts' });
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('finds many with limit', async () => {
      await adapter.create('posts', { id: '5', title: 'C' });
      await adapter.create('posts', { id: '6', title: 'D' });
      const results = await adapter.findMany({ collection: 'posts', limit: 1 });
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('updates a record', async () => {
      await adapter.create('posts', { id: '7', title: 'Old' });
      const updated = await adapter.update('posts', '7', { title: 'New' });
      expect(updated).toEqual(expect.objectContaining({ id: '7', title: 'New' }));
    });

    it('deletes a record', async () => {
      await adapter.create('posts', { id: '8', title: 'ToDelete' });
      await adapter.delete('posts', '8');
      const found = await adapter.findById('posts', '8');
      expect(found).toBeNull();
    });

    it('counts records', async () => {
      await adapter.create('posts', { id: '9', title: 'Countable' });
      const count = await adapter.count('posts');
      expect(count).toBeGreaterThanOrEqual(1);
    });

    it('counts records matching a where filter', async () => {
      await adapter.create('articles', { id: 'c1', title: 'Yes', status: 'published', views: 5 });
      await adapter.create('articles', {
        id: 'c2',
        title: 'Yes too',
        status: 'published',
        views: 5
      });
      await adapter.create('articles', { id: 'c3', title: 'No', status: 'draft', views: 5 });

      expect(await adapter.count('articles', { status: 'published' })).toBe(2);
      expect(await adapter.count('articles', { status: 'draft' })).toBe(1);
    });

    it('counts the whole collection when where is empty', async () => {
      await adapter.create('articles', { id: 'c4', title: 'One', status: 'published', views: 1 });
      await adapter.create('articles', { id: 'c5', title: 'Two', status: 'draft', views: 1 });

      expect(await adapter.count('articles', {})).toBe(await adapter.count('articles'));
    });

    it('ignores limit-style pagination when counting', async () => {
      await adapter.create('articles', { id: 'c6', title: 'A', status: 'published', views: 1 });
      await adapter.create('articles', { id: 'c7', title: 'B', status: 'published', views: 1 });
      await adapter.create('articles', { id: 'c8', title: 'C', status: 'published', views: 1 });

      const page = await adapter.findMany({ collection: 'articles', limit: 2 });
      expect(page.length).toBe(2);
      // The whole point of count(): a paginator needs the total, not the page length.
      expect(await adapter.count('articles', { status: 'published' })).toBe(3);
    });

    describe('where operators', () => {
      beforeEach(async () => {
        await adapter.create('articles', { id: 'a1', title: 'Alpha', views: 10, status: 'draft' });
        await adapter.create('articles', {
          id: 'a2',
          title: 'Beta',
          views: 50,
          status: 'published'
        });
        await adapter.create('articles', {
          id: 'a3',
          title: 'Gamma',
          views: 100,
          status: 'published'
        });
      });

      it('filters with ne', async () => {
        const results = await adapter.findMany({
          collection: 'articles',
          where: { status: { ne: 'draft' } }
        });
        expect(results.map((r) => r.id).sort()).toEqual(['a2', 'a3']);
      });

      it('filters with gt', async () => {
        const results = await adapter.findMany({
          collection: 'articles',
          where: { views: { gt: 10 } }
        });
        expect(results.map((r) => r.id).sort()).toEqual(['a2', 'a3']);
      });

      it('filters with gte', async () => {
        const results = await adapter.findMany({
          collection: 'articles',
          where: { views: { gte: 50 } }
        });
        expect(results.map((r) => r.id).sort()).toEqual(['a2', 'a3']);
      });

      it('filters with lt', async () => {
        const results = await adapter.findMany({
          collection: 'articles',
          where: { views: { lt: 50 } }
        });
        expect(results.map((r) => r.id)).toEqual(['a1']);
      });

      it('filters with lte', async () => {
        const results = await adapter.findMany({
          collection: 'articles',
          where: { views: { lte: 50 } }
        });
        expect(results.map((r) => r.id).sort()).toEqual(['a1', 'a2']);
      });

      it('ANDs multiple operators on the same field', async () => {
        const results = await adapter.findMany({
          collection: 'articles',
          where: { views: { gte: 50, lte: 50 } }
        });
        expect(results.map((r) => r.id)).toEqual(['a2']);
        expect(await adapter.count('articles', { views: { gte: 50, lte: 50 } })).toBe(1);
      });

      it('filters with contains, ignoring case', async () => {
        await adapter.create('posts', { id: 'c1', title: 'Body & wellness' });
        const found = await adapter.findMany({
          collection: 'posts',
          where: { title: { contains: 'body' } }
        });

        expect(found.map((r) => r.id)).toContain('c1');
      });

      it('filters with in', async () => {
        const results = await adapter.findMany({
          collection: 'articles',
          where: { id: { in: ['a1', 'a3'] } }
        });
        expect(results.map((r) => r.id).sort()).toEqual(['a1', 'a3']);
      });

      it('filters with contains', async () => {
        const results = await adapter.findMany({
          collection: 'articles',
          where: { title: { contains: 'et' } }
        });
        expect(results.map((r) => r.id)).toEqual(['a2']);
      });

      it('still supports bare-value equality', async () => {
        const results = await adapter.findMany({
          collection: 'articles',
          where: { status: 'draft' }
        });
        expect(results.map((r) => r.id)).toEqual(['a1']);
      });

      it('sorts ascending', async () => {
        const results = await adapter.findMany({
          collection: 'articles',
          sort: 'views',
          order: 'asc'
        });
        expect(results.map((r) => r.id)).toEqual(['a1', 'a2', 'a3']);
      });

      it('sorts descending', async () => {
        const results = await adapter.findMany({
          collection: 'articles',
          sort: 'views',
          order: 'desc'
        });
        expect(results.map((r) => r.id)).toEqual(['a3', 'a2', 'a1']);
      });
    });
  });
}

function isUniqueConstraintConflict(
  err: unknown
): err is { code: string; collection?: string; fields?: string[] } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'UNIQUE_CONSTRAINT'
  );
}

async function expectUniqueConflict(promise: Promise<unknown>): Promise<void> {
  let thrown: unknown;
  try {
    await promise;
  } catch (err) {
    thrown = err;
  }
  if (!isUniqueConstraintConflict(thrown)) {
    throw new Error(
      `Expected a UNIQUE_CONSTRAINT conflict, got: ${
        thrown instanceof Error ? thrown.message : String(thrown)
      }`
    );
  }
}

/**
 * Proves single-field and compound unique-index semantics are identical across every
 * `DatabaseAdapter` — the InMemory adapter's in-process enforcement, and D1/libSQL's real SQLite
 * `UNIQUE` indexes translated to the same `{ code: 'UNIQUE_CONSTRAINT' }` shape
 * (`@forge-cms/db`'s `UniqueConstraintError`). Deliberately duck-types the conflict rather than
 * importing `@forge-cms/db`'s class, so this package's dependency graph stays `core`-only.
 */
export function runDatabaseAdapterConstraintContractTests(
  createAdapter: () => ContractDatabaseAdapter
) {
  describe('DatabaseAdapter unique constraint contract', () => {
    let adapter: ContractDatabaseAdapter;

    const widgets = defineCollection({
      slug: 'widgets',
      fields: {
        slug: defineField.text({ required: true, unique: true }),
        project: defineField.text({ required: true }),
        locale: defineField.text({ required: true }),
        namespace: defineField.text()
      },
      indexes: [{ fields: ['project', 'locale', 'namespace'], unique: true }]
    });

    beforeEach(async () => {
      adapter = createAdapter();
      await adapter.syncSchema([widgets]);
    });

    it('rejects a duplicate single-field unique value on create', async () => {
      await adapter.create('widgets', {
        slug: 'alpha',
        project: 'p1',
        locale: 'en',
        namespace: ''
      });
      await expectUniqueConflict(
        adapter.create('widgets', { slug: 'alpha', project: 'p2', locale: 'en', namespace: '' })
      );
    });

    it('rejects a duplicate compound-unique combination on create', async () => {
      await adapter.create('widgets', { slug: 'a1', project: 'A', locale: 'en', namespace: '' });
      await expectUniqueConflict(
        adapter.create('widgets', { slug: 'a2', project: 'A', locale: 'en', namespace: '' })
      );
    });

    it('allows two different compound combinations', async () => {
      await adapter.create('widgets', { slug: 'b1', project: 'A', locale: 'en', namespace: '' });
      const second = await adapter.create('widgets', {
        slug: 'b2',
        project: 'A',
        locale: 'es',
        namespace: ''
      });
      expect(second).toMatchObject({ project: 'A', locale: 'es' });
    });

    it('allows updating a record without changing its unique values', async () => {
      const created = await adapter.create('widgets', {
        slug: 'c1',
        project: 'A',
        locale: 'en',
        namespace: ''
      });
      const updated = await adapter.update('widgets', created.id as string, { namespace: '' });
      expect(updated).toMatchObject({ project: 'A', locale: 'en' });
    });

    it("rejects updating a record into another record's unique combination", async () => {
      await adapter.create('widgets', { slug: 'd1', project: 'A', locale: 'en', namespace: '' });
      const other = await adapter.create('widgets', {
        slug: 'd2',
        project: 'A',
        locale: 'es',
        namespace: ''
      });
      await expectUniqueConflict(adapter.update('widgets', other.id as string, { locale: 'en' }));
    });
  });
}
