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

// --- Query completeness & adapter parity (spec 050) ---------------------------------------------

type QueryWhereCondition = unknown | Record<string, unknown>;
type QueryWhereFields = Record<string, QueryWhereCondition>;
interface QueryWhereAndGroup {
  and: QueryWhere[];
}
interface QueryWhereOrGroup {
  or: QueryWhere[];
}
type QueryWhere = QueryWhereFields | QueryWhereAndGroup | QueryWhereOrGroup;
interface QuerySortField {
  field: string;
  order?: 'asc' | 'desc';
}
type QuerySortInput = string | QuerySortField[];

interface ContractQueryDatabaseAdapter {
  readonly name: string;
  findMany(options: {
    collection: string;
    limit?: number;
    offset?: number;
    where?: QueryWhere;
    sort?: QuerySortInput;
    order?: 'asc' | 'desc';
  }): Promise<Record<string, unknown>[]>;
  create(collection: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
  count(collection: string, where?: QueryWhere): Promise<number>;
  syncSchema(collections: unknown[]): Promise<void>;
}

/**
 * Proves nested `and`/`or` boolean queries, multi-field sort, and relation-array membership
 * (`containsValue`) find/count identically across every `DatabaseAdapter` (spec 050 §15). One shared
 * `articles` dataset, one shared set of query cases, run from InMemory, a real libSQL `:memory:`
 * database, and the D1 mock — an adapter-behavior divergence here would otherwise only surface as a
 * production bug on whichever adapter wasn't exercised.
 */
export function runDatabaseAdapterQueryContractTests(
  createAdapter: () => ContractQueryDatabaseAdapter
) {
  describe('DatabaseAdapter query contract (nested and/or, multi-sort, containsValue)', () => {
    let adapter: ContractQueryDatabaseAdapter;

    const articles = defineCollection({
      slug: 'articles',
      fields: {
        title: defineField.text({ required: true }),
        category: defineField.text(),
        status: defineField.text(),
        featured: defineField.boolean(),
        views: defineField.number(),
        tags: defineField.relation({ collection: 'tags', many: true })
      }
    });

    beforeEach(async () => {
      adapter = createAdapter();
      await adapter.syncSchema([articles]);

      await adapter.create('articles', {
        id: 'q1',
        title: 'Published News',
        category: 'news',
        status: 'published',
        featured: false,
        views: 50,
        tags: ['a', 'b']
      });
      await adapter.create('articles', {
        id: 'q2',
        title: 'Published Featured',
        category: 'opinion',
        status: 'published',
        featured: true,
        views: 10,
        tags: ['b', 'c']
      });
      await adapter.create('articles', {
        id: 'q3',
        title: 'Draft News',
        category: 'news',
        status: 'draft',
        featured: false,
        views: 200,
        tags: ['c']
      });
      await adapter.create('articles', {
        id: 'q4',
        title: 'Draft Featured',
        category: 'opinion',
        status: 'draft',
        featured: true,
        views: 5,
        tags: []
      });
    });

    it('still supports flat implicit-AND across fields (backward compatibility)', async () => {
      const results = await adapter.findMany({
        collection: 'articles',
        where: { status: 'published', category: 'news' }
      });
      expect(results.map((r) => r.id)).toEqual(['q1']);
    });

    it('ANDs a top-level `and` group', async () => {
      const results = await adapter.findMany({
        collection: 'articles',
        where: { and: [{ status: 'published' }, { category: 'news' }] }
      });
      expect(results.map((r) => r.id)).toEqual(['q1']);
    });

    it('ORs a top-level `or` group', async () => {
      const results = await adapter.findMany({
        collection: 'articles',
        where: { or: [{ category: 'news' }, { featured: true }] }
      });
      expect(results.map((r) => r.id).sort()).toEqual(['q1', 'q2', 'q3', 'q4']);
    });

    it('nests an `or` inside an `and`', async () => {
      const results = await adapter.findMany({
        collection: 'articles',
        where: {
          and: [{ status: 'published' }, { or: [{ category: 'news' }, { featured: true }] }]
        }
      });
      expect(results.map((r) => r.id).sort()).toEqual(['q1', 'q2']);
    });

    it('nests an `and` inside an `or`', async () => {
      const results = await adapter.findMany({
        collection: 'articles',
        where: {
          or: [
            { and: [{ status: 'draft' }, { featured: true }] },
            { and: [{ status: 'published' }, { category: 'news' }] }
          ]
        }
      });
      expect(results.map((r) => r.id).sort()).toEqual(['q1', 'q4']);
    });

    it('composes nested groups with field operators', async () => {
      const results = await adapter.findMany({
        collection: 'articles',
        where: { and: [{ status: { eq: 'published' } }, { views: { gte: 10 } }] }
      });
      expect(results.map((r) => r.id).sort()).toEqual(['q1', 'q2']);
    });

    it('count() matches find() under the same nested filter', async () => {
      const where: QueryWhere = {
        and: [{ status: 'published' }, { or: [{ category: 'news' }, { featured: true }] }]
      };
      const found = await adapter.findMany({ collection: 'articles', where });
      const counted = await adapter.count('articles', where);
      expect(counted).toBe(found.length);
      expect(counted).toBe(2);
    });

    it('sorts by multiple fields, first field wins ties', async () => {
      const results = await adapter.findMany({
        collection: 'articles',
        sort: [
          { field: 'featured', order: 'desc' },
          { field: 'views', order: 'asc' }
        ]
      });
      expect(results.map((r) => r.id)).toEqual(['q4', 'q2', 'q1', 'q3']);
    });

    it('keeps single-field sort working (backward compatibility)', async () => {
      const results = await adapter.findMany({
        collection: 'articles',
        sort: 'views',
        order: 'asc'
      });
      expect(results.map((r) => r.id)).toEqual(['q4', 'q2', 'q1', 'q3']);
    });

    it('filters relation-array membership with containsValue', async () => {
      const results = await adapter.findMany({
        collection: 'articles',
        where: { tags: { containsValue: 'b' } }
      });
      expect(results.map((r) => r.id).sort()).toEqual(['q1', 'q2']);
    });

    it('containsValue finds nothing against an empty relation array', async () => {
      const results = await adapter.findMany({
        collection: 'articles',
        where: { tags: { containsValue: 'z' } }
      });
      expect(results).toEqual([]);
    });

    it('combines containsValue with a nested group', async () => {
      const results = await adapter.findMany({
        collection: 'articles',
        where: { and: [{ status: 'published' }, { tags: { containsValue: 'c' } }] }
      });
      expect(results.map((r) => r.id)).toEqual(['q2']);
    });

    // Empty groups: an access-rule constraint that legitimately narrows to zero possibilities (e.g.
    // `{ or: user.tenants.map(...) }` for a tenant-less user) is never validated the way caller-supplied
    // `where` is — the adapter itself must interpret an empty group correctly, matching the standard
    // empty-conjunction/-disjunction identities `matchesWhere` (the InMemory reference) already uses.
    // A real bug once had libSQL/D1 compile an empty `or` to "no filter" (all rows) instead of "no
    // match" (spec 050 hardening).
    it('an empty `or: []` matches nothing, identically to `matchesWhere`', async () => {
      const results = await adapter.findMany({ collection: 'articles', where: { or: [] } });
      expect(results).toEqual([]);
      expect(await adapter.count('articles', { or: [] })).toBe(0);
    });

    it('an empty `and: []` matches everything, identically to `matchesWhere`', async () => {
      const results = await adapter.findMany({ collection: 'articles', where: { and: [] } });
      expect(results.map((r) => r.id).sort()).toEqual(['q1', 'q2', 'q3', 'q4']);
      expect(await adapter.count('articles', { and: [] })).toBe(4);
    });

    it('an empty `or: []` nested inside an `and` still zeroes out the whole result', async () => {
      const results = await adapter.findMany({
        collection: 'articles',
        where: { and: [{ status: 'published' }, { or: [] }] }
      });
      expect(results).toEqual([]);
    });

    // Mixed keys: `and`/`or` are reserved keys, not the only key a where node may carry — a sibling
    // flat field must stay AND-ed in, not silently dropped (spec 050 hardening).
    it('ANDs a flat key with a sibling `or` group instead of dropping the flat key', async () => {
      const results = await adapter.findMany({
        collection: 'articles',
        where: { status: 'draft', or: [{ category: 'news' }, { featured: true }] }
      });
      expect(results.map((r) => r.id).sort()).toEqual(['q3', 'q4']);
    });
  });
}

// --- Conditional writes (spec 059) ---------------------------------------------------------------

type ContractWhere = Record<string, unknown>;

interface ContractWriteCondition {
  targetMatches?: ContractWhere;
  keepAtLeast?: { where: ContractWhere; others: number };
}

type ContractConditionalUpdateResult =
  | { applied: true; record: Record<string, unknown> }
  | { applied: false };

interface ContractConditionalDatabaseAdapter extends ContractDatabaseAdapter {
  updateIf(
    collection: string,
    id: string,
    data: Record<string, unknown>,
    condition: ContractWriteCondition
  ): Promise<ContractConditionalUpdateResult>;
  deleteIf(
    collection: string,
    id: string,
    condition: ContractWriteCondition
  ): Promise<{ applied: boolean }>;
}

const ADMINS_ONLY: ContractWriteCondition = {
  keepAtLeast: { where: { role: 'admin' }, others: 1 }
};

/**
 * Proves `updateIf`/`deleteIf` semantics (spec 059) are identical across every `DatabaseAdapter` —
 * apart from the pre-existing `DatabaseWhere` `ne`-on-NULL divergence (JS `undefined !== x` is true, SQL
 * `NULL != x` is unknown), which this suite deliberately does not exercise and which `targetMatches`
 * inherits (use `eq`, or `in`, for compare-and-set) —
 * applied vs. not-applied results, missing targets, both condition clauses, evaluation against the
 * row's *current* state, conflicting writers, precedence over unique constraints, and no partial
 * application. It uses two fixed collections, `roster` and `roster_other` — an adapter over a
 * persistent store must be empty of both between tests (the InMemory/libSQL suites get that from a
 * fresh adapter; `packages/cloudflare/test/workers` clears the two tables in a `beforeEach`).
 *
 * The concurrent cases assert only the *outcome* that atomicity guarantees (exactly one of two
 * conflicting writers wins), which holds under any interleaving. Forcing a particular interleaving is
 * `runLastAdminConcurrencyContractTests`' job.
 */
export function runDatabaseAdapterConditionalWriteContractTests(
  createAdapter: () => ContractConditionalDatabaseAdapter
) {
  describe('DatabaseAdapter conditional write contract (spec 059)', () => {
    let adapter: ContractConditionalDatabaseAdapter;

    const roster = defineCollection({
      slug: 'roster',
      fields: {
        email: defineField.text({ required: true, unique: true }),
        role: defineField.text(),
        team: defineField.text(),
        version: defineField.number()
      }
    });
    const rosterOther = defineCollection({
      slug: 'roster_other',
      fields: {
        email: defineField.text({ required: true, unique: true }),
        role: defineField.text()
      }
    });

    async function seed(id: string, fields: Record<string, unknown> = {}): Promise<void> {
      await adapter.create('roster', { id, email: `${id}@example.com`, ...fields });
    }

    async function roleOf(id: string): Promise<unknown> {
      return (await adapter.findById('roster', id))?.role;
    }

    beforeEach(async () => {
      adapter = createAdapter();
      await adapter.syncSchema([roster, rosterOther]);
    });

    describe('updateIf', () => {
      it('applies when targetMatches holds and returns the row as written', async () => {
        await seed('u1', { role: 'editor', version: 1 });
        const before = await adapter.findById('roster', 'u1');

        const result = await adapter.updateIf(
          'roster',
          'u1',
          { role: 'admin', version: 2 },
          { targetMatches: { version: 1 } }
        );

        expect(result.applied).toBe(true);
        if (!result.applied) return;
        expect(result.record).toMatchObject({ id: 'u1', role: 'admin', version: 2 });
        expect(result.record.created_at).toBe(before?.created_at);
        expect(Date.parse(String(result.record.updated_at))).toBeGreaterThanOrEqual(
          Date.parse(String(before?.updated_at))
        );
        // The stored row is exactly what the result reports.
        expect(await adapter.findById('roster', 'u1')).toEqual(result.record);
      });

      it('does not apply, and changes nothing, when targetMatches fails', async () => {
        await seed('u2', { role: 'editor', version: 1 });
        const before = await adapter.findById('roster', 'u2');

        const result = await adapter.updateIf(
          'roster',
          'u2',
          { role: 'admin', version: 2 },
          { targetMatches: { version: 99 } }
        );

        expect(result).toEqual({ applied: false });
        expect(await adapter.findById('roster', 'u2')).toEqual(before);
      });

      it('treats a missing target as not applied (not an error) and never creates the row', async () => {
        const result = await adapter.updateIf('roster', 'ghost', { role: 'admin' }, {});
        expect(result).toEqual({ applied: false });
        expect(await adapter.findById('roster', 'ghost')).toBeNull();
      });

      it('an empty condition holds whenever the row exists', async () => {
        await seed('u3', { role: 'editor' });
        const result = await adapter.updateIf('roster', 'u3', { role: 'viewer' }, {});
        expect(result.applied).toBe(true);
        expect(await roleOf('u3')).toBe('viewer');
      });

      it('never rewrites the id', async () => {
        await seed('u4', { role: 'editor' });
        const result = await adapter.updateIf('roster', 'u4', { id: 'hijacked', role: 'x' }, {});
        expect(result.applied).toBe(true);
        expect(await adapter.findById('roster', 'hijacked')).toBeNull();
        expect(await roleOf('u4')).toBe('x');
      });

      it('evaluates targetMatches with the full query language (operators, and/or)', async () => {
        await seed('u5', { role: 'editor', version: 5, team: 'red' });
        const refused = await adapter.updateIf(
          'roster',
          'u5',
          { role: 'z' },
          { targetMatches: { and: [{ version: { gt: 5 } }, { team: 'red' }] } }
        );
        expect(refused.applied).toBe(false);
        const applied = await adapter.updateIf(
          'roster',
          'u5',
          { role: 'z' },
          {
            targetMatches: {
              and: [{ version: { gte: 5 } }, { or: [{ team: 'blue' }, { team: 'red' }] }]
            }
          }
        );
        expect(applied.applied).toBe(true);
      });
    });

    describe('deleteIf', () => {
      it('deletes when the condition holds', async () => {
        await seed('d1', { version: 1 });
        const result = await adapter.deleteIf('roster', 'd1', { targetMatches: { version: 1 } });
        expect(result).toEqual({ applied: true });
        expect(await adapter.findById('roster', 'd1')).toBeNull();
      });

      it('keeps the row when the condition fails', async () => {
        await seed('d2', { version: 1 });
        const result = await adapter.deleteIf('roster', 'd2', { targetMatches: { version: 2 } });
        expect(result).toEqual({ applied: false });
        expect(await adapter.findById('roster', 'd2')).not.toBeNull();
      });

      it('treats a missing target as not applied (not an error)', async () => {
        expect(await adapter.deleteIf('roster', 'ghost', {})).toEqual({ applied: false });
      });

      it('reports applied: false the second time (idempotent, accurate)', async () => {
        await seed('d3');
        expect(await adapter.deleteIf('roster', 'd3', {})).toEqual({ applied: true });
        expect(await adapter.deleteIf('roster', 'd3', {})).toEqual({ applied: false });
      });
    });

    describe('keepAtLeast (set floor)', () => {
      it('lets a member leave while enough others remain, then refuses the last', async () => {
        await seed('a', { role: 'admin' });
        await seed('b', { role: 'admin' });

        const first = await adapter.updateIf('roster', 'a', { role: 'editor' }, ADMINS_ONLY);
        expect(first.applied).toBe(true);
        expect(await roleOf('a')).toBe('editor');

        const last = await adapter.updateIf('roster', 'b', { role: 'editor' }, ADMINS_ONLY);
        expect(last).toEqual({ applied: false });
        expect(await roleOf('b')).toBe('admin');
        expect(await adapter.count('roster', { role: 'admin' })).toBe(1);
      });

      it('applies the same floor to deleteIf', async () => {
        await seed('a', { role: 'admin' });
        await seed('b', { role: 'admin' });

        expect(await adapter.deleteIf('roster', 'a', ADMINS_ONLY)).toEqual({ applied: true });
        expect(await adapter.deleteIf('roster', 'b', ADMINS_ONLY)).toEqual({ applied: false });
        expect(await adapter.findById('roster', 'b')).not.toBeNull();
      });

      it('honours the exact boundary of `others`', async () => {
        await seed('a', { role: 'admin' });
        await seed('b', { role: 'admin' });
        await seed('c', { role: 'admin' });
        const needTwo: ContractWriteCondition = {
          keepAtLeast: { where: { role: 'admin' }, others: 2 }
        };

        expect((await adapter.updateIf('roster', 'a', { role: 'editor' }, needTwo)).applied).toBe(
          true
        );
        // Only b and c remain: b has exactly one other member, but two are required.
        expect((await adapter.updateIf('roster', 'b', { role: 'editor' }, needTwo)).applied).toBe(
          false
        );
        expect(await adapter.count('roster', { role: 'admin' })).toBe(2);
      });

      it('holds vacuously for a target that is not in the set, even when the set is empty', async () => {
        await seed('e', { role: 'editor' });
        await seed('n'); // role never set: NULL must mean "not a member", not "unknown"

        expect(
          (await adapter.updateIf('roster', 'e', { role: 'viewer' }, ADMINS_ONLY)).applied
        ).toBe(true);
        expect(await adapter.deleteIf('roster', 'n', ADMINS_ONLY)).toEqual({ applied: true });
        expect(await adapter.deleteIf('roster', 'e', ADMINS_ONLY)).toEqual({ applied: true });
      });

      it('`others: 0` always holds', async () => {
        await seed('a', { role: 'admin' });
        const result = await adapter.deleteIf('roster', 'a', {
          keepAtLeast: { where: { role: 'admin' }, others: 0 }
        });
        expect(result).toEqual({ applied: true });
      });

      it('counts only members matching the whole `where`, not the target itself', async () => {
        await seed('a', { role: 'admin', team: 'red' });
        await seed('b', { role: 'admin', team: 'blue' });
        const redAdmins: ContractWriteCondition = {
          keepAtLeast: { where: { and: [{ role: 'admin' }, { team: 'red' }] }, others: 1 }
        };

        // b is an admin but not a red admin; a is the only red admin, so nobody else backs it up.
        expect((await adapter.updateIf('roster', 'a', { role: 'editor' }, redAdmins)).applied).toBe(
          false
        );
        // b is not in the red-admin set at all, so the floor is vacuous for it.
        expect((await adapter.updateIf('roster', 'b', { role: 'editor' }, redAdmins)).applied).toBe(
          true
        );
      });

      it('is scoped to the write’s own collection', async () => {
        await seed('a', { role: 'admin' });
        await adapter.create('roster_other', { id: 'o1', email: 'o1@example.com', role: 'admin' });
        await adapter.create('roster_other', { id: 'o2', email: 'o2@example.com', role: 'admin' });

        // Plenty of admins in the other collection must not satisfy this collection's floor.
        expect(await adapter.deleteIf('roster', 'a', ADMINS_ONLY)).toEqual({ applied: false });
        expect(await adapter.count('roster_other', { role: 'admin' })).toBe(2);
      });

      it('uses the row’s current state, not what the caller last saw', async () => {
        await seed('a', { role: 'admin' });
        await seed('b', { role: 'admin' });
        // The caller of the next write "saw" two admins; a plain write removes one behind its back.
        await adapter.update('roster', 'b', { role: 'editor' });

        expect(await adapter.updateIf('roster', 'a', { role: 'editor' }, ADMINS_ONLY)).toEqual({
          applied: false
        });
        expect(await roleOf('a')).toBe('admin');
      });

      it('requires every clause: a passing floor cannot rescue a failing targetMatches, and vice versa', async () => {
        await seed('a', { role: 'admin', version: 1 });
        await seed('b', { role: 'admin', version: 1 });

        const floorOkTargetBad = { ...ADMINS_ONLY, targetMatches: { version: 2 } };
        expect(
          (await adapter.updateIf('roster', 'a', { role: 'x' }, floorOkTargetBad)).applied
        ).toBe(false);

        await adapter.updateIf('roster', 'b', { role: 'editor' }, {});
        const targetOkFloorBad = { ...ADMINS_ONLY, targetMatches: { version: 1 } };
        expect(
          (await adapter.updateIf('roster', 'a', { role: 'x' }, targetOkFloorBad)).applied
        ).toBe(false);
        expect(await roleOf('a')).toBe('admin');
      });
    });

    describe('conflicting writers', () => {
      it('a stale compare-and-set loses: the second of two writers holding the same expectation is refused', async () => {
        await seed('v', { version: 1 });
        const bump = { targetMatches: { version: 1 } };

        const first = await adapter.updateIf('roster', 'v', { version: 2 }, bump);
        const second = await adapter.updateIf('roster', 'v', { version: 2 }, bump);

        expect(first.applied).toBe(true);
        expect(second.applied).toBe(false);
      });

      it('exactly one of two concurrent compare-and-set writers wins', async () => {
        await seed('v', { version: 1 });
        const bump = { targetMatches: { version: 1 } };

        const results = await Promise.all([
          adapter.updateIf('roster', 'v', { role: 'p1', version: 2 }, bump),
          adapter.updateIf('roster', 'v', { role: 'p2', version: 2 }, bump)
        ]);

        expect(results.filter((r) => r.applied)).toHaveLength(1);
        const stored = await adapter.findById('roster', 'v');
        expect(stored?.version).toBe(2);
        // The surviving value is the winner's, whole — no field-by-field mixture.
        expect(['p1', 'p2']).toContain(stored?.role);
      });

      it('two concurrent demotions of the last two admins never both apply', async () => {
        await seed('a', { role: 'admin' });
        await seed('b', { role: 'admin' });

        const results = await Promise.all([
          adapter.updateIf('roster', 'a', { role: 'editor' }, ADMINS_ONLY),
          adapter.updateIf('roster', 'b', { role: 'editor' }, ADMINS_ONLY)
        ]);

        expect(results.filter((r) => r.applied)).toHaveLength(1);
        expect(await adapter.count('roster', { role: 'admin' })).toBe(1);
      });

      it('a concurrent delete and demotion of the last two admins never both apply', async () => {
        await seed('a', { role: 'admin' });
        await seed('b', { role: 'admin' });

        const [deleted, demoted] = await Promise.all([
          adapter.deleteIf('roster', 'a', ADMINS_ONLY),
          adapter.updateIf('roster', 'b', { role: 'editor' }, ADMINS_ONLY)
        ]);

        expect([deleted.applied, demoted.applied].filter(Boolean)).toHaveLength(1);
        expect(await adapter.count('roster', { role: 'admin' })).toBe(1);
      });

      it('three admins racing to leave: exactly two succeed, one stays', async () => {
        for (const id of ['a', 'b', 'c']) await seed(id, { role: 'admin' });

        const results = await Promise.all(
          ['a', 'b', 'c'].map((id) =>
            adapter.updateIf('roster', id, { role: 'editor' }, ADMINS_ONLY)
          )
        );

        expect(results.filter((r) => r.applied)).toHaveLength(2);
        expect(await adapter.count('roster', { role: 'admin' })).toBe(1);
      });

      it('does not over-block writers that do not conflict', async () => {
        await seed('a', { role: 'admin' });
        await seed('b', { role: 'admin' });
        await seed('e', { role: 'editor' });

        const [demoted, deleted] = await Promise.all([
          adapter.updateIf('roster', 'a', { role: 'editor' }, ADMINS_ONLY),
          adapter.deleteIf('roster', 'e', ADMINS_ONLY)
        ]);

        expect(demoted.applied).toBe(true);
        expect(deleted.applied).toBe(true);
      });
    });

    describe('unique constraints and partial application', () => {
      it('a failed condition wins over a would-be unique conflict (reports not applied)', async () => {
        await seed('x1', { role: 'editor' });
        await seed('x2', { role: 'editor' });

        const result = await adapter.updateIf(
          'roster',
          'x2',
          { email: 'x1@example.com' },
          { targetMatches: { role: 'nobody' } }
        );
        expect(result).toEqual({ applied: false });
      });

      it('throws the unique-constraint error when the condition holds but the write would conflict', async () => {
        await seed('x1', { role: 'editor' });
        await seed('x2', { role: 'editor' });

        await expectUniqueConflict(
          adapter.updateIf(
            'roster',
            'x2',
            { email: 'x1@example.com' },
            { targetMatches: { role: 'editor' } }
          )
        );
      });

      it('applies none of the changes when one of them violates a unique index', async () => {
        await seed('x1', { role: 'editor' });
        await seed('x2', { role: 'editor', team: 'red' });
        const before = await adapter.findById('roster', 'x2');

        await expectUniqueConflict(
          adapter.updateIf(
            'roster',
            'x2',
            { team: 'blue', role: 'admin', email: 'x1@example.com' },
            {}
          )
        );

        expect(await adapter.findById('roster', 'x2')).toEqual(before);
      });
    });

    describe('invalid conditions', () => {
      // `undefined` (a JS caller omitting `others`) is the value that once slipped past InMemory only.
      for (const others of [-1, 1.5, Number.NaN, undefined as unknown as number]) {
        it(`rejects keepAtLeast.others = ${others} before writing anything`, async () => {
          await seed('a', { role: 'admin' });
          await seed('b', { role: 'admin' });
          const bad: ContractWriteCondition = { keepAtLeast: { where: { role: 'admin' }, others } };

          await expect(adapter.updateIf('roster', 'a', { role: 'editor' }, bad)).rejects.toThrow();
          await expect(adapter.deleteIf('roster', 'a', bad)).rejects.toThrow();
          expect(await adapter.count('roster', { role: 'admin' })).toBe(2);
        });
      }
    });
  });
}
