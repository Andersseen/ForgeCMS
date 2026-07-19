import type { CollectionDefinition } from '@forge-cms/core';
import type { DatabaseAdapter, DatabaseRecord, FindManyOptions } from '@forge-cms/db';
import { generateCreateTableSql, toDbValue, fromDbValue } from '@forge-cms/db';
import type { D1Database } from './bindings.js';

export interface D1Env {
  DB: D1Database;
}

export class D1DatabaseAdapter implements DatabaseAdapter {
  readonly name = 'd1';
  private db?: D1Database;
  private collections = new Map<string, CollectionDefinition>();

  init(env: unknown): this {
    const d1Env = env as D1Env;
    if (!d1Env.DB) {
      throw new Error('D1DatabaseAdapter requires env.DB binding');
    }
    this.db = d1Env.DB;
    return this;
  }

  private getDb(): D1Database {
    if (!this.db) throw new Error('D1DatabaseAdapter not initialized. Call init() first.');
    return this.db;
  }

  private getCollectionDef(collection: string): CollectionDefinition | undefined {
    return this.collections.get(collection);
  }

  async syncSchema(collections: CollectionDefinition[]): Promise<void> {
    const db = this.getDb();
    this.collections.clear();

    for (const collection of collections) {
      this.collections.set(collection.slug, collection);

      const sql = generateCreateTableSql(collection);
      await db.exec(sql);

      // Create indexes for fields marked with index: true or unique: true
      for (const [fieldName, field] of Object.entries(collection.fields)) {
        if (field.options.index === true || field.options.unique === true) {
          const uniqueClause = field.options.unique === true ? 'UNIQUE' : '';
          const indexSql = `CREATE ${uniqueClause} INDEX IF NOT EXISTS "idx_${collection.slug}_${fieldName}" ON "${collection.slug}" ("${fieldName}")`;
          await db.exec(indexSql);
        }
      }
    }
  }

  async findById(collection: string, id: string): Promise<DatabaseRecord | null> {
    const db = this.getDb();
    const stmt = db.prepare(`SELECT * FROM "${collection}" WHERE id = ?`).bind(id);
    const result = await stmt.first<DatabaseRecord>();
    if (!result) return null;
    return this.hydrateRecord(result, collection);
  }

  async findMany(options: FindManyOptions): Promise<DatabaseRecord[]> {
    const db = this.getDb();
    let sql = `SELECT * FROM "${options.collection}"`;
    const bindings: unknown[] = [];

    const collectionDef = this.getCollectionDef(options.collection);

    if (options.where && Object.keys(options.where).length > 0) {
      const conditions = Object.keys(options.where)
        .map((key) => `"${key}" = ?`)
        .join(' AND ');
      sql += ` WHERE ${conditions}`;
      for (const [key, value] of Object.entries(options.where)) {
        const field = collectionDef?.fields[key];
        bindings.push(field ? toDbValue(value, field.kind) : value);
      }
    }

    if (options.limit !== undefined) {
      sql += ` LIMIT ?`;
      bindings.push(options.limit);
    }

    if (options.offset !== undefined) {
      sql += ` OFFSET ?`;
      bindings.push(options.offset);
    }

    const stmt = db.prepare(sql);
    const bound = bindings.length > 0 ? stmt.bind(...bindings) : stmt;
    const { results } = await bound.all<DatabaseRecord>();
    return results.map((r) => this.hydrateRecord(r, options.collection));
  }

  async create(collection: string, data: DatabaseRecord): Promise<DatabaseRecord> {
    const db = this.getDb();
    const now = new Date().toISOString();
    const collectionDef = this.getCollectionDef(collection);

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

    const keys = Object.keys(record);
    const placeholders = keys.map(() => '?').join(', ');
    const columns = keys.map((k) => `"${k}"`).join(', ');
    const sql = `INSERT INTO "${collection}" (${columns}) VALUES (${placeholders})`;

    await db
      .prepare(sql)
      .bind(...Object.values(record))
      .run();
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

    const updates: DatabaseRecord = { updated_at: now };
    for (const [key, value] of Object.entries(data)) {
      if (key === 'id') continue;
      const field = collectionDef?.fields[key];
      updates[key] = field ? toDbValue(value, field.kind) : value;
    }

    const keys = Object.keys(updates);
    const setClause = keys.map((k) => `"${k}" = ?`).join(', ');
    const sql = `UPDATE "${collection}" SET ${setClause} WHERE id = ?`;

    await db
      .prepare(sql)
      .bind(...Object.values(updates), id)
      .run();

    const updated = await this.findById(collection, id);
    if (!updated) throw new Error(`Record ${id} not found in ${collection}`);
    return updated;
  }

  async delete(collection: string, id: string): Promise<void> {
    const db = this.getDb();
    await db.prepare(`DELETE FROM "${collection}" WHERE id = ?`).bind(id).run();
  }

  async count(collection: string): Promise<number> {
    const db = this.getDb();
    const result = await db.prepare(`SELECT COUNT(*) as count FROM "${collection}"`).first<{
      count: number;
    }>();
    return result?.count ?? 0;
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
