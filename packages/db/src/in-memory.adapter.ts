import type { CollectionDefinition } from '@forge-cms/core';
import type { DatabaseAdapter, FindManyOptions } from './index.js';
import type { DatabaseWhere } from './where.js';
import { matchesCondition } from './where.js';
import type { ResolvedIndex } from './schema-generator.js';
import { resolveCollectionIndexes } from './schema-generator.js';
import { UniqueConstraintError } from './constraint-error.js';

/**
 * Whether two field values should be considered equal for unique-index purposes. Primitives compare
 * by `===`; anything else (composite JSON values) falls back to structural equality, mirroring how
 * `@forge-cms/db`'s SQLite-backed adapters would compare their serialized `TEXT` representation.
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/**
 * Finds a unique index the candidate record would violate against `records`, or `undefined` if none.
 * Matches SQLite's unique-index semantics: a row with `null`/`undefined` in any of an index's fields
 * can never violate that index (NULL is never equal to NULL), and `excludeId` lets `update` ignore the
 * record being updated when checking against itself.
 */
function findUniqueConflict(
  records: Record<string, unknown>[],
  candidate: Record<string, unknown>,
  excludeId: string | undefined,
  indexes: ResolvedIndex[]
): ResolvedIndex | undefined {
  for (const index of indexes) {
    if (!index.unique) continue;
    if (index.fields.some((f) => candidate[f] === null || candidate[f] === undefined)) continue;

    const conflicts = records.some(
      (r) => r.id !== excludeId && index.fields.every((f) => valuesEqual(r[f], candidate[f]))
    );
    if (conflicts) return index;
  }
  return undefined;
}

export class InMemoryDatabaseAdapter implements DatabaseAdapter {
  readonly name = 'in-memory';
  private store: Map<string, Record<string, unknown>[]> = new Map();
  private collections: Map<string, CollectionDefinition> = new Map();

  init(): this {
    return this;
  }

  private assertNoUniqueConflict(
    collection: string,
    records: Record<string, unknown>[],
    candidate: Record<string, unknown>,
    excludeId: string | undefined
  ): void {
    const collectionDef = this.collections.get(collection);
    if (!collectionDef) return;

    const uniqueIndexes = resolveCollectionIndexes(collectionDef).filter((i) => i.unique);
    if (uniqueIndexes.length === 0) return;

    const conflict = findUniqueConflict(records, candidate, excludeId, uniqueIndexes);
    if (conflict) throw new UniqueConstraintError(collection, conflict.fields, conflict.name);
  }

  async findById(collection: string, id: string): Promise<Record<string, unknown> | null> {
    const records = this.store.get(collection) ?? [];
    return records.find((r) => r.id === id) ?? null;
  }

  async findMany(options: FindManyOptions): Promise<Record<string, unknown>[]> {
    let records = this.store.get(options.collection) ?? [];
    if (options.where) {
      const where = options.where;
      records = records.filter((r) =>
        Object.entries(where).every(([key, condition]) => matchesCondition(r[key], condition))
      );
    }
    if (options.sort) {
      const sortField = options.sort;
      const direction = options.order === 'desc' ? -1 : 1;
      records = [...records].sort((a, b) => {
        const aValue = a[sortField];
        const bValue = b[sortField];
        if (aValue === bValue) return 0;
        if (aValue === undefined || aValue === null) return 1;
        if (bValue === undefined || bValue === null) return -1;
        return ((aValue as string | number) < (bValue as string | number) ? -1 : 1) * direction;
      });
    }
    if (options.offset) {
      records = records.slice(options.offset);
    }
    if (options.limit) {
      records = records.slice(0, options.limit);
    }
    return records;
  }

  async create(
    collection: string,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const records = this.store.get(collection) ?? [];
    // Timestamps match LibSqlDatabaseAdapter and D1DatabaseAdapter. Without them a document created
    // in local development had no `created_at` while the same write in production did, so
    // "newest first" silently returned insertion order locally.
    const now = new Date().toISOString();
    const recordWithId = {
      ...data,
      id: data.id ?? crypto.randomUUID(),
      created_at: data.created_at ?? now,
      updated_at: now
    };
    this.assertNoUniqueConflict(collection, records, recordWithId, undefined);
    records.push(recordWithId);
    this.store.set(collection, records);
    return recordWithId;
  }

  async update(
    collection: string,
    id: string,
    data: Partial<Record<string, unknown>>
  ): Promise<Record<string, unknown>> {
    const records = this.store.get(collection) ?? [];
    const index = records.findIndex((r) => r.id === id);
    if (index === -1) {
      throw new Error(`Record ${id} not found in ${collection}`);
    }
    const merged = { ...records[index], ...data, updated_at: new Date().toISOString() };
    this.assertNoUniqueConflict(collection, records, merged, id);
    records[index] = merged;
    this.store.set(collection, records);
    return records[index];
  }

  async count(collection: string, where?: DatabaseWhere): Promise<number> {
    const records = this.store.get(collection) ?? [];
    if (!where || Object.keys(where).length === 0) return records.length;
    return records.filter((r) =>
      Object.entries(where).every(([key, condition]) => matchesCondition(r[key], condition))
    ).length;
  }

  async delete(collection: string, id: string): Promise<void> {
    const records = this.store.get(collection) ?? [];
    this.store.set(
      collection,
      records.filter((r) => r.id !== id)
    );
  }

  async syncSchema(collections: CollectionDefinition[]): Promise<void> {
    // No real table/index DDL to run, but the collection definitions are kept so create/update can
    // enforce the same unique-index semantics D1/libSQL would (see resolveCollectionIndexes above).
    this.collections.clear();
    for (const collection of collections) {
      this.collections.set(collection.slug, collection);
    }
  }
}
