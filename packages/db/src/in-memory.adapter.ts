import type { CollectionDefinition } from '@forge-cms/core';
import type { DatabaseAdapter, FindManyOptions } from './index.js';
import { matchesCondition } from './where.js';

export class InMemoryDatabaseAdapter implements DatabaseAdapter {
  readonly name = 'in-memory';
  private store: Map<string, Record<string, unknown>[]> = new Map();

  init(): this {
    return this;
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
    const recordWithId = data.id ? data : { ...data, id: crypto.randomUUID() };
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
    records[index] = { ...records[index], ...data };
    this.store.set(collection, records);
    return records[index];
  }

  async count(collection: string): Promise<number> {
    return this.store.get(collection)?.length ?? 0;
  }

  async delete(collection: string, id: string): Promise<void> {
    const records = this.store.get(collection) ?? [];
    this.store.set(
      collection,
      records.filter((r) => r.id !== id)
    );
  }

  async syncSchema(_collections: CollectionDefinition[]): Promise<void> {
    // In-memory adapter does not need schema synchronization
    void _collections;
  }
}
