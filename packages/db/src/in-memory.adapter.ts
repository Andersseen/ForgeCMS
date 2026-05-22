import type { CollectionDefinition } from '@forge-cms/core';
import type { DatabaseAdapter, FindManyOptions } from './index.js';

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
      records = records.filter((r) =>
        Object.entries(options.where!).every(([key, value]) => r[key] === value)
      );
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
