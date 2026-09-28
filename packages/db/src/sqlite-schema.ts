import { defineField } from '@forge-cms/core';
import type { CollectionDefinition } from '@forge-cms/core';
import { resolveCollectionIndexes } from './schema-generator.js';
import {
  SCHEMA_BASELINE_TABLE,
  SchemaDriftError,
  parseTableBaseline,
  planTable,
  tableBaseline,
  toSchemaPlan,
  type SchemaChange,
  type SchemaPlan,
  type SchemaProbe,
  type StoredIndex,
  type StoredTable,
  type TableBaseline
} from './schema-plan.js';

// Spec 070: the SQLite side of drift planning, shared by `LibSqlDatabaseAdapter` and
// `D1DatabaseAdapter` so the two cannot disagree. Metadata comes from the table-valued PRAGMA
// functions with the table/index name as a bound parameter; probes are SQL aggregates over
// identifiers that `desiredTableSchema` has already validated.

/** The two primitives a SQLite-backed adapter provides for schema planning. */
export interface SqliteSchemaExecutor {
  /** Runs one read statement and returns its rows as plain objects. */
  query(sql: string, args?: unknown[]): Promise<Record<string, unknown>[]>;
  /** Runs every statement in one transaction: all commit or none do. */
  batch(statements: { sql: string; args?: unknown[] }[]): Promise<void>;
}

/** The internal table holding each synced table's semantic baseline (spec 070 §1). */
function baselineDefinition(): CollectionDefinition {
  return {
    slug: SCHEMA_BASELINE_TABLE,
    fields: { snapshot: defineField.json({ required: true }) }
  };
}

async function inspectTable(
  executor: SqliteSchemaExecutor,
  name: string
): Promise<StoredTable | null> {
  const columnRows = await executor.query(
    'SELECT "cid", "name", "type", "pk" FROM pragma_table_info(?) ORDER BY "cid"',
    [name]
  );
  if (columnRows.length === 0) return null;

  const indexRows = await executor.query(
    'SELECT "name", "unique", "origin", "partial" FROM pragma_index_list(?)',
    [name]
  );
  const indexes: StoredIndex[] = [];
  for (const row of indexRows) {
    const indexName = String(row.name);
    const keyRows = await executor.query(
      'SELECT "seqno", "name" FROM pragma_index_info(?) ORDER BY "seqno"',
      [indexName]
    );
    indexes.push({
      name: indexName,
      columns: keyRows.map((k) =>
        k.name === null || k.name === undefined ? null : String(k.name)
      ),
      unique: Number(row.unique) === 1,
      origin: String(row.origin),
      partial: Number(row.partial) === 1
    });
  }
  indexes.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return {
    name,
    columns: columnRows.map((row) => ({
      name: String(row.name),
      type: typeof row.type === 'string' ? row.type : '',
      primaryKey: Number(row.pk)
    })),
    indexes
  };
}

const q = (identifier: string) => `"${identifier}"`;

async function countOf(executor: SqliteSchemaExecutor, sql: string, args: unknown[] = []) {
  const [row] = await executor.query(sql, args);
  return Number(row?.n ?? 0);
}

function sqliteProbe(executor: SqliteSchemaExecutor): SchemaProbe {
  return {
    rowCount: (table) => countOf(executor, `SELECT COUNT(*) AS "n" FROM ${q(table)}`),
    nullCount: (table, column) =>
      countOf(executor, `SELECT COUNT(*) AS "n" FROM ${q(table)} WHERE ${q(column)} IS NULL`),
    valueCount: (table, column, value) =>
      countOf(executor, `SELECT COUNT(*) AS "n" FROM ${q(table)} WHERE ${q(column)} = ?`, [value]),
    async indexTable(name) {
      const [row] = await executor.query(
        `SELECT "tbl_name" FROM "sqlite_master" WHERE "type" = 'index' AND "name" = ?`,
        [name]
      );
      return row ? String(row.tbl_name) : null;
    },
    async duplicates(table, columns) {
      const notNull = columns.map((c) => `${q(c)} IS NOT NULL`).join(' AND ');
      const group = columns.map(q).join(', ');
      const [row] = await executor.query(
        `SELECT COUNT(*) AS "groups", COALESCE(SUM("n"), 0) AS "rows" FROM ` +
          `(SELECT COUNT(*) AS "n" FROM ${q(table)} WHERE ${notNull} GROUP BY ${group} HAVING COUNT(*) > 1)`
      );
      return { groups: Number(row?.groups ?? 0), rows: Number(row?.rows ?? 0) };
    }
  };
}

/** D1 caps bound parameters per statement at 100. */
const BASELINE_READ_CHUNK = 50;

async function readBaselines(
  executor: SqliteSchemaExecutor,
  tables: string[]
): Promise<Map<string, unknown>> {
  const found = new Map<string, unknown>();
  for (let i = 0; i < tables.length; i += BASELINE_READ_CHUNK) {
    const chunk = tables.slice(i, i + BASELINE_READ_CHUNK);
    const rows = await executor.query(
      `SELECT "id", "snapshot" FROM ${q(SCHEMA_BASELINE_TABLE)} WHERE "id" IN (${chunk.map(() => '?').join(', ')})`,
      chunk
    );
    for (const row of rows) found.set(String(row.id), row.snapshot);
  }
  return found;
}

