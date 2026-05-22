import type { CollectionDefinition, AnyField } from '@forge-cms/core';
import type { DatabaseAdapter, DatabaseRecord, FindManyOptions } from '@forge-cms/db';
import type { D1Database } from './bindings.js';

export interface D1Env {
  DB: D1Database;
}

function fieldKindToSqlType(field: AnyField): string {
  switch (field.kind) {
    case 'text':
    case 'relation':
    case 'date':
      return 'TEXT';
    case 'number':
      return 'REAL';
    case 'boolean':
      return 'INTEGER';
    default:
      return 'TEXT';
  }
}

function toDbValue(value: unknown, kind: AnyField['kind']): unknown {
  if (value === null || value === undefined) return null;
  switch (kind) {
    case 'boolean':
      return value ? 1 : 0;
    case 'relation':
      return Array.isArray(value) ? JSON.stringify(value) : value;
    case 'date':
      return value instanceof Date ? value.toISOString() : value;
    default:
      return value;
  }
}

function fromDbValue(value: unknown, kind: AnyField['kind']): unknown {
  if (value === null || value === undefined) return null;
  switch (kind) {
    case 'boolean':
      return value === 1 || value === true;
    case 'relation':
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      return value;
    case 'date':
      return typeof value === 'string' ? new Date(value) : value;
    default:
      return value;
  }
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

      const fieldColumns = Object.entries(collection.fields)
        .map(([name, field]) => `"${name}" ${fieldKindToSqlType(field)}`)
        .join(', ');

      const sql = `CREATE TABLE IF NOT EXISTS "${collection.slug}" (
        "id" TEXT PRIMARY KEY,
        "created_at" TEXT,
        "updated_at" TEXT${fieldColumns ? ', ' + fieldColumns : ''}
      )`;

      await db.exec(sql);
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

    if (options.where && Object.keys(options.where).length > 0) {
      const conditions = Object.keys(options.where)
        .map((key) => `"${key}" = ?`)
        .join(' AND ');
      sql += ` WHERE ${conditions}`;
      bindings.push(...Object.values(options.where));
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

    await db.prepare(sql).bind(...Object.values(record)).run();
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

    await db.prepare(sql).bind(...Object.values(updates), id).run();

    const updated = await this.findById(collection, id);
    if (!updated) throw new Error(`Record ${id} not found in ${collection}`);
    return updated;
  }

  async delete(collection: string, id: string): Promise<void> {
    const db = this.getDb();
    await db.prepare(`DELETE FROM "${collection}" WHERE id = ?`).bind(id).run();
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
