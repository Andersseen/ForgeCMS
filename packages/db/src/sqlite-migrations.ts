import { defineField } from '@forge-cms/core';
import type { CollectionDefinition } from '@forge-cms/core';
import { ATOMIC_WRITE_REQUIRE_APPLIED_SQL } from './atomic-write.js';
import {
  MigrationError,
  isMigrationError,
  planMigrationHistory,
  prepareMigrations,
  type MigrationDefinition,
  type MigrationRecord,
  type MigrationRunResult,
  type PreparedMigration,
  type RunMigrationsOptions
} from './migrations.js';
import { SCHEMA_BASELINE_TABLE, isSchemaDriftError } from './schema-plan.js';
import { syncSqliteSchema, type SqliteSchemaExecutor } from './sqlite-schema.js';

// Spec 072 (roadmap 0.7 M02): the one SQLite migration engine behind `LibSqlDatabaseAdapter` and
// `D1DatabaseAdapter`. Every migration is ONE transactional batch — prefix guard, ledger claim, baseline
// resets, the migration's statements, the `applied` transition — so its SQL and its ledger entry commit
// together or not at all, on a backend that has no interactive transactions (D1).

/** The applied-migrations ledger. Forge-owned; a migration's own SQL may not touch it. */
export const MIGRATION_LEDGER_TABLE = '_forge_migrations';

/**
 * The ledger as an ordinary Forge table, so the spec-070 planner creates and checks it — there is no
 * second schema path. `id` (the primary key) is the migration id.
 */
export function migrationLedgerDefinition(): CollectionDefinition {
  return {
    slug: MIGRATION_LEDGER_TABLE,
    fields: {
      position: defineField.number({ required: true, unique: true }),
      checksum: defineField.text({ required: true }),
      status: defineField.text({ required: true }),
      started_at: defineField.text({ required: true }),
      finished_at: defineField.text(),
      attempts: defineField.number({ required: true }),
      failure_code: defineField.text()
    }
  };
}

const L = `"${MIGRATION_LEDGER_TABLE}"`;
/** Raises "integer overflow" (spec 060's guard), aborting and rolling back the batch. */
const ABORT = '-9223372036854775808';

type Statement = { sql: string; args?: unknown[] };

function historyCorrupt(message: string): MigrationError {
  return new MigrationError({ code: 'MIGRATION_HISTORY_MISMATCH', phase: 'preflight', message });
}

function toRecord(row: Record<string, unknown>): MigrationRecord {
  const position = Number(row.position);
  const attempts = Number(row.attempts);
  const status = row.status;
  if (
    typeof row.id !== 'string' ||
    !Number.isInteger(position) ||
    position < 1 ||
    typeof row.checksum !== 'string' ||
    (status !== 'applied' && status !== 'failed') ||
    typeof row.started_at !== 'string' ||
    !Number.isInteger(attempts)
  ) {
    throw historyCorrupt(
      `The migration ledger holds a row Forge cannot read (id ${JSON.stringify(String(row.id))}, status ` +
        `${JSON.stringify(String(status))}). A "running" or unknown status is never committed by Forge; ` +
        'the ledger was edited by hand.'
    );
  }
  return {
    position,
    id: row.id,
    checksum: row.checksum,
    status,
    startedAt: row.started_at,
    finishedAt: typeof row.finished_at === 'string' ? row.finished_at : null,
    attempts,
    failureCode: typeof row.failure_code === 'string' ? row.failure_code : null
  };
}

/** The ledger in position order; `[]` when no migration has ever been run. Read-only. */
export async function readSqliteMigrationHistory(
  executor: SqliteSchemaExecutor
): Promise<MigrationRecord[]> {
  const exists = await executor.query('SELECT "name" FROM pragma_table_info(?)', [
    MIGRATION_LEDGER_TABLE
  ]);
  if (exists.length === 0) return [];
  const rows = await executor.query(
    `SELECT "id", "position", "checksum", "status", "started_at", "finished_at", "attempts", ` +
      `"failure_code" FROM ${L} ORDER BY "position"`
  );
  return rows.map(toRecord);
}

/**
 * Creates the ledger (and `_forge_schema`) through the spec-070 planner, touching nothing else — so it
 * works while application tables are blocked by drift, which is exactly when migrations are needed.
 */
