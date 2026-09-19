import type { CollectionDefinition } from '@forge-cms/core';
import type {
  AtomicWriteOperation,
  AtomicWriteResult,
  ConditionalDeleteResult,
  ConditionalUpdateResult,
  DatabaseAdapter,
  DatabaseRecord,
  DatabaseWhere,
  FindManyOptions,
  WriteCondition
} from '@forge-cms/db';
import {
  ATOMIC_WRITE_REQUIRE_APPLIED_SQL,
  assertValidAtomicWrite,
  assertValidWriteCondition,
  atomicWriteMustApply,
  toAtomicWriteError,
  generateCreateTableSql,
  generateAddColumnSql,
  generateIndexSql,
  toDbValue,
  fromDbValue,
  toOperatorValues,
  toUniqueConstraintError,
  normalizeSort
} from '@forge-cms/db';
import type { D1Database, D1PreparedStatement } from './bindings.js';

export interface D1Env {
  DB: D1Database;
}

export interface D1AdapterOptions {
  /**
   * Which binding on `env` holds the database. Defaults to `'DB'`.
   *
   * Without this the binding name was fixed by the adapter, so a Worker with two databases — or one
   * whose binding is called anything else — could not use it at all.
   */
  binding?: string;
}

const SYSTEM_COLUMNS = ['id', 'created_at', 'updated_at', '_status', '_storageKey'];

function assertValidColumn(key: string, collectionDef: CollectionDefinition | undefined): void {
  if (SYSTEM_COLUMNS.includes(key) || collectionDef?.fields[key]) return;
  throw new Error(`Unknown column '${key}'`);
}

export class D1DatabaseAdapter implements DatabaseAdapter {
  readonly name = 'd1';
  private db?: D1Database;
  private readonly binding: string;
  private collections = new Map<string, CollectionDefinition>();

  constructor(options: D1AdapterOptions = {}) {
    this.binding = options.binding ?? 'DB';
  }

  init(env: unknown): this {
    const bindings = (env ?? {}) as Record<string, D1Database | undefined>;
    const db = bindings[this.binding];
    if (!db) {
      throw new Error(`D1DatabaseAdapter requires env.${this.binding} binding`);
    }
    this.db = db;
    return this;
  }

  private getDb(): D1Database {
    if (!this.db) throw new Error('D1DatabaseAdapter not initialized. Call init() first.');
    return this.db;
  }

  private getCollectionDef(collection: string): CollectionDefinition {
    const def = this.collections.get(collection);
    if (!def) throw new Error(`Collection '${collection}' not registered. Call syncSchema first.`);
    return def;
  }

  async syncSchema(collections: CollectionDefinition[]): Promise<void> {
    const db = this.getDb();
    // Upserts by slug rather than clearing first: an `AuthAdapter.syncSchema()` (e.g.
    // `ApiKeyAuthAdapter`) calls this again with just its own internal collection, often on the same
    // adapter instance as the main runtime — clearing here would unregister every consumer collection
    // the first call just registered, and every subsequent query for it would throw "not registered".
    for (const collection of collections) {
      this.collections.set(collection.slug, collection);

      const sql = generateCreateTableSql(collection);
      await db.exec(sql);

      const existingColumns = await this.getExistingColumns(collection.slug);
      for (const alterSql of generateAddColumnSql(collection, existingColumns)) {
        await db.exec(alterSql);
      }

      for (const indexSql of generateIndexSql(collection)) {
        await db.exec(indexSql);
      }
    }
  }

  private async getExistingColumns(tableName: string): Promise<string[]> {
    const db = this.getDb();
    const { results } = await db
      .prepare(`PRAGMA table_info("${tableName}")`)
      .all<{ name: string }>();
    return results.map((r) => r.name);
  }

  async findById(collection: string, id: string): Promise<DatabaseRecord | null> {
    const db = this.getDb();
    this.getCollectionDef(collection);
    const stmt = db.prepare(`SELECT * FROM "${collection}" WHERE id = ?`).bind(id);
    const result = await stmt.first<DatabaseRecord>();
    if (!result) return null;
    return this.hydrateRecord(result, collection);
  }

