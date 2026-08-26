import { describe, expect, it, beforeEach } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import { runDatabaseAdapterConstraintContractTests } from '@forge-cms/testing/contracts';
import { D1DatabaseAdapter } from './d1.adapter.js';
import type { D1Database, D1PreparedStatement, D1Result } from './bindings.js';

interface ParsedCondition {
  key: string;
  op: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'IN' | 'LIKE';
  values: unknown[];
}

interface MockIndex {
  table: string;
  columns: string[];
  unique: boolean;
}

/** Simple in-memory mock of D1Database for unit testing */
class MockD1Database implements D1Database {
  private tables = new Map<string, Map<string, Record<string, unknown>>>();
  /** Tracks column names per table, populated from CREATE TABLE / ALTER TABLE exec() calls,
   *  so PRAGMA table_info (used by additive migrations) reflects reality. */
  private schemas = new Map<string, Set<string>>();
  /** Tracks indexes created via `CREATE [UNIQUE] INDEX`, so insert/update can enforce uniqueness the
   *  same way real SQLite/D1 would — this is what makes the adapter's constraint-error translation
   *  code path exercisable in a unit test, rather than only hand-constructed. */
  private indexes: MockIndex[] = [];

  prepare(query: string): MockD1PreparedStatement {
    return new MockD1PreparedStatement(query, this.tables, this.schemas, this.indexes);
  }

  async exec(query: string): Promise<{ count: number; duration: number }> {
    const createMatch = query.match(/CREATE TABLE IF NOT EXISTS\s+"([^"]+)"\s*\(([^)]*)\)/i);
    if (createMatch) {
      const [, table, columnsPart] = createMatch;
      const columns = new Set(
        (columnsPart ?? '').split(',').map((c) => c.trim().match(/^"([^"]+)"/)?.[1] ?? '')
      );
      columns.delete('');
      this.schemas.set(table!, columns);
      return { count: 0, duration: 0 };
    }

    const alterMatch = query.match(/ALTER TABLE\s+"([^"]+)"\s+ADD COLUMN\s+"([^"]+)"/i);
    if (alterMatch) {
      const [, table, column] = alterMatch;
      const columns = this.schemas.get(table!) ?? new Set<string>();
      columns.add(column!);
      this.schemas.set(table!, columns);
      return { count: 0, duration: 0 };
    }

    const indexMatch = query.match(
      /CREATE\s+(UNIQUE\s+)?INDEX IF NOT EXISTS\s+"[^"]+"\s+ON\s+"([^"]+)"\s*\(([^)]*)\)/i
    );
    if (indexMatch) {
      const [, uniqueFlag, table, columnsPart] = indexMatch;
      const columns = columnsPart!
        .split(',')
        .map((c) => c.trim().match(/^"([^"]+)"/)?.[1])
        .filter((c): c is string => Boolean(c));
      this.indexes.push({ table: table!, columns, unique: Boolean(uniqueFlag) });
      return { count: 0, duration: 0 };
    }

    // Any other statement is a no-op in this mock.
    return { count: 0, duration: 0 };
  }

  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    return Promise.all(statements.map((s) => s.all<T>()));
  }
}

class MockD1PreparedStatement implements D1PreparedStatement {
  private query: string;
  private tables: Map<string, Map<string, Record<string, unknown>>>;
  private schemas: Map<string, Set<string>>;
  private indexes: MockIndex[];
  private bindings: unknown[] = [];

  constructor(
    query: string,
    tables: Map<string, Map<string, Record<string, unknown>>>,
    schemas: Map<string, Set<string>>,
    indexes: MockIndex[]
  ) {
    this.query = query;
    this.tables = tables;
    this.schemas = schemas;
    this.indexes = indexes;
  }

