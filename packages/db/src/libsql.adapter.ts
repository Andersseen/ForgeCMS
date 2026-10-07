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
  encodeFieldValue,
  decodeFieldValue,
  clearTableCache
} from './schema-generator.js';
import { toUniqueConstraintError } from './constraint-error.js';
import type { SchemaPlan } from './schema-plan.js';
import { planSqliteSchema, syncSqliteSchema } from './sqlite-schema.js';
import type { SqliteSchemaExecutor } from './sqlite-schema.js';
import type {
  MigrationDefinition,
  MigrationRecord,
  MigrationRunResult,
  RunMigrationsOptions
} from './migrations.js';
import { readSqliteMigrationHistory, runSqliteMigrations } from './sqlite-migrations.js';
import { assertValidWriteCondition } from './write-condition.js';
import {
  ATOMIC_WRITE_REQUIRE_APPLIED_SQL,
  assertValidAtomicWrite,
  atomicWriteMustApply,
  toAtomicWriteError
} from './atomic-write.js';
import type { drizzle } from 'drizzle-orm/libsql';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Client, InStatement, InValue } from '@libsql/client';
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

/**
 * `@libsql/client` and `drizzle-orm/libsql` are loaded on the first database operation, never when this
 * module is imported: `@forge-cms/db`'s entry also serves InMemory-only apps, and a static import would make
 * every bundler/tracer (Nitro, Vite, wrangler) resolve libSQL's platform-specific native binary for apps that
 * never open a libSQL database. Each runtime still gets the right client — the specifier resolves through
 * the app's own conditions (Node build on Node, fetch-based build on workerd/browsers).
 */
async function openConnection(
  url: string
): Promise<{ client: Client; db: ReturnType<typeof drizzle> }> {
  // Sequential on purpose: both modules load `@libsql/core`, and concurrent first imports of a shared
  // dependency can fail to link under Vitest's module runner.
  const { createClient } = await import('@libsql/client');
  const { drizzle: createDrizzle } = await import('drizzle-orm/libsql');
  const client = createClient({ url });
  return { client, db: createDrizzle(client) };
}

export class LibSqlDatabaseAdapter implements DatabaseAdapter {
  readonly name = 'libsql';
  /** Set by the first operation after `init()` (see {@link openConnection}). */
  private client: Client | undefined;
  private db: ReturnType<typeof drizzle> | undefined;
  private connection: Promise<void> | undefined;
  private initialized = false;
  private collections = new Map<string, CollectionDefinition>();
  private url: string;

  constructor(url?: string) {
    this.url = url ?? 'file:./forge-cms.db';
  }

  init(env?: unknown): this {
    const envRecord = env as LibSqlEnv | undefined;
    this.url = envRecord?.DATABASE_URL ?? this.url;
    this.client = undefined;
    this.db = undefined;
    this.connection = undefined;
    this.initialized = true;
    return this;
  }

  /** Opens the database once per `init()`; a failed attempt (bad URL, missing client) is not cached. */
  private async connect(): Promise<void> {
    if (!this.initialized) {
      throw new Error('LibSqlDatabaseAdapter not initialized. Call init() first.');
    }
    if (this.db && this.client) return;
    const pending = (this.connection ??= openConnection(this.url).then((opened) => {
      this.client = opened.client;
      this.db = opened.db;
    }));
    try {
      await pending;
    } catch (error) {
      if (this.connection === pending) this.connection = undefined;
      throw error;
    }
  }

  private async getDb(): Promise<ReturnType<typeof drizzle>> {
    await this.connect();
    if (!this.db) throw new Error('LibSqlDatabaseAdapter not initialized. Call init() first.');
    return this.db;
  }

  private async getClient(): Promise<Client> {
    await this.connect();
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
    // Upserts by slug rather than clearing first: an `AuthAdapter.syncSchema()` (e.g.
    // `ApiKeyAuthAdapter`) calls this again with just its own internal collection, often on the same
    // adapter instance as the main runtime — clearing here would unregister every consumer collection
    // the first call just registered, and every subsequent query for it would throw "not registered".
    clearTableCache();
    for (const collection of collections) this.collections.set(collection.slug, collection);
    // Plan first, then one transactional batch of safe DDL — or a SchemaDriftError with nothing run (spec 070).
    await syncSqliteSchema(await this.schemaExecutor(), collections);
  }

  async planSchema(collections: CollectionDefinition[]): Promise<SchemaPlan> {
    return planSqliteSchema(await this.schemaExecutor(), collections);
  }

  /** Reviewed migrations (spec 072): the shared SQLite engine over this adapter's executor. */
  async runMigrations(
    migrations: readonly MigrationDefinition[],
    options?: RunMigrationsOptions
  ): Promise<MigrationRunResult[]> {
    return runSqliteMigrations(await this.schemaExecutor(), migrations, options);
  }

  async readMigrationHistory(): Promise<MigrationRecord[]> {
    return readSqliteMigrationHistory(await this.schemaExecutor());
  }

  /** Schema reads through `execute`, schema writes through libSQL's transactional `batch(…, 'write')`. */
  private async schemaExecutor(): Promise<SqliteSchemaExecutor> {
    const client = await this.getClient();
    return {
      async query(sql, args = []) {
        const result = await client.execute({ sql, args: args as InValue[] });
        return result.rows.map((row) => ({ ...row }));
      },
      async batch(statements) {
        await client.batch(
          statements.map((s) => ({ sql: s.sql, args: (s.args ?? []) as InValue[] })),
          'write'
        );
      }
    };
  }

  async findById(collection: string, id: string): Promise<DatabaseRecord | null> {
    const db = await this.getDb();
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
    const db = await this.getDb();
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
      record[key] = field ? encodeFieldValue(value, field) : value;
    }
    return record;
  }

  async create(collection: string, data: DatabaseRecord): Promise<DatabaseRecord> {
    const db = await this.getDb();
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
    const db = await this.getDb();
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
    const db = await this.getDb();
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
      updates[key] = field ? encodeFieldValue(value, field) : value;
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
    const db = await this.getDb();
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
    const db = await this.getDb();
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

    const db = await this.getDb();
    const client = await this.getClient();
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
        case 'assertCount': {
          // `SELECT abs(CASE WHEN COUNT(*) = ? …) FROM t WHERE …` — one aggregate row that raises the
          // spec-060 overflow guard, rolling the batch back, when the count differs (spec 064).
          const where = this.buildWhereCondition(
            table,
            this.getCollectionDef(collection),
            operation.where
          );
          const guard = sql`abs(CASE WHEN COUNT(*) = ${operation.equals} THEN 0 ELSE -9223372036854775808 END)`;
          const query = db.select({ guard }).from(table);
          push((where !== undefined ? query.where(where) : query).toSQL());
          toResult.push(() => ({ type: 'assertCount' }));
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
    const db = await this.getDb();
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
      hydrated[key] = field ? decodeFieldValue(value, field) : value;
    }
    return hydrated;
  }
}