  /**
   * Builds a parameterized `WHERE` clause (empty string when there is nothing to filter on). Column
   * names are validated against the collection's known fields before interpolation; values always go
   * through bindings, never string concatenation. Nested `and`/`or` groups compile to parenthesized SQL
   * (spec 050), e.g. `("status" = ?) AND (("category" = ?) OR ("featured" = ?))`.
   */
  private buildWhereClause(
    collection: string,
    where: DatabaseWhere | undefined
  ): { clause: string; bindings: unknown[] } {
    const collectionDef = this.getCollectionDef(collection);
    const expr = this.buildWhereExpression(collectionDef, where);
    return { clause: expr ? ` WHERE ${expr.sql}` : '', bindings: expr?.bindings ?? [] };
  }

  /**
   * Every key at a level is AND-ed together, whatever it means — a flat column condition, or (for
   * `and`/`or`) a nested group — so `and`/`or` can sit alongside flat keys in the same object without
   * one silently winning (spec 050 hardening). A group's own joined SQL is always wrapped in one more
   * paren layer here (even when it is the only part) so it composes safely with AND-precedence when
   * combined with sibling parts — SQL's `AND` binds tighter than `OR`, so an unwrapped
   * `"a" = ? AND "b" = ? OR "c" = ?` would parse as `("a"=? AND "b"=?) OR "c"=?`, not the intended
   * `"a"=? AND ("b"=? OR "c"=?)`. An empty `or: []` compiles to the constant `0` (always false — the
   * empty-disjunction identity `matchesWhere` also uses), not "no condition": an access-rule
   * constraint that legitimately narrows to zero matches must not silently become "no filter at all"
   * once it reaches SQL.
   */
  private buildWhereExpression(
    collectionDef: CollectionDefinition,
    where: DatabaseWhere | undefined
  ): { sql: string; bindings: unknown[] } | undefined {
    if (!where || Object.keys(where).length === 0) return undefined;

    const parts: { sql: string; bindings: unknown[] }[] = [];

    for (const [key, value] of Object.entries(where)) {
      if (key === 'and' || key === 'or') {
        const children = (value as DatabaseWhere[])
          .map((child) => this.buildWhereExpression(collectionDef, child))
          .filter((c): c is { sql: string; bindings: unknown[] } => c !== undefined);
        if (key === 'or') {
          parts.push(
            children.length > 0
              ? {
                  sql: `(${children.map((c) => `(${c.sql})`).join(' OR ')})`,
                  bindings: children.flatMap((c) => c.bindings)
                }
              : { sql: '0', bindings: [] }
          );
        } else if (children.length > 0) {
          parts.push({
            sql: `(${children.map((c) => `(${c.sql})`).join(' AND ')})`,
            bindings: children.flatMap((c) => c.bindings)
          });
        }
        continue;
      }

      assertValidColumn(key, collectionDef);
      const field = collectionDef?.fields[key];
      const coerce = (v: unknown) => (field ? toDbValue(v, field.kind) : v);
      const bindings: unknown[] = [];

      const conditions = toOperatorValues(value).map(({ operator, value: opValue }) => {
        switch (operator) {
          case 'ne':
            bindings.push(coerce(opValue));
            return `"${key}" != ?`;
          case 'gt':
            bindings.push(coerce(opValue));
            return `"${key}" > ?`;
          case 'gte':
            bindings.push(coerce(opValue));
            return `"${key}" >= ?`;
          case 'lt':
            bindings.push(coerce(opValue));
            return `"${key}" < ?`;
          case 'lte':
            bindings.push(coerce(opValue));
            return `"${key}" <= ?`;
          case 'in': {
            const values = (opValue as unknown[]).map(coerce);
            bindings.push(...values);
            return `"${key}" IN (${values.map(() => '?').join(', ')})`;
          }
          case 'contains':
            bindings.push(`%${opValue as string}%`);
            return `"${key}" LIKE ?`;
          case 'containsValue':
            bindings.push(opValue);
            return `EXISTS (SELECT 1 FROM json_each("${key}") WHERE value = ?)`;
          case 'eq':
          default:
            bindings.push(coerce(opValue));
            return `"${key}" = ?`;
        }
      });

      parts.push({ sql: conditions.join(' AND '), bindings });
    }

    if (parts.length === 0) return undefined;
    return {
      sql: parts.map((p) => p.sql).join(' AND '),
      bindings: parts.flatMap((p) => p.bindings)
    };
  }