  /**
   * Mirrors SQLite: a row conflicts with a unique index only when every indexed column is non-null
   * and equal on both rows. Throws a message shaped like a real SQLite/D1 constraint error so the
   * adapter's `toUniqueConstraintError` parsing is exercised for real.
   */
  private assertNoUniqueConflict(
    table: string,
    candidate: Record<string, unknown>,
    excludeId?: string
  ): void {
    const rows = this.getTableRows(table);
    for (const index of this.indexes) {
      if (index.table !== table || !index.unique) continue;
      if (index.columns.some((c) => candidate[c] === null || candidate[c] === undefined)) continue;

      for (const row of rows.values()) {
        if (excludeId !== undefined && row.id === excludeId) continue;
        if (index.columns.every((c) => row[c] === candidate[c])) {
          throw new Error(
            `D1_ERROR: UNIQUE constraint failed: ${index.columns.map((c) => `${table}.${c}`).join(', ')}`
          );
        }
      }
    }
  }

  bind(...values: unknown[]): MockD1PreparedStatement {
    this.bindings = values;
    return this;
  }

  async first<T = unknown>(): Promise<T | null> {
    if (this.query.match(/SELECT\s+COUNT\s*\(/i)) {
      const { table, conditions } = this.parseSelect();
      const rows = this.getTableRows(table);
      const count = Array.from(rows.values()).filter((r) =>
        this.matchesConditions(r, conditions)
      ).length;
      return { count } as T;
    }

    const { table, conditions } = this.parseSelect();
    const rows = this.getTableRows(table);
    for (const row of rows.values()) {
      if (this.matchesConditions(row, conditions)) {
        return row as T;
      }
    }
    return null;
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    if (this.query.includes('INSERT')) {
      return this.handleInsert();
    }
    if (this.query.includes('UPDATE')) {
      return this.handleUpdate();
    }
    if (this.query.includes('DELETE')) {
      return this.handleDelete();
    }
    return { results: [], success: true };
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const pragmaMatch = this.query.match(/PRAGMA table_info\("([^"]+)"\)/i);
    if (pragmaMatch) {
      const columns = this.schemas.get(pragmaMatch[1]!) ?? new Set<string>();
      return {
        results: Array.from(columns).map((name) => ({ name }) as T),
        success: true
      };
    }

    const { table, conditions, orderBy, limit, offset } = this.parseSelect();
    const rows = this.getTableRows(table);
    let results = Array.from(rows.values()).filter((r) => this.matchesConditions(r, conditions));

    if (orderBy) {
      const direction = orderBy.direction === 'DESC' ? -1 : 1;
      results = [...results].sort((a, b) => {
        const aValue = a[orderBy.column];
        const bValue = b[orderBy.column];
        if (aValue === bValue) return 0;
        if (aValue === undefined || aValue === null) return 1;
        if (bValue === undefined || bValue === null) return -1;
        return ((aValue as string | number) < (bValue as string | number) ? -1 : 1) * direction;
      });
    }

    if (offset) results = results.slice(offset);
    if (limit !== undefined) results = results.slice(0, limit);

    return { results: results as T[], success: true };
  }

  async raw<T = unknown>(): Promise<T[]> {
    const result = await this.all<T>();
    return result.results;
  }

  private getTableRows(table: string): Map<string, Record<string, unknown>> {
    if (!this.tables.has(table)) {
      this.tables.set(table, new Map());
    }
    return this.tables.get(table)!;
  }

  private parseSelect(): {
    table: string;
    conditions: ParsedCondition[];
    orderBy?: { column: string; direction: 'ASC' | 'DESC' };
    limit?: number;
    offset?: number;
  } {
    const tableMatch = this.query.match(/FROM\s+"([^"]+)"/i);
    const table: string = tableMatch?.[1] ?? '';

    const conditions: ParsedCondition[] = [];
    let bindingIdx = 0;

    const whereMatch = this.query.match(/WHERE\s+(.+?)(?:\s+ORDER BY|\s+LIMIT|\s+OFFSET|$)/i);
    if (whereMatch) {
      for (const part of whereMatch[1]!.split(' AND ')) {
        const inMatch = part.match(/"([^"]+)"\s+IN\s*\(([^)]*)\)/i);
        if (inMatch) {
          const placeholderCount = (inMatch[2]!.match(/\?/g) ?? []).length;
          const values = this.bindings.slice(bindingIdx, bindingIdx + placeholderCount);
          bindingIdx += placeholderCount;
          conditions.push({ key: inMatch[1]!, op: 'IN', values });
          continue;
        }
        const likeMatch = part.match(/"([^"]+)"\s+LIKE\s+\?/i);
        if (likeMatch) {
          conditions.push({
            key: likeMatch[1]!,
            op: 'LIKE',
            values: [this.bindings[bindingIdx++]]
          });
          continue;
        }
        // Column name may or may not be quoted: findMany quotes it, but findById/update/delete
        // build `WHERE id = ?` unquoted.
        const cmpMatch = part.match(/"?([A-Za-z_][A-Za-z0-9_]*)"?\s*(!=|>=|<=|>|<|=)\s*\?/);
        if (cmpMatch) {
          conditions.push({
            key: cmpMatch[1]!,
            op: cmpMatch[2] as ParsedCondition['op'],
            values: [this.bindings[bindingIdx++]]
          });
        }
      }
    }

    const orderMatch = this.query.match(/ORDER BY\s+"([^"]+)"\s+(ASC|DESC)/i);
    const orderBy = orderMatch
      ? { column: orderMatch[1]!, direction: orderMatch[2]!.toUpperCase() as 'ASC' | 'DESC' }
      : undefined;

    let limit: number | undefined;
    let offset: number | undefined;
    if (/LIMIT\s+\?/i.test(this.query)) {
      limit = this.bindings[bindingIdx++] as number;
    }
    if (/OFFSET\s+\?/i.test(this.query)) {
      offset = this.bindings[bindingIdx++] as number;
    }

    return {
      table,
      conditions,
      ...(orderBy && { orderBy }),
      ...(limit !== undefined && { limit }),
      ...(offset !== undefined && { offset })
    };
  }

  private matchesConditions(row: Record<string, unknown>, conditions: ParsedCondition[]): boolean {
    return conditions.every((c) => {
      const rowValue = row[c.key];
      switch (c.op) {
        case '=':
          return rowValue === c.values[0];
        case '!=':
          return rowValue !== c.values[0];
        case '>':
          return (rowValue as number) > (c.values[0] as number);
        case '>=':
          return (rowValue as number) >= (c.values[0] as number);
        case '<':
          return (rowValue as number) < (c.values[0] as number);
        case '<=':
          return (rowValue as number) <= (c.values[0] as number);
        case 'IN':
          return c.values.includes(rowValue);
        case 'LIKE': {
          const pattern = String(c.values[0]).replace(/^%|%$/g, '');
          return typeof rowValue === 'string' && rowValue.includes(pattern);
        }
        default:
          return false;
      }
    });
  }

  private handleInsert<T>(): D1Result<T> {
    const tableMatch = this.query.match(/INTO\s+"([^"]+)"/i);
    const table = tableMatch ? tableMatch[1]! : '';
    const rows = this.getTableRows(table);

    const colMatch = this.query.match(/\(([^)]+)\)/);
    const cols = colMatch ? colMatch[1]!.split(',').map((c) => c.trim().replace(/"/g, '')) : [];

    const record: Record<string, unknown> = {};
    cols.forEach((col, i) => {
      // Mimic D1's real SQLite storage: booleans are stored as 0/1 integers.
      const value = this.bindings[i];
      record[col] = typeof value === 'boolean' ? (value ? 1 : 0) : value;
    });

    this.assertNoUniqueConflict(table, record);
    rows.set(record.id as string, record);
    return { results: [record as T], success: true };
  }

  private handleUpdate<T>(): D1Result<T> {
    const tableMatch = this.query.match(/UPDATE\s+"([^"]+)"/i);
    const table = tableMatch ? tableMatch[1]! : '';
    const rows = this.getTableRows(table);

    const id = this.bindings[this.bindings.length - 1] as string;
    const existing = rows.get(id);
    if (!existing) return { results: [], success: false };

    const merged = { ...existing };
    const setMatch = this.query.match(/SET\s+(.+)\s+WHERE/i);
    if (setMatch) {
      const setCols = setMatch[1]!.split(',').map((c) => c.trim().match(/"([^"]+)"/)?.[1]);
      setCols.forEach((col, i) => {
        if (col) merged[col!] = this.bindings[i];
      });
    }

    this.assertNoUniqueConflict(table, merged, id);
    Object.assign(existing, merged);
    return { results: [existing as T], success: true };
  }

  private handleDelete<T>(): D1Result<T> {
    const tableMatch = this.query.match(/FROM\s+"([^"]+)"/i);
    const table: string = tableMatch?.[1] ?? '';
    const rows = this.getTableRows(table);
    const id = this.bindings[0] as string;
    rows.delete(id);
    return { results: [], success: true };
  }
}

