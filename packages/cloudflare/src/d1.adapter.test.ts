import { describe, expect, it, beforeEach } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import { D1DatabaseAdapter } from './d1.adapter.js';
import type { D1Database, D1PreparedStatement, D1Result } from './bindings.js';

/** Simple in-memory mock of D1Database for unit testing */
class MockD1Database implements D1Database {
  private tables = new Map<string, Map<string, Record<string, unknown>>>();

  prepare(query: string): MockD1PreparedStatement {
    return new MockD1PreparedStatement(query, this.tables);
  }

  async exec(_query: string): Promise<{ count: number; duration: number }> {
    // Only CREATE TABLE is supported in exec for schema sync
    return { count: 0, duration: 0 };
  }

  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    return Promise.all(statements.map((s) => s.all<T>()));
  }
}

class MockD1PreparedStatement implements D1PreparedStatement {
  private query: string;
  private tables: Map<string, Map<string, Record<string, unknown>>>;
  private bindings: unknown[] = [];

  constructor(query: string, tables: Map<string, Map<string, Record<string, unknown>>>) {
    this.query = query;
    this.tables = tables;
  }

  bind(...values: unknown[]): MockD1PreparedStatement {
    this.bindings = values;
    return this;
  }

  async first<T = unknown>(): Promise<T | null> {
    const { table, where } = this.parseSelect();
    const rows = this.getTableRows(table);
    for (const row of rows.values()) {
      if (this.matchesWhere(row, where)) {
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
    const { table, where, limit, offset } = this.parseSelect();
    const rows = this.getTableRows(table);
    let results = Array.from(rows.values()).filter((r) => this.matchesWhere(r, where));

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
    where: Record<string, unknown>;
    limit?: number;
    offset?: number;
  } {
    const tableMatch = this.query.match(/FROM\s+"([^"]+)"/i);
    const table: string = tableMatch?.[1] ?? '';

    const where: Record<string, unknown> = {};
    const whereMatch = this.query.match(/WHERE\s+(.+)/i);
    if (whereMatch) {
      const conditions = whereMatch[1]!.split(' AND ');
      let bindingIdx = 0;
      for (const cond of conditions) {
        const colMatch = cond.match(/"([^"]+)"\s*=\s*\?/);
        if (colMatch) {
          where[colMatch[1]!] = this.bindings[bindingIdx++];
        }
      }
    }

    let limit: number | undefined;
    let offset: number | undefined;

    const limitMatch = this.query.match(/LIMIT\s+\?/i);
    if (limitMatch) {
      const limitOffsetPart = this.query.slice(this.query.indexOf('LIMIT'));
      const allBindings = limitOffsetPart.match(/\?/g);
      if (allBindings) {
        // Simplified: last binding is limit if present
        const parts = this.query.split(/\s+/);
        let bindCursor = 0;
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i]!;
          if (part.toUpperCase() === 'WHERE') {
            // Skip WHERE bindings
            for (let j = i + 1; j < parts.length; j++) {
              const innerPart = parts[j]!;
              if (innerPart === 'AND') continue;
              if (innerPart.toUpperCase() === 'LIMIT' || innerPart.toUpperCase() === 'OFFSET') break;
              bindCursor++;
            }
          }
          if (part.toUpperCase() === 'LIMIT') {
            limit = this.bindings[bindCursor] as number;
            bindCursor++;
          }
          if (part.toUpperCase() === 'OFFSET') {
            offset = this.bindings[bindCursor] as number;
            bindCursor++;
          }
        }
      }
    }

    return {
      table,
      where,
      ...(limit !== undefined && { limit }),
      ...(offset !== undefined && { offset })
    };
  }

  private matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(where)) {
      if (row[key] !== value) return false;
    }
    return true;
  }

  private handleInsert<T>(): D1Result<T> {
    const tableMatch = this.query.match(/INTO\s+"([^"]+)"/i);
    const table = tableMatch ? tableMatch[1]! : '';
    const rows = this.getTableRows(table);

    const colMatch = this.query.match(/\(([^)]+)\)/);
    const cols = colMatch
      ? colMatch[1]!.split(',').map((c) => c.trim().replace(/"/g, ''))
      : [];

    const record: Record<string, unknown> = {};
    cols.forEach((col, i) => {
      record[col] = this.bindings[i];
    });

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

    const setMatch = this.query.match(/SET\s+(.+)\s+WHERE/i);
    if (setMatch) {
      const setCols = setMatch[1]!.split(',').map((c) => c.trim().match(/"([^"]+)"/)?.[1]);
      setCols.forEach((col, i) => {
        if (col) existing[col!] = this.bindings[i];
      });
    }

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

  it('syncs schema without errors', async () => {
    await expect(adapter.syncSchema([posts])).resolves.toBeUndefined();
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
});