  async findMany(options: FindManyOptions): Promise<DatabaseRecord[]> {
    const db = this.getDb();
    const collectionDef = this.getCollectionDef(options.collection);

    const { clause, bindings } = this.buildWhereClause(options.collection, options.where);
    let sql = `SELECT * FROM "${options.collection}"${clause}`;

    if (options.sort) {
      const sortFields = normalizeSort(options.sort, options.order);
      if (sortFields.length > 0) {
        const orderBy = sortFields
          .map(({ field, order }) => {
            assertValidColumn(field, collectionDef);
            return `"${field}" ${order === 'desc' ? 'DESC' : 'ASC'}`;
          })
          .join(', ');
        sql += ` ORDER BY ${orderBy}`;
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

  private buildInsert(
    collection: string,
    record: DatabaseRecord,
    returning: boolean
  ): { sql: string; bindings: unknown[] } {
    const keys = Object.keys(record);
    const placeholders = keys.map(() => '?').join(', ');
    const columns = keys.map((k) => `"${k}"`).join(', ');
    return {
      sql: `INSERT INTO "${collection}" (${columns}) VALUES (${placeholders})${returning ? ' RETURNING *' : ''}`,
      bindings: Object.values(record)
    };
  }

  async create(collection: string, data: DatabaseRecord): Promise<DatabaseRecord> {
    const db = this.getDb();
    const record = this.buildCreateRecord(collection, data);
    const { sql, bindings } = this.buildInsert(collection, record, false);

    try {
      await db
        .prepare(sql)
        .bind(...bindings)
        .run();
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
    const updates = this.buildUpdateValues(collection, data);

    const keys = Object.keys(updates);
    const setClause = keys.map((k) => `"${k}" = ?`).join(', ');
    const sql = `UPDATE "${collection}" SET ${setClause} WHERE id = ?`;

    try {
      await db
        .prepare(sql)
        .bind(...Object.values(updates), id)
        .run();
    } catch (err) {
      throw toUniqueConstraintError(err, collection) ?? err;
    }

    const updated = await this.findById(collection, id);
    if (!updated) throw new Error(`Record ${id} not found in ${collection}`);
    return updated;
  }

  async delete(collection: string, id: string): Promise<void> {
    const db = this.getDb();
    this.getCollectionDef(collection);
    await db.prepare(`DELETE FROM "${collection}" WHERE id = ?`).bind(id).run();
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
   * The whole of a conditional write's decision as ONE SQL predicate (spec 059), evaluated by D1 in the
   * same statement that writes — D1 runs a database's queries one at a time, so independent Worker
   * isolates are serialized and nothing can interleave between check and write:
   *
   *   "id" = ? AND (<targetMatches>) AND
   *   (CASE WHEN (<P>) THEN 1 ELSE 0 END = 0                        -- target not in the set: cannot shrink it
   *    OR (SELECT COUNT(*) FROM "t" WHERE "id" != ? AND (<P>)) >= ?) -- enough OTHER members remain
   *
   * The `CASE` (rather than `NOT (<P>)`) keeps a NULL-valued predicate meaning "not a member" — under
   * SQL's three-valued logic `NOT NULL` is unknown and would wrongly refuse the write. Unqualified
   * columns inside the subquery bind to its own scan of the table; outside it, to the row being written.
   * Bindings are listed in the exact order their `?` placeholders appear.
   */
  private buildWriteCondition(
    collection: string,
    id: string,
    condition: WriteCondition
  ): { sql: string; bindings: unknown[] } {
    const collectionDef = this.getCollectionDef(collection);
    const parts = ['"id" = ?'];
    const bindings: unknown[] = [id];

    const targetMatches = this.buildWhereExpression(collectionDef, condition.targetMatches);
    if (targetMatches) {
      parts.push(`(${targetMatches.sql})`);
      bindings.push(...targetMatches.bindings);
    }

    const floor = condition.keepAtLeast;
    if (floor) {
      const member = this.buildWhereExpression(collectionDef, floor.where);
      const memberBindings = member?.bindings ?? [];
      parts.push(
        `(CASE WHEN ${member ? `(${member.sql})` : '1'} THEN 1 ELSE 0 END = 0 OR ` +
          `(SELECT COUNT(*) FROM "${collection}" WHERE "id" != ?${member ? ` AND (${member.sql})` : ''}) >= ?)`
      );
      bindings.push(...memberBindings, id, ...memberBindings, floor.others);
    }
    return { sql: parts.join(' AND '), bindings };
  }

  /**
   * One `UPDATE … WHERE <write condition> RETURNING *` statement, run with `.all()` so `RETURNING`
   * yields both the decision (a row came back) and the row as written. Deliberately not `batch()`: a
   * single statement is the whole unit, and no Worker instance is trusted to be the only writer.
   */
  async updateIf(
    collection: string,
    id: string,
    data: Partial<DatabaseRecord>,
    condition: WriteCondition
  ): Promise<ConditionalUpdateResult> {
    assertValidWriteCondition(condition);
    const db = this.getDb();
    const updates = this.buildUpdateValues(collection, data);
    const setClause = Object.keys(updates)
      .map((k) => `"${k}" = ?`)
      .join(', ');
    const where = this.buildWriteCondition(collection, id, condition);
    const sql = `UPDATE "${collection}" SET ${setClause} WHERE ${where.sql} RETURNING *`;

    let results: DatabaseRecord[];
    try {
      ({ results } = await db
        .prepare(sql)
        .bind(...Object.values(updates), ...where.bindings)
        .all<DatabaseRecord>());
    } catch (err) {
      throw toUniqueConstraintError(err, collection) ?? err;
    }

    const row = results[0];
    if (!row) return { applied: false };
    return { applied: true, record: this.hydrateRecord(row, collection) };
  }

  /** One `DELETE … WHERE <write condition> RETURNING "id"` statement; see {@link updateIf}. */
  async deleteIf(
    collection: string,
    id: string,
    condition: WriteCondition
  ): Promise<ConditionalDeleteResult> {
    assertValidWriteCondition(condition);
    const db = this.getDb();
    const where = this.buildWriteCondition(collection, id, condition);
    const sql = `DELETE FROM "${collection}" WHERE ${where.sql} RETURNING "id"`;
    const { results } = await db
      .prepare(sql)
      .bind(...where.bindings)
      .all<{ id: string }>();
    return { applied: results.length > 0 };
  }

  /**
   * One `db.batch(statements)` — D1's transactional batch ("batched statements are SQL transactions ...
   * each statement will execute and commit, sequentially, non-concurrently"; a failing statement "aborts
   * or rolls back the entire sequence"; results are in statement order) — not a loop of `run()`s, and
   * not an interactive transaction, which D1 does not have (spec 060).
   *
   * Every statement is built and bound *before* anything is sent, so schema-dependent validation
   * (unregistered collection, unknown column) rejects with nothing written. Operations that must apply are
   * followed by {@link ATOMIC_WRITE_REQUIRE_APPLIED_SQL}, which aborts and rolls back the batch when the
   * statement before it changed no row. D1's batch error carries no statement index, so
   * {@link toAtomicWriteError} classifies by message alone. Encoding, `id` immutability, timestamps and
   * condition semantics are the single-call code (`buildCreateRecord`, `buildUpdateValues`,
   * `buildWriteCondition`).
   */
  async atomicWrite(operations: readonly AtomicWriteOperation[]): Promise<AtomicWriteResult[]> {
    assertValidAtomicWrite(operations);
    if (operations.length === 0) return [];

    const db = this.getDb();
    const statements: D1PreparedStatement[] = [];
    const toResult: ((rows: DatabaseRecord[]) => AtomicWriteResult)[] = [];
    const resultIndex: number[] = [];

    const push = (sql: string, bindings: unknown[]) => {
      statements.push(db.prepare(sql).bind(...bindings));
    };

    for (const operation of operations) {
      const { collection } = operation;
      this.getCollectionDef(collection);
      resultIndex.push(statements.length);

      switch (operation.type) {
        case 'create': {
          const insert = this.buildInsert(
            collection,
            this.buildCreateRecord(collection, operation.data),
            true
          );
          push(insert.sql, insert.bindings);
          toResult.push(([row]) => {
            if (!row) throw new Error(`Batch insert into '${collection}' returned no row`);
            return { type: 'create', record: this.hydrateRecord(row, collection) };
          });
          break;
        }
        case 'update': {
          const updates = this.buildUpdateValues(collection, operation.data);
          const where = this.buildWriteCondition(collection, operation.id, {});
          const setClause = Object.keys(updates)
            .map((k) => `"${k}" = ?`)
            .join(', ');
          push(`UPDATE "${collection}" SET ${setClause} WHERE ${where.sql} RETURNING *`, [
            ...Object.values(updates),
            ...where.bindings
          ]);
          toResult.push(([row]) => {
            if (!row) throw new Error(`Batch update of '${collection}' returned no row`);
            return { type: 'update', record: this.hydrateRecord(row, collection) };
          });
          break;
        }
        case 'delete': {
          const where = this.buildWriteCondition(collection, operation.id, {});
          push(`DELETE FROM "${collection}" WHERE ${where.sql}`, where.bindings);
          toResult.push(() => ({ type: 'delete' }));
          break;
        }
        case 'updateIf': {
          const updates = this.buildUpdateValues(collection, operation.data);
          const where = this.buildWriteCondition(collection, operation.id, operation.condition);
          const setClause = Object.keys(updates)
            .map((k) => `"${k}" = ?`)
            .join(', ');
          push(`UPDATE "${collection}" SET ${setClause} WHERE ${where.sql} RETURNING *`, [
            ...Object.values(updates),
            ...where.bindings
          ]);
          toResult.push(([row]) =>
            row
              ? { type: 'updateIf', applied: true, record: this.hydrateRecord(row, collection) }
              : { type: 'updateIf', applied: false }
          );
          break;
        }
        case 'deleteIf': {
          const where = this.buildWriteCondition(collection, operation.id, operation.condition);
          push(`DELETE FROM "${collection}" WHERE ${where.sql} RETURNING "id"`, where.bindings);
          toResult.push((rows) => ({ type: 'deleteIf', applied: rows.length > 0 }));
          break;
        }
      }

      if (atomicWriteMustApply(operation))
        statements.push(db.prepare(ATOMIC_WRITE_REQUIRE_APPLIED_SQL));
    }

    let batchResults: Awaited<ReturnType<D1Database['batch']>>;
    try {
      batchResults = await db.batch<DatabaseRecord>(statements);
    } catch (err) {
      throw toAtomicWriteError(err);
    }

    // The batch is committed by now. A binding that hands back fewer results than statements (or reports
    // `success: false`) would otherwise read as "no rows" — a definite `applied: false` for a write that
    // did apply — so it fails loudly instead.
    if (
      batchResults.length !== statements.length ||
      batchResults.some((r) => r.success === false)
    ) {
      throw new Error(
        `atomicWrite: D1 returned ${batchResults.length} results for ${statements.length} statements ` +
          '(or reported a failed statement); the batch may already have been committed but its results ' +
          'cannot be read reliably'
      );
    }

    return toResult.map((build, i) => {
      const at = resultIndex[i];
      const result = at === undefined ? undefined : batchResults[at];
      if (!result) throw new Error(`atomicWrite: no result for operation ${i}`);
      return build((result.results ?? []) as DatabaseRecord[]);
    });
  }

  async count(collection: string, where?: DatabaseWhere): Promise<number> {
    const db = this.getDb();
    this.getCollectionDef(collection);
    const { clause, bindings } = this.buildWhereClause(collection, where);
    const sql = `SELECT COUNT(*) as count FROM "${collection}"${clause}`;
    const stmt = db.prepare(sql);
    const bound = bindings.length > 0 ? stmt.bind(...bindings) : stmt;
    const result = await bound.first<{ count: number }>();
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
