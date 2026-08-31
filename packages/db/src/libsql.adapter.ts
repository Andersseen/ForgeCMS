import type { CollectionDefinition } from '@forge-cms/core';
import type { DatabaseAdapter, DatabaseRecord, FindManyOptions } from './index.js';
import {
  getOrCreateDrizzleTable,
  generateCreateTableSql,
  generateAddColumnSql,
  generateIndexSql,
  toDbValue,
  fromDbValue,
  clearTableCache
} from './schema-generator.js';
import { toUniqueConstraintError } from './constraint-error.js';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient, type Client } from '@libsql/client';
import {
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  inArray,
  like,
  and,
  or,
  asc,
  desc,
  sql,
  count as drizzleCount,
  type SQL
} from 'drizzle-orm';
import { toOperatorValues, normalizeSort } from './where.js';
import type { DatabaseWhere } from './where.js';

const SYSTEM_COLUMNS = new Set(['id', 'created_at', 'updated_at', '_status', '_storageKey']);

function assertValidColumn(key: string, collectionDef: CollectionDefinition | undefined): void {
  if (SYSTEM_COLUMNS.has(key) || collectionDef?.fields[key]) return;
  throw new Error(`Unknown column '${key}'`);
}

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
    // Upserts by slug rather than clearing first: an `AuthAdapter.syncSchema()` (e.g.
    // `ApiKeyAuthAdapter`) calls this again with just its own internal collection, often on the same
    // adapter instance as the main runtime — clearing here would unregister every consumer collection
    // the first call just registered, and every subsequent query for it would throw "not registered".
    clearTableCache();

    for (const collection of collections) {
      this.collections.set(collection.slug, collection);
      const createSql = generateCreateTableSql(collection);
      await db.run(sql.raw(createSql));

      const existingColumns = await this.getExistingColumns(collection.slug);
      for (const alterSql of generateAddColumnSql(collection, existingColumns)) {
        await db.run(sql.raw(alterSql));
      }

      for (const indexSql of generateIndexSql(collection)) {
        await db.run(sql.raw(indexSql));
      }
    }
  }

  private async getExistingColumns(tableName: string): Promise<string[]> {
    if (!this.client) throw new Error('LibSqlDatabaseAdapter not initialized. Call init() first.');
    const result = await this.client.execute(`PRAGMA table_info("${tableName}")`);
    return result.rows.map((row) => row.name as string);
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

  /**
   * Translates a DatabaseWhere (flat or nested and/or) into a single drizzle condition, or undefined
   * when there is none. Every key at a level is AND-ed together, whatever it means — a flat column
   * condition, or (for `and`/`or`) a nested group — so `and`/`or` can sit alongside flat keys in the
   * same object without one silently winning (spec 050 hardening). An empty `or: []` compiles to a
   * constant-false condition (the empty-disjunction identity `matchesWhere` also uses), not "no
   * condition" — an access-rule constraint that legitimately narrows to zero matches (e.g.
   * `{ or: user.tenants.map(...) }` for a tenant-less user) must not silently become "no filter at
   * all" once it reaches SQL.
   */
  private buildWhereCondition(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table: any,
    collectionDef: CollectionDefinition | undefined,
    where: DatabaseWhere | undefined
  ): SQL | undefined {
    if (!where || Object.keys(where).length === 0) return undefined;

    const parts: SQL[] = [];

    for (const [key, value] of Object.entries(where)) {
      if (key === 'and' || key === 'or') {
        const children = (value as DatabaseWhere[])
          .map((child) => this.buildWhereCondition(table, collectionDef, child))
          .filter((c): c is SQL => c !== undefined);
        if (key === 'or') {
          parts.push(children.length > 0 ? or(...children)! : sql`0`);
        } else if (children.length > 0) {
          parts.push(and(...children)!);
        }
        continue;
      }

      assertValidColumn(key, collectionDef);
      const column = table[key];
      for (const { operator, value: opValue } of toOperatorValues(value)) {
        switch (operator) {
          case 'ne':
            parts.push(ne(column, opValue));
            break;
          case 'gt':
            parts.push(gt(column, opValue));
            break;
          case 'gte':
            parts.push(gte(column, opValue));
            break;
          case 'lt':
            parts.push(lt(column, opValue));
            break;
          case 'lte':
            parts.push(lte(column, opValue));
            break;
          case 'in':
            parts.push(inArray(column, opValue as unknown[]));
            break;
          case 'contains':
            parts.push(like(column, `%${opValue as string}%`));
            break;
          case 'containsValue':
            parts.push(sql`EXISTS (SELECT 1 FROM json_each(${column}) WHERE value = ${opValue})`);
            break;
          case 'eq':
          default:
            parts.push(eq(column, opValue));
            break;
        }
      }
    }

    return parts.length > 0 ? and(...parts) : undefined;
  }

  async findMany(options: FindManyOptions): Promise<DatabaseRecord[]> {
    const db = this.getDb();
    const collectionDef = this.getCollectionDef(options.collection);
    const table = this.getTable(options.collection);
    let query = db.select().from(table);

    const whereCondition = this.buildWhereCondition(table, collectionDef, options.where);
    if (whereCondition !== undefined) {
      query = query.where(whereCondition) as typeof query;
    }

    if (options.sort) {
      const sortFields = normalizeSort(options.sort, options.order);
      const orderBys = sortFields.map(({ field, order }) => {
        assertValidColumn(field, collectionDef);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sortColumn = (table as any)[field];
        return order === 'desc' ? desc(sortColumn) : asc(sortColumn);
      });
      if (orderBys.length > 0) {
        query = query.orderBy(...orderBys) as typeof query;
      }
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
      assertValidColumn(key, collectionDef);
      const field = collectionDef?.fields[key];
      record[key] = field ? toDbValue(value, field.kind) : value;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await db.insert(table).values(record as any);
    } catch (err) {
      throw toUniqueConstraintError(err, collection) ?? err;
    }
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
      assertValidColumn(key, collectionDef);
      const field = collectionDef?.fields[key];
      updates[key] = field ? toDbValue(value, field.kind) : value;
    }

    try {
      await db
        .update(table)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .set(updates as any)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .where(eq((table as any)['id'], id));
    } catch (err) {
      throw toUniqueConstraintError(err, collection) ?? err;
    }

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

  async count(collection: string, where?: DatabaseWhere): Promise<number> {
    const db = this.getDb();
    const collectionDef = this.getCollectionDef(collection);
    const table = this.getTable(collection);
    let query = db.select({ count: drizzleCount() }).from(table);

    const whereCondition = this.buildWhereCondition(table, collectionDef, where);
    if (whereCondition !== undefined) {
      query = query.where(whereCondition) as typeof query;
    }

    const result = (await query) as { count: number }[];
    return result[0]?.count ?? 0;
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