runDatabaseAdapterConstraintContractTests(() => {
  const adapter = new D1DatabaseAdapter();
  adapter.init({ DB: new MockD1Database() });
  return adapter;
});

describe('D1DatabaseAdapter', () => {
  let adapter: D1DatabaseAdapter;
  let mockDb: MockD1Database;

  const posts = defineCollection({
    slug: 'posts',
    fields: {
      title: defineField.text({ required: true }),
      published: defineField.boolean(),
      views: defineField.number(),
      tags: defineField.relation({ collection: 'tags', many: true })
    }
  });

  beforeEach(() => {
    mockDb = new MockD1Database();
    adapter = new D1DatabaseAdapter();
    adapter.init({ DB: mockDb });
  });

  it('initialises with DB binding', () => {
    expect(adapter.name).toBe('d1');
  });

  it('throws if DB binding is missing', () => {
    const badAdapter = new D1DatabaseAdapter();
    expect(() => badAdapter.init({})).toThrow('D1DatabaseAdapter requires env.DB binding');
  });

  it('reads a custom binding name (spec 040)', async () => {
    const custom = new D1DatabaseAdapter({ binding: 'CONTENT_DB' });
    custom.init({ CONTENT_DB: mockDb });

    await expect(custom.syncSchema([posts])).resolves.toBeUndefined();
  });

  it('names the binding it looked for when it is missing', () => {
    const custom = new D1DatabaseAdapter({ binding: 'CONTENT_DB' });
    expect(() => custom.init({ DB: mockDb })).toThrow(
      'D1DatabaseAdapter requires env.CONTENT_DB binding'
    );
  });

  it('syncs schema without errors', async () => {
    await expect(adapter.syncSchema([posts])).resolves.toBeUndefined();
  });

  describe('additive schema migrations', () => {
    it('adds a column for a field added to the collection definition after the table exists', async () => {
      const v1 = defineCollection({
        slug: 'articles',
        fields: { title: defineField.text({ required: true }) }
      });
      await adapter.syncSchema([v1]);
      const existing = await adapter.create('articles', { title: 'Before migration' });

      const v2 = defineCollection({
        slug: 'articles',
        fields: {
          title: defineField.text({ required: true }),
          views: defineField.number()
        }
      });
      await adapter.syncSchema([v2]);

      const found = await adapter.findById('articles', existing.id as string);
      expect(found?.title).toBe('Before migration');

      const created = await adapter.create('articles', { title: 'After migration', views: 5 });
      const foundNew = await adapter.findById('articles', created.id as string);
      expect(foundNew?.views).toBe(5);
    });

    it('is idempotent: re-syncing an unchanged collection does not error', async () => {
      await adapter.syncSchema([posts]);
      await expect(adapter.syncSchema([posts])).resolves.toBeUndefined();
    });
  });

  it('creates and finds a record', async () => {
    await adapter.syncSchema([posts]);

    const created = await adapter.create('posts', {
      title: 'Hello D1',
      published: true,
      views: 42,
      tags: ['tag1', 'tag2']
    });

    const createdId = created.id as string;
    expect(createdId).toBeTruthy();
    expect(created.title).toBe('Hello D1');

    const found = await adapter.findById('posts', createdId);
    expect(found).toBeTruthy();
    expect(found?.title).toBe('Hello D1');
  });

  it('hydrates boolean fields', async () => {
    await adapter.syncSchema([posts]);

    const created = await adapter.create('posts', { title: 'Bool Test', published: true });
    const found = await adapter.findById('posts', created.id as string);
    expect(found).toBeTruthy();
    expect(found!.published).toBe(true);
  });

  it('hydrates relation arrays', async () => {
    await adapter.syncSchema([posts]);

    const created = await adapter.create('posts', {
      title: 'Rel Test',
      tags: ['a', 'b', 'c']
    });
    const found = await adapter.findById('posts', created.id as string);
    expect(found).toBeTruthy();
    expect(Array.isArray(found!.tags)).toBe(true);
    expect(found!.tags).toEqual(['a', 'b', 'c']);
  });

  it('finds many with pagination', async () => {
    await adapter.syncSchema([posts]);

    await adapter.create('posts', { title: 'A' });
    await adapter.create('posts', { title: 'B' });
    await adapter.create('posts', { title: 'C' });

    const results = await adapter.findMany({ collection: 'posts', limit: 2 });
    expect(results).toHaveLength(2);
  });

  it('filters by boolean fields by coercing true/false to 1/0 bindings', async () => {
    await adapter.syncSchema([posts]);

    await adapter.create('posts', { title: 'Published', published: true });
    await adapter.create('posts', { title: 'Draft', published: false });

    const results = await adapter.findMany({
      collection: 'posts',
      where: { published: true }
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe('Published');
  });

  it('updates a record', async () => {
    await adapter.syncSchema([posts]);

    const created = await adapter.create('posts', { title: 'Old', views: 10 });
    const createdId = created.id as string;
    const updated = await adapter.update('posts', createdId, { title: 'New', views: 20 });

    expect(updated.title).toBe('New');
    expect(updated.views).toBe(20);
  });

  it('deletes a record', async () => {
    await adapter.syncSchema([posts]);

    const created = await adapter.create('posts', { title: 'Delete Me' });
    const createdId = created.id as string;
    await adapter.delete('posts', createdId);

    const found = await adapter.findById('posts', createdId);
    expect(found).toBeNull();
  });

  it('counts records without fetching them all', async () => {
    await adapter.syncSchema([posts]);

    await adapter.create('posts', { title: 'One' });
    await adapter.create('posts', { title: 'Two' });
    await adapter.create('posts', { title: 'Three' });

    const count = await adapter.count('posts');
    expect(count).toBe(3);
  });

  describe('where operators and sorting', () => {
    beforeEach(async () => {
      await adapter.syncSchema([posts]);
      await adapter.create('posts', { id: 'p1', title: 'Alpha', views: 10 });
      await adapter.create('posts', { id: 'p2', title: 'Beta', views: 50 });
      await adapter.create('posts', { id: 'p3', title: 'Gamma', views: 100 });
    });

    it('filters with gt/gte/lt/lte/ne', async () => {
      expect(
        (await adapter.findMany({ collection: 'posts', where: { views: { gt: 10 } } })).map(
          (r) => r.id
        )
      ).toEqual(expect.arrayContaining(['p2', 'p3']));
      expect(
        (await adapter.findMany({ collection: 'posts', where: { views: { lt: 50 } } })).map(
          (r) => r.id
        )
      ).toEqual(['p1']);
      expect(
        (await adapter.findMany({ collection: 'posts', where: { views: { gte: 50 } } })).map(
          (r) => r.id
        )
      ).toEqual(expect.arrayContaining(['p2', 'p3']));
      expect(
        (await adapter.findMany({ collection: 'posts', where: { views: { lte: 50 } } })).map(
          (r) => r.id
        )
      ).toEqual(expect.arrayContaining(['p1', 'p2']));
      expect(
        (await adapter.findMany({ collection: 'posts', where: { title: { ne: 'Alpha' } } })).map(
          (r) => r.id
        )
      ).toEqual(expect.arrayContaining(['p2', 'p3']));
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
      await expect(adapter.delete('posts"; DROP TABLE posts; --', 'p1')).rejects.toThrow(
        'not registered'
      );
      await expect(adapter.count('posts"; DROP TABLE posts; --')).rejects.toThrow('not registered');
    });

    it('sorts ascending and descending', async () => {
      const asc = await adapter.findMany({ collection: 'posts', sort: 'views', order: 'asc' });
      expect(asc.map((r) => r.id)).toEqual(['p1', 'p2', 'p3']);

      const desc = await adapter.findMany({ collection: 'posts', sort: 'views', order: 'desc' });
      expect(desc.map((r) => r.id)).toEqual(['p3', 'p2', 'p1']);
    });

    it('rejects an unknown sort column', async () => {
      await expect(adapter.findMany({ collection: 'posts', sort: 'nonexistent' })).rejects.toThrow(
        "Unknown column 'nonexistent'"
      );
    });
  });
});