interface SqlitePlan {
  plan: SchemaPlan;
  /** Safe DDL plus baseline upserts, in execution order. Empty = nothing to do. */
  statements: { sql: string; args?: unknown[] }[];
}

async function buildSqlitePlan(
  executor: SqliteSchemaExecutor,
  collections: readonly CollectionDefinition[]
): Promise<SqlitePlan> {
  const bySlug = new Map<string, CollectionDefinition>();
  for (const collection of collections) {
    if (collection.slug !== SCHEMA_BASELINE_TABLE) bySlug.set(collection.slug, collection);
  }
  if (bySlug.size === 0) return { plan: toSchemaPlan([]), statements: [] };

  const slugs = [...bySlug.keys()].sort();
  const baselineStored = await inspectTable(executor, SCHEMA_BASELINE_TABLE);
  const baselines = baselineStored
    ? await readBaselines(executor, slugs)
    : new Map<string, unknown>();
  const probe = sqliteProbe(executor);

  const changes: SchemaChange[] = [];
  const statements: { sql: string; args?: unknown[] }[] = [];

  // The baseline table first: every upsert below needs it.
  const own = await planTable(
    {
      collection: baselineDefinition(),
      stored: baselineStored,
      baseline: null,
      recordsBaseline: false
    },
    probe
  );
  changes.push(...own.changes);
  statements.push(...own.statements.map((sql) => ({ sql })));

  const now = new Date().toISOString();
  // Two tables of this same plan resolving to one index name (neither stored yet).
  const indexOwners = new Map<string, string[]>();
  for (const [slug, collection] of [...bySlug.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    for (const index of resolveCollectionIndexes(collection)) {
      indexOwners.set(index.name, [...(indexOwners.get(index.name) ?? []), slug]);
    }
  }
  for (const [name, owners] of indexOwners) {
    // A name already stored on some table is reported per table by `planTable` instead.
    if (owners.length < 2 || (await probe.indexTable(name)) !== null) continue;
    for (const table of owners.slice(1)) {
      changes.push({
        table,
        kind: 'index-added',
        target: { type: 'index', name },
        classification: 'unsupported',
        reason:
          `Tables ${owners.map((o) => `"${o}"`).join(' and ')} both declare an index named "${name}" ` +
          '(SQLite index names are database-wide), so only one could exist. Rename one of the ' +
          'collections or fields.'
      });
    }
  }

  for (const [slug, collection] of [...bySlug.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const stored = await inspectTable(executor, slug);
    const raw = baselines.get(slug);
    const baseline: TableBaseline | 'unknown' | null =
      raw === undefined ? null : parseTableBaseline(raw);
    const result = await planTable({ collection, stored, baseline, recordsBaseline: true }, probe);
    changes.push(...result.changes);
    statements.push(...result.statements.map((sql) => ({ sql })));

    const next = JSON.stringify(tableBaseline(collection));
    if (raw !== next) {
      statements.push({
        sql:
          `INSERT INTO ${q(SCHEMA_BASELINE_TABLE)} ("id", "created_at", "updated_at", "snapshot") ` +
          `VALUES (?, ?, ?, ?) ON CONFLICT ("id") DO UPDATE SET "snapshot" = excluded."snapshot", ` +
          `"updated_at" = excluded."updated_at"`,
        args: [slug, now, now, next]
      });
    }
  }

  return { plan: toSchemaPlan(changes), statements };
}

/**
 * Inspects the persisted schema of `collections` and plans every difference (spec 070). Read-only:
 * never executes DDL or writes a row.
 */
export async function planSqliteSchema(
  executor: SqliteSchemaExecutor,
  collections: readonly CollectionDefinition[]
): Promise<SchemaPlan> {
  return (await buildSqlitePlan(executor, collections)).plan;
}

/**
 * Plans, then either refuses or applies (spec 070 §5):
 *
 * - any `manual-migration`/`unsupported` change → throws {@link SchemaDriftError}; **no statement ran**;
 * - otherwise every safe-additive DDL statement and the updated baselines run as **one** transaction.
 *
 * If that transaction fails (typically another process applied the same change first; nothing of it
 * committed) the schema is planned once more and whatever safe work remains is applied in a second
 * transaction. A second failure rethrows; a now-blocking plan throws `SchemaDriftError` with the first
 * failure as its `cause`.
 */
export async function syncSqliteSchema(
  executor: SqliteSchemaExecutor,
  collections: readonly CollectionDefinition[]
): Promise<SchemaPlan> {
  let firstFailure: unknown;
  for (let attempt = 0; ; attempt++) {
    const { plan, statements } = await buildSqlitePlan(executor, collections);
    if (plan.blocking) {
      throw new SchemaDriftError(
        plan,
        undefined,
        attempt > 0 ? { cause: firstFailure } : undefined
      );
    }
    if (statements.length === 0) return plan;
    try {
      await executor.batch(statements);
      return plan;
    } catch (err) {
      if (attempt > 0) throw err;
      firstFailure = err;
    }
  }
}
