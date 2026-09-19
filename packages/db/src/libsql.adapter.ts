import type { CollectionDefinition } from '@forge-cms/core';
import type {
  AtomicWriteOperation,
  AtomicWriteResult,
  ConditionalDeleteResult,
  ConditionalUpdateResult,
  DatabaseAdapter,
  DatabaseRecord,
  FindManyOptions,
  WriteCondition
} from './index.js';
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
import { assertValidWriteCondition } from './write-condition.js';
import {
  ATOMIC_WRITE_REQUIRE_APPLIED_SQL,
  assertValidAtomicWrite,
  atomicWriteMustApply,
  toAtomicWriteError
} from './atomic-write.js';
import { drizzle } from 'drizzle-orm/libsql';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { createClient, type Client, type InStatement, type InValue } from '@libsql/client';
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

/**
 * Drizzle types `values()`/`set()` per table schema; the tables here are built dynamically from
 * collection definitions, so the value maps are necessarily loose (as in every other write in this file).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleValues = any;

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

  private getClient(): Client {
    if (!this.client) throw new Error('LibSqlDatabaseAdapter not initialized. Call init() first.');
    return this.client;
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

  /** The row a `create`/atomic `create` inserts: id generated if absent, timestamps stamped, values DB-encoded. */
  private buildCreateRecord(collection: string, data: DatabaseRecord): DatabaseRecord {
    const now = new Date().toISOString();
    const collectionDef = this.getCollectionDef(collection);

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
    return record;
  }

  async create(collection: string, data: DatabaseRecord): Promise<DatabaseRecord> {
    const db = this.getDb();
    const table = this.getTable(collection);
    const record = this.buildCreateRecord(collection, data);

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
    const table = this.getTable(collection);
    const updates = this.buildUpdateValues(collection, data);

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

  /** Column values for an `update`/`updateIf` write: validated, DB-encoded, `updated_at` stamped, `id` never writable. */
  private buildUpdateValues(collection: string, data: Partial<DatabaseRecord>): DatabaseRecord {
    const collectionDef = this.getCollectionDef(collection);
    const updates: DatabaseRecord = { updated_at: new Date().toISOString() };
    for (const [key, value] of Object.entries(data)) {
      if (key === 'id') continue;
      assertValidColumn(key, collectionDef);
      const field = collectionDef?.fields[key];
      updates[key] = field ? toDbValue(value, field.kind) : value;
    }
    return updates;
  }

  /**
   * The whole of a conditional write's decision as ONE SQL predicate (spec 059) — the database
   * evaluates it in the same statement that writes, so nothing can interleave between check and write:
   *
   *   id = ? AND (<targetMatches>) AND
   *   (CASE WHEN (<P>) THEN 1 ELSE 0 END = 0            -- target not in the set: cannot shrink it
   *    OR (SELECT COUNT(*) FROM t WHERE id <> ? AND (<P>)) >= ?)   -- enough OTHER members remain
   *
   * The `CASE` (rather than `NOT (<P>)`) keeps a NULL-valued predicate meaning "not a member": under
   * SQL's three-valued logic `NOT NULL` is unknown and would wrongly refuse the write. Inside the
   * subquery unqualified/table-qualified columns bind to the inner scan of the same table; outside
   * it they bind to the row being written.
   */
  private buildWriteCondition(
    collection: string,
    id: string,
    condition: WriteCondition,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table: any
  ): SQL {
    const collectionDef = this.getCollectionDef(collection);
    const parts: SQL[] = [eq(table['id'], id)];

    const targetMatches = this.buildWhereCondition(table, collectionDef, condition.targetMatches);
    if (targetMatches !== undefined) parts.push(targetMatches);

    const floor = condition.keepAtLeast;
    if (floor) {
      // Built twice on purpose: each use needs its own copy of the bound parameters.
      const isMember = this.buildWhereCondition(table, collectionDef, floor.where) ?? sql`1`;
      const otherMember = this.buildWhereCondition(table, collectionDef, floor.where);
      const otherMembers = otherMember
        ? and(ne(table['id'], id), otherMember)!
        : ne(table['id'], id);
      parts.push(
        sql`(CASE WHEN ${isMember} THEN 1 ELSE 0 END = 0 OR (SELECT COUNT(*) FROM ${table} WHERE ${otherMembers}) >= ${floor.others})`
      );
    }
    return and(...parts)!;
  }

  /** One `UPDATE … WHERE <write condition> RETURNING *` statement; see {@link buildWriteCondition}. */
  async updateIf(
    collection: string,
    id: string,
    data: Partial<DatabaseRecord>,
    condition: WriteCondition
  ): Promise<ConditionalUpdateResult> {
    assertValidWriteCondition(condition);
    const db = this.getDb();
    const table = this.getTable(collection);
    const updates = this.buildUpdateValues(collection, data);
    const where = this.buildWriteCondition(collection, id, condition, table);

    let rows: unknown[];
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rows = await db
        .update(table)
        .set(updates as any)
        .where(where)
        .returning();
    } catch (err) {
      throw toUniqueConstraintError(err, collection) ?? err;
    }

    const row = rows[0];
    if (!row) return { applied: false };
    return { applied: true, record: this.hydrateRecord(row as DatabaseRecord, collection) };
  }

  /** One `DELETE … WHERE <write condition> RETURNING id` statement; see {@link buildWriteCondition}. */
  async deleteIf(
    collection: string,
    id: string,
    condition: WriteCondition
  ): Promise<ConditionalDeleteResult> {
    assertValidWriteCondition(condition);
    const db = this.getDb();
    const table = this.getTable(collection);
    const where = this.buildWriteCondition(collection, id, condition, table);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await db
      .delete(table)
      .where(where)
      .returning({ id: (table as any)['id'] });
    return { applied: rows.length > 0 };
  }

  /**
   * One `client.batch(statements, 'write')` — libSQL's real transactional batch (`BEGIN IMMEDIATE` … all
   * statements in order … `COMMIT`, `ROLLBACK` on any failure) — not a loop of `execute()`s. Deliberately
   * not drizzle's `db.batch()`, which in drizzle-orm 0.45.2 passes no mode and so runs `BEGIN DEFERRED`;
   * statements are built with drizzle's `.toSQL()` and handed to the client directly (spec 060).
   *
   * Every statement is built *before* anything is sent, so schema-dependent validation (unregistered
   * collection, unknown column) rejects with nothing written. Operations that must apply are followed by
   * {@link ATOMIC_WRITE_REQUIRE_APPLIED_SQL}, which aborts and rolls back the batch when the statement
   * before it changed no row. Encoding, `id` immutability, timestamps and condition semantics are the
   * single-call code itself (`buildCreateRecord`, `buildUpdateValues`, `buildWriteCondition`).
   */
  async atomicWrite(operations: readonly AtomicWriteOperation[]): Promise<AtomicWriteResult[]> {
    assertValidAtomicWrite(operations);
    if (operations.length === 0) return [];

    const db = this.getDb();
    const client = this.getClient();
    const statements: InStatement[] = [];
    const toResult: ((rows: DatabaseRecord[]) => AtomicWriteResult)[] = [];
    const resultIndex: number[] = [];

    const push = (query: { sql: string; params: unknown[] }) => {
      statements.push({ sql: query.sql, args: query.params as InValue[] });
    };

    for (const operation of operations) {
      const table = this.getTable(operation.collection);
      const { collection } = operation;
      resultIndex.push(statements.length);

      switch (operation.type) {
        case 'create': {
          const record = this.buildCreateRecord(collection, operation.data);
          push(
            db
              .insert(table)
              .values(record as DrizzleValues)
              .returning()
              .toSQL()
          );
          toResult.push(([row]) => {
            if (!row) throw new Error(`Batch insert into '${collection}' returned no row`);
            return { type: 'create', record: this.hydrateRecord(row, collection) };
          });
          break;
        }
        case 'update': {
          const updates = this.buildUpdateValues(collection, operation.data);
          const where = this.buildWriteCondition(collection, operation.id, {}, table);
          push(
            db
              .update(table)
              .set(updates as DrizzleValues)
              .where(where)
              .returning()
              .toSQL()
          );
          toResult.push(([row]) => {
            if (!row) throw new Error(`Batch update of '${collection}' returned no row`);
            return { type: 'update', record: this.hydrateRecord(row, collection) };
          });
          break;
        }
        case 'delete': {
          const where = this.buildWriteCondition(collection, operation.id, {}, table);
          push(db.delete(table).where(where).toSQL());
          toResult.push(() => ({ type: 'delete' }));
          break;
        }
        case 'updateIf': {
          const updates = this.buildUpdateValues(collection, operation.data);
          const where = this.buildWriteCondition(
            collection,
            operation.id,
            operation.condition,
            table
          );
          push(
            db
              .update(table)
              .set(updates as DrizzleValues)
              .where(where)
              .returning()
              .toSQL()
          );
          toResult.push(([row]) =>
            row
              ? { type: 'updateIf', applied: true, record: this.hydrateRecord(row, collection) }
              : { type: 'updateIf', applied: false }
          );
          break;
        }
        case 'deleteIf': {
          const where = this.buildWriteCondition(
            collection,
            operation.id,
            operation.condition,
            table
          );
          push(
            db
              .delete(table)
              .where(where)
              .returning({ id: (table as unknown as { id: SQLiteColumn }).id })
              .toSQL()
          );
          toResult.push((rows) => ({ type: 'deleteIf', applied: rows.length > 0 }));
          break;
        }
      }

      if (atomicWriteMustApply(operation))
        statements.push({ sql: ATOMIC_WRITE_REQUIRE_APPLIED_SQL });
    }

    let resultSets: Awaited<ReturnType<Client['batch']>>;
    try {
      resultSets = await client.batch(statements, 'write');
    } catch (err) {
      throw toAtomicWriteError(err);
    }

    // The batch is committed by now. A driver that hands back fewer result sets than statements would
    // otherwise read as "no rows" — i.e. a definite `applied: false` for a write that did apply — so a
    // missing result set fails loudly instead.
    if (resultSets.length !== statements.length) {
      throw new Error(
        `atomicWrite: libSQL returned ${resultSets.length} result sets for ${statements.length} statements; ` +
          'the batch may already have been committed but its results cannot be read reliably'
      );
    }

    return toResult.map((build, i) => {
      const at = resultIndex[i];
      const resultSet = at === undefined ? undefined : resultSets[at];
      if (!resultSet) throw new Error(`atomicWrite: no result for operation ${i}`);
      return build(resultSet.rows.map((row) => ({ ...row }) as DatabaseRecord));
    });
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