async function ensureLedger(executor: SqliteSchemaExecutor): Promise<void> {
  try {
    await syncSqliteSchema(executor, [migrationLedgerDefinition()]);
  } catch (err) {
    if (isSchemaDriftError(err)) {
      throw new MigrationError(
        {
          code: 'MIGRATION_HISTORY_MISMATCH',
          phase: 'preflight',
          message:
            `The "${MIGRATION_LEDGER_TABLE}" ledger table itself does not have the schema this ForgeCMS ` +
            `version expects, so its history cannot be trusted:\n${err.message}`
        },
        { cause: err }
      );
    }
    throw err;
  }
}

/** A short, value-free label for the ledger: a driver code or error class, never a message. */
function failureCode(err: unknown): string {
  let current: unknown = err;
  for (let depth = 0; current instanceof Error && depth < 5; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(code)) return code;
    const prefixed = /\b(D1_[A-Z_]+|SQLITE_[A-Z_]+)\b/.exec(current.message);
    if (prefixed?.[1]) return prefixed[1];
    if (/integer overflow/i.test(current.message)) return 'FORGE_GUARD';
    current = current.cause;
  }
  if (err instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(err.name)) return err.name;
  return 'UNKNOWN';
}

type Mode =
  | { kind: 'fresh' }
  | { kind: 'retry'; failed: MigrationRecord }
  | { kind: 'replace'; failed: MigrationRecord };

/**
 * `attempts` never decreases at a position: a fresh row starts at 1, and every later write to the row
 * at that position (retry claim/fence, replace claim/fence) sets the previous value + 1. A retry or
 * replace batch matches the failed row by the `attempts` it read, so once anything else has written
 * that position, a late copy of the batch can never match again (no ABA).
 */
function nextAttempts(mode: Mode): number {
  return mode.kind === 'fresh' ? 1 : mode.failed.attempts + 1;
}

