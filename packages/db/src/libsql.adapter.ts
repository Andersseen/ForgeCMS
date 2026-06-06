import type { CollectionDefinition } from '@forge-cms/core';
import type { DatabaseAdapter, DatabaseRecord, FindManyOptions } from './index.js';
import {
  getOrCreateDrizzleTable,
  generateCreateTableSql,
  toDbValue,
  fromDbValue,
  clearTableCache
} from './schema-generator.js';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient, type Client } from '@libsql/client';
import { eq, and, sql } from 'drizzle-orm';

export interface LibSqlEnv {
  DATABASE_URL?: string;
}

export class LibSqlDatabaseAdapter implements DatabaseAdapter {
  readonly name = 'libsql';
  private client?: Client;
  private db?: ReturnType<typeof drizzle>;
  private collections = new Map<string, CollectionDefinition>();
  private url: string;

  constructor(url?: string) {
    this.url = url ?? 'file:./forge-cms.db';
  }

  init(env?: unknown): this {
    const envRecord = env as LibSqlEnv | undefined;
    const url = envRecord?.DATABASE_URL ?? this.url;
    this.client = createClient({ url });
    this.db = drizzle(this.client);
    return this;
  }

  private getDb(): ReturnType<typeof drizzle> {
    if (!this.db) throw new Error('LibSqlDatabaseAdapter not initialized. Call init() first.');
    return this.db;
  }

  private getCollectionDef(collection: string): CollectionDefinition | undefined {
    return this.collections.get(collection);
  }

  private getTable(collection: string) {
    const def = this.getCollectionDef(collection);
    if (!def) throw new Error(`Collection '${collection}' not registered. Call syncSchema first.`);
    return getOrCreateDrizzleTable(def);
  }

  async syncSchema(collections: CollectionDefinition[]): Promise<void> {
    const db = this.getDb();
    this.collections.clear();
    clearTableCache();

    for (const collection of collections) {
      this.collections.set(collection.slug, collection);
      const createSql = generateCreateTableSql(collection);
      await db.run(sql.raw(createSql));

      // Create indexes for fields marked with index: true
      for (const [fieldName, field] of Object.entries(collection.fields)) {
        if (field.options.index === true || field.options.unique === true) {
          const uniqueClause = field.options.unique === true ? 'UNIQUE' : '';
          const indexSql = `CREATE ${uniqueClause} INDEX IF NOT EXISTS "idx_${collection.slug}_${fieldName}" ON "${collection.slug}" ("${fieldName}")`;
          await db.run(sql.raw(indexSql));
        }
      }
    }
  }

  async findById(collection: string, id: string): Promise<DatabaseRecord | null> {
    const db = this.getDb();
    const table = this.getTable(collection);
    const result = await db
      .select()
      .from(table)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .where(eq((table as any)['id'], id))
      .limit(1);

    if (result.length === 0) return null;
    return this.hydrateRecord(result[0] as DatabaseRecord, collection);
  }

  async findMany(options: FindManyOptions): Promise<DatabaseRecord[]> {
    const db = this.getDb();
    const table = this.getTable(options.collection);
    let query = db.select().from(table);

    if (options.where && Object.keys(options.where).length > 0) {
      const conditions = Object.entries(options.where).map(([key, value]) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        eq((table as any)[key], value)
      );
      query = query.where(and(...conditions)) as typeof query;
    }

    if (options.limit !== undefined) {
      query = query.limit(options.limit) as typeof query;
    }

    if (options.offset !== undefined) {
      query = query.offset(options.offset) as typeof query;
    }

    const result = (await query) as DatabaseRecord[];
    return result.map((r) => this.hydrateRecord(r, options.collection));
  }

  async create(collection: string, data: DatabaseRecord): Promise<DatabaseRecord> {
    const db = this.getDb();
    const now = new Date().toISOString();
    const collectionDef = this.getCollectionDef(collection);
    const table = this.getTable(collection);

    const record: DatabaseRecord = {
      id: (data.id as string) || crypto.randomUUID(),
      created_at: now,
      updated_at: now
    };

    for (const [key, value] of Object.entries(data)) {
      if (key === 'id') continue;
      const field = collectionDef?.fields[key];
      record[key] = field ? toDbValue(value, field.kind) : value;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.insert(table).values(record as any);
    return this.findById(collection, record.id as string) as Promise<DatabaseRecord>;
  }

  async update(
    collection: string,
    id: string,
    data: Partial<DatabaseRecord>
  ): Promise<DatabaseRecord> {
    const db = this.getDb();
    const now = new Date().toISOString();
    const collectionDef = this.getCollectionDef(collection);
    const table = this.getTable(collection);

    const updates: DatabaseRecord = { updated_at: now };
    for (const [key, value] of Object.entries(data)) {
      if (key === 'id') continue;
      const field = collectionDef?.fields[key];
      updates[key] = field ? toDbValue(value, field.kind) : value;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.update(table).set(updates as any).where(eq((table as any)['id'], id));

    const updated = await this.findById(collection, id);
    if (!updated) throw new Error(`Record ${id} not found in ${collection}`);
    return updated;
  }

  async delete(collection: string, id: string): Promise<void> {
    const db = this.getDb();
    const table = this.getTable(collection);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.delete(table).where(eq((table as any)['id'], id));
  }

  private hydrateRecord(row: DatabaseRecord, collection: string): DatabaseRecord {
    const collectionDef = this.getCollectionDef(collection);
    if (!collectionDef) return row;

    const hydrated: DatabaseRecord = {};
    for (const [key, value] of Object.entries(row)) {
      const field = collectionDef.fields[key];
      hydrated[key] = field ? fromDbValue(value, field.kind) : value;
    }
    return hydrated;
  }
}