function insertRow(
  p: PreparedMigration,
  status: 'running' | 'failed',
  now: string,
  attempts: number,
  code: string | null = null
): Statement {
  return {
    sql:
      `INSERT INTO ${L} ("id", "created_at", "updated_at", "position", "checksum", "status", ` +
      `"started_at", "attempts", "failure_code") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [p.definition.id, now, now, p.position, p.checksum, status, now, attempts, code]
  };
}

/** Matches the recorded failed row exactly as it was read, so a stale reader's write changes nothing. */
const FAILED_ROW_MATCH = `"id" = ? AND "position" = ? AND "checksum" = ? AND "status" = 'failed' AND "attempts" = ?`;
const failedRowArgs = (r: MigrationRecord) => [r.id, r.position, r.checksum, r.attempts];

/** The batch that claims, runs and completes one migration (spec 072 §5). */
function migrationBatch(p: PreparedMigration, mode: Mode, now: string): Statement[] {
  const rowsBefore = mode.kind === 'fresh' ? p.position - 1 : p.position;
  const statements: Statement[] = [
    // 1. The ledger is exactly the prefix this runner planned against: p-1 applied rows below p, plus
    //    the recorded failed row at p when retrying/replacing.
    {
      sql:
        `SELECT abs(CASE WHEN (SELECT COUNT(*) FROM ${L} WHERE "position" < ? AND "status" = 'applied') = ? ` +
        `AND (SELECT COUNT(*) FROM ${L}) = ? THEN 0 ELSE ${ABORT} END)`,
      args: [p.position, p.position - 1, rowsBefore]
    }
  ];
  // 2. Claim. The primary key (id) and the unique position make a competing claim fail in the database.
  if (mode.kind === 'retry') {
    statements.push(
      {
        sql:
          `UPDATE ${L} SET "status" = 'running', "attempts" = "attempts" + 1, "started_at" = ?, ` +
          `"updated_at" = ?, "failure_code" = NULL WHERE ${FAILED_ROW_MATCH}`,
        args: [now, now, ...failedRowArgs(mode.failed)]
      },
      { sql: ATOMIC_WRITE_REQUIRE_APPLIED_SQL }
    );
  } else {
    if (mode.kind === 'replace') {
      statements.push(
        { sql: `DELETE FROM ${L} WHERE ${FAILED_ROW_MATCH}`, args: failedRowArgs(mode.failed) },
        { sql: ATOMIC_WRITE_REQUIRE_APPLIED_SQL }
      );
    }
    statements.push(insertRow(p, 'running', now, nextAttempts(mode)));
  }
  // 3. Baselines this migration makes obsolete; the post-flight sync records fresh ones.
  const reset = p.definition.resetBaseline ?? [];
  if (reset.length > 0) {
    statements.push({
      sql: `DELETE FROM "${SCHEMA_BASELINE_TABLE}" WHERE "id" IN (${reset.map(() => '?').join(', ')})`,
      args: [...reset]
    });
  }
  // 4. The reviewed SQL.
  for (const s of p.definition.statements) {
    statements.push({ sql: s.sql, ...(s.args !== undefined && { args: [...s.args] }) });
  }
  // 5. Complete: `running` never survives a commit.
  statements.push(
    {
      sql:
        `UPDATE ${L} SET "status" = 'applied', "finished_at" = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ` +
        `"updated_at" = ? WHERE "id" = ? AND "position" = ? AND "status" = 'running'`,
      args: [now, p.definition.id, p.position]
    },
    { sql: ATOMIC_WRITE_REQUIRE_APPLIED_SQL }
  );
  return statements;
}

/**
 * Records a failed attempt. It conflicts with every committed claim of this position/id, and every
 * late-arriving claim conflicts with it, so once it commits the attempt is proven rolled back for good.
 */
function fenceBatch(p: PreparedMigration, mode: Mode, now: string, code: string): Statement[] {
  if (mode.kind === 'retry') {
    return [
      {
        sql:
          `UPDATE ${L} SET "attempts" = "attempts" + 1, "failure_code" = ?, "updated_at" = ? ` +
          `WHERE ${FAILED_ROW_MATCH}`,
        args: [code, now, ...failedRowArgs(mode.failed)]
      },
      { sql: ATOMIC_WRITE_REQUIRE_APPLIED_SQL }
    ];
  }
  return [
    ...(mode.kind === 'replace'
      ? [
          { sql: `DELETE FROM ${L} WHERE ${FAILED_ROW_MATCH}`, args: failedRowArgs(mode.failed) },
          { sql: ATOMIC_WRITE_REQUIRE_APPLIED_SQL }
        ]
      : []),
    insertRow(p, 'failed', now, nextAttempts(mode), code)
  ];
}

async function executeOne(
  executor: SqliteSchemaExecutor,
  p: PreparedMigration,
  mode: Mode,
  results: readonly MigrationRunResult[]
): Promise<MigrationRunResult> {
  const id = p.definition.id;
  const base = { position: p.position, id, checksum: p.checksum };
  const now = new Date().toISOString();
  let batchError: unknown;
  try {
    await executor.batch(migrationBatch(p, mode, now));
    return { ...base, outcome: 'applied' };
  } catch (err) {
    batchError = err;
  }

  const code = failureCode(batchError);
  const failure = (
    detail: {
      code: MigrationError['code'];
      phase: MigrationError['phase'];
      status: NonNullable<MigrationError['status']>;
      message: string;
    },
    cause: unknown = batchError
  ) =>
    new MigrationError(
      { ...detail, migrationId: id, position: p.position, results: [...results] },
      { cause }
    );
  const knownFailed = (recorded: string) =>
    failure({
      code: 'MIGRATION_EXECUTION_FAILED',
      phase: 'execute',
      status: 'failed',
      message:
        `Migration "${id}" (position ${p.position}) failed (${code}) and was rolled back: none of its ` +
        `statements committed. ${recorded} Fix the cause, then run again with retryFailed: "${id}" ` +
        `(unchanged definition) or replaceFailed: "${id}" (corrected definition). It is never retried ` +
        'automatically.'
    });

  let fenced = false;
  try {
    await executor.batch(fenceBatch(p, mode, now, code));
    fenced = true;
  } catch {
    // Not fenced: another runner claimed the position first, or the database is unreachable.
  }
  if (fenced) throw knownFailed('The attempt is recorded as failed.');

  const unknown = (cause: unknown) =>
    failure(
      {
        code: 'MIGRATION_OUTCOME_UNKNOWN',
        phase: 'reconcile',
        status: 'unknown',
        message:
          `Migration "${id}" (position ${p.position}): the batch failed (${code}) and Forge could not ` +
          'prove whether it committed. Nothing is retried. Once the database is reachable, inspect ' +
          'readMigrationHistory() and run again: an applied migration is then reported and skipped, one ' +
          'that never committed runs normally, and a batch still in flight cannot commit twice (its ' +
          'ledger claim is unique).'
      },
      cause
    );

  let history: MigrationRecord[];
  try {
    history = await readSqliteMigrationHistory(executor);
  } catch (err) {
    if (isMigrationError(err)) throw err;
    throw unknown(err);
  }
  const row = history.find((r) => r.position === p.position);
  if (!row) throw unknown(batchError);
  if (row.id === id && row.checksum === p.checksum) {
    if (row.status === 'applied') return { ...base, outcome: 'reconciled' };
    // Still exactly the failed row this runner read: the fence did not land; the batch may be in flight.
    if (mode.kind !== 'fresh' && row.attempts === mode.failed.attempts) throw unknown(batchError);
    throw knownFailed('Its failure is recorded in the ledger.');
  }
  if (
    mode.kind === 'replace' &&
    row.id === mode.failed.id &&
    row.checksum === mode.failed.checksum &&
    row.status === 'failed'
  ) {
    // Still exactly the failed row this runner read: the fence did not land; the batch may be in flight.
    if (row.attempts === mode.failed.attempts) throw unknown(batchError);
    // Another runner wrote this position since: this attempt's guarded DELETE can never match again.
    throw knownFailed(
      'Another runner updated the recorded failure meanwhile, so this attempt can no longer commit.'
    );
  }
  throw failure({
    code: row.id === id ? 'MIGRATION_CHECKSUM_MISMATCH' : 'MIGRATION_HISTORY_MISMATCH',
    phase: 'reconcile',
    status: 'not-applied',
    message:
      `Position ${p.position} was taken by migration "${row.id}" (checksum ${row.checksum}, ${row.status}) ` +
      `while this runner tried "${id}" (checksum ${p.checksum}). Another runner with a different ` +
      `migration history won; nothing of "${id}" committed.`
  });
}

/**
 * Runs `migrations` (spec 072). Validates every definition and the whole ledger before executing
 * anything; then each pending migration commits as one batch together with its ledger entry. Never
 * retries a failed migration without `retryFailed`/`replaceFailed`, and never runs a destructive one
 * without `allowDestructive`. Throws {@link MigrationError}.
 */
export async function runSqliteMigrations(
  executor: SqliteSchemaExecutor,
  migrations: readonly MigrationDefinition[],
  options: RunMigrationsOptions = {}
): Promise<MigrationRunResult[]> {
  const prepared = await prepareMigrations(migrations);
  await ensureLedger(executor);
  const history = await readSqliteMigrationHistory(executor);
  const { states, failed } = planMigrationHistory(history, prepared, options);

  let failedMode: Mode | null = null;
  if (failed) {
    if (options.replaceFailed === failed.id) failedMode = { kind: 'replace', failed };
    else if (options.retryFailed === failed.id) failedMode = { kind: 'retry', failed };
    else {
      throw new MigrationError({
        code: 'MIGRATION_RETRY_REQUIRED',
        phase: 'preflight',
        migrationId: failed.id,
        position: failed.position,
        status: 'failed',
        message:
          `Migration "${failed.id}" (position ${failed.position}) is recorded as failed ` +
          `(${failed.failureCode ?? 'UNKNOWN'}, ${failed.attempts} attempt(s)); nothing of it committed. ` +
          `It is not retried automatically. Fix the cause, then pass retryFailed: "${failed.id}" to run ` +
          `the same definition again, or replaceFailed: "${failed.id}" to run a corrected one.`
      });
    }
  }

  const pending = prepared.filter((_, i) => states[i]?.state !== 'applied');
  const destructive = pending.filter((p) => p.definition.destructive);
  const firstDestructive = destructive[0];
  if (firstDestructive && options.allowDestructive !== true) {
    throw new MigrationError({
      code: 'MIGRATION_REVIEW_REQUIRED',
      phase: 'preflight',
      migrationId: firstDestructive.definition.id,
      position: firstDestructive.position,
      status: 'not-applied',
      message:
        `${destructive.length} pending migration(s) are destructive (${destructive
          .map((p) => `"${p.definition.id}"`)
          .join(
            ', '
          )}). Nothing was run. Take a backup under your deployment policy, review them, ` +
        'then run again with allowDestructive: true.'
    });
  }

  const results: MigrationRunResult[] = prepared
    .filter((_, i) => states[i]?.state === 'applied')
    .map((p) => ({
      position: p.position,
      id: p.definition.id,
      checksum: p.checksum,
      outcome: 'already-applied' as const
    }));
  for (const p of pending) {
    const mode: Mode =
      failed && failedMode && failed.position === p.position ? failedMode : { kind: 'fresh' };
    results.push(await executeOne(executor, p, mode, results));
  }
  return results;
}
