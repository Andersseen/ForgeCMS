import type { SchemaPlan } from './schema-plan.js';

// Spec 072 (roadmap 0.7 M02): reviewed migrations as deterministic data. This file is the pure half —
// definitions, validation, checksums and the append-only history rules. `sqlite-migrations.ts` executes
// them on libSQL and D1.

/** A value bound to a `?` placeholder. The set every supported driver binds identically. */
export type MigrationValue = string | number | boolean | null;

export interface MigrationStatement {
  /** Exactly one SQL statement. Positional `?` placeholders only. */
  readonly sql: string;
  readonly args?: readonly MigrationValue[];
}

/**
 * One reviewed migration: trusted deployment code, never built from request data. Pure data — there is
 * no callback — so that libSQL and D1 can both run it as one transactional batch.
 */
export interface MigrationDefinition {
  /** Stable identity, e.g. `'20260929_001_posts_headline_to_title'`. */
  readonly id: string;
  /** For humans and reports. Not part of the checksum. */
  readonly description: string;
  /** Explicit. `true` requires `allowDestructive` when running. */
  readonly destructive: boolean;
  /**
   * Executed in order, in one transaction together with the ledger claim. May be empty only when
   * `resetBaseline` is set: a baseline-only migration records that data was already converted.
   */
  readonly statements: readonly MigrationStatement[];
  /**
   * Tables whose schema baseline (`_forge_schema`, spec 070) this migration makes obsolete — e.g. it
   * wrapped every `title` into `{"en": …}`. Their baseline rows are deleted in the same transaction and
   * the post-flight `syncSchema()` records fresh ones.
   */
  readonly resetBaseline?: readonly string[];
}

/** One row of the `_forge_migrations` ledger. */
export interface MigrationRecord {
  /** 1 + the migration's index in the migrations array. */
  position: number;
  id: string;
  checksum: string;
  status: 'applied' | 'failed';
  /** Runner clock when the latest attempt started (ISO 8601). */
  startedAt: string;
  /** Database clock at commit; `null` for a failed migration. */
  finishedAt: string | null;
  attempts: number;
  /** Error class/code of the latest failure, e.g. `SQLITE_CONSTRAINT`. Never a message or a value. */
  failureCode: string | null;
}

export interface RunMigrationsOptions {
  /** Permit migrations declared `destructive: true`. Default `false`. */
  allowDestructive?: boolean;
  /** Approve re-running the recorded failed migration with this id — same position and checksum only. */
  retryFailed?: string;
  /**
   * Approve replacing the recorded failed migration with this id by whatever definition now sits at its
   * position (e.g. a corrected version). Safe because a recorded failure is proven never to have committed.
   */
  replaceFailed?: string;
}

export interface MigrationRunResult {
  position: number;
  id: string;
  checksum: string;
  /**
   * - `applied`: this invocation committed it.
   * - `already-applied`: the ledger already had it; nothing ran.
   * - `reconciled`: this invocation's attempt failed or its response was lost, and the ledger then proved
   *   the same migration applied (by this invocation or by a concurrent runner).
   */
  outcome: 'applied' | 'already-applied' | 'reconciled';
}

/** Read-only preflight view of one definition against the ledger. */
export interface MigrationState {
  position: number;
  id: string;
  checksum: string;
  destructive: boolean;
  state: 'applied' | 'failed' | 'pending';
}

export type MigrationErrorCode =
  | 'MIGRATION_INVALID'
  | 'MIGRATION_UNSUPPORTED'
  | 'MIGRATION_HISTORY_MISMATCH'
  | 'MIGRATION_CHECKSUM_MISMATCH'
  | 'MIGRATION_RETRY_REQUIRED'
  | 'MIGRATION_REVIEW_REQUIRED'
  | 'MIGRATION_EXECUTION_FAILED'
  | 'MIGRATION_OUTCOME_UNKNOWN'
  | 'MIGRATION_POSTFLIGHT_FAILED';

export type MigrationPhase = 'validate' | 'preflight' | 'execute' | 'reconcile' | 'postflight';

/**
 * What is known about the named migration's effect on the database:
 * `not-applied` (nothing of it committed), `failed` (an attempt is recorded and proven rolled back),
 * `applied` (committed), `unknown` (it may or may not have committed — do not retry blindly).
 */
export type MigrationSafeStatus = 'not-applied' | 'failed' | 'applied' | 'unknown';

/**
 * Every failure of the migration protocol. `code` says what happened, `phase` where, `status` what is
 * known about the database. Messages carry ids, positions and codes only — never SQL arguments or row
 * values. `cause` (when set) is the raw driver error, for local debugging; it is never persisted.
 */
export class MigrationError extends Error {
  readonly code: MigrationErrorCode;
  readonly phase: MigrationPhase;
  readonly migrationId?: string;
  readonly position?: number;
  readonly status?: MigrationSafeStatus;
  /** Migrations this invocation committed (or reconciled) before the error. */
  readonly results: readonly MigrationRunResult[];
  /** Post-flight only: the schema plan that still blocks. */
  readonly plan?: SchemaPlan;

  constructor(
    details: {
      code: MigrationErrorCode;
      phase: MigrationPhase;
      message: string;
      migrationId?: string;
      position?: number;
      status?: MigrationSafeStatus;
      results?: readonly MigrationRunResult[];
      plan?: SchemaPlan;
    },
    options?: { cause?: unknown }
  ) {
    super(details.message, options);
    this.name = 'MigrationError';
    this.code = details.code;
    this.phase = details.phase;
    if (details.migrationId !== undefined) this.migrationId = details.migrationId;
    if (details.position !== undefined) this.position = details.position;
    if (details.status !== undefined) this.status = details.status;
    this.results = details.results ?? [];
    if (details.plan !== undefined) this.plan = details.plan;
  }
}

export function isMigrationError(err: unknown): err is MigrationError {
  return err instanceof MigrationError;
}

// --- Validation -------------------------------------------------------------------------------

/**
 * Upper bound on statements per migration. The runner adds up to 7 ledger/guard statements (replace
 * mode), so one migration's batch stays within D1's free-plan 50 queries per Worker invocation. A whole
 * `runtime.runMigrations()` call also plans the schema before and after, so on that plan run few
 * migrations per invocation (see docs/SCHEMA-UPGRADES.md).
 */
export const MIGRATION_MAX_STATEMENTS = 40;
/** D1's bound-parameter limit per statement. */
const MAX_ARGS = 100;
const MAX_SQL_LENGTH = 100_000;
const MAX_RESET_BASELINE = 50;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TABLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FORBIDDEN_LEADING = new Set([
  'BEGIN',
  'COMMIT',
  'END',
  'ROLLBACK',
  'SAVEPOINT',
  'RELEASE',
  'VACUUM',
  'ATTACH',
  'DETACH'
]);
/** Forge-owned tables a migration's own SQL may not touch: the runner writes them itself. */
const OWNED_TABLES = /_forge_migrations|_forge_schema/i;

interface ScannedSql {
  /** Bare words outside literals, quoted identifiers and comments, upper-cased. */
  words: string[];
  positional: number;
  otherPlaceholders: boolean;
  /** Something other than whitespace/comments follows a `;`. */
  multiple: boolean;
}

/**
 * A small SQLite lexer: skips '…' literals, "…"/`…`/[…] identifiers and comments, and reports words,
 * placeholders and statement separators. Enough to validate — not a parser.
 */
function scanSql(sql: string): ScannedSql {
  const words: string[] = [];
  let positional = 0;
  let otherPlaceholders = false;
  let afterSemicolon = false;
  let multiple = false;
  let i = 0;
  const n = sql.length;
  const content = () => {
    if (afterSemicolon) multiple = true;
  };
  while (i < n) {
    const c = sql.charAt(i);
    if (c === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? n : end + 1;
    } else if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
    } else if (c === "'" || c === '"' || c === '`' || c === '[') {
      content();
      const close = c === '[' ? ']' : c;
      i++;
      while (i < n) {
        if (sql[i] === close) {
          // A doubled quote is an escaped quote inside the literal/identifier.
          if (close !== ']' && sql[i + 1] === close) {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
      i++;
    } else if (c === ';') {
      afterSemicolon = true;
      i++;
    } else if (/\s/.test(c)) {
      i++;
    } else if (c === '?') {
      content();
      if (/[0-9]/.test(sql.charAt(i + 1))) otherPlaceholders = true;
      else positional++;
      i++;
    } else if ((c === ':' || c === '@' || c === '$') && /[A-Za-z0-9_]/.test(sql.charAt(i + 1))) {
      content();
      otherPlaceholders = true;
      i++;
    } else if (/[A-Za-z_]/.test(c)) {
      content();
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(sql.charAt(j))) j++;
      words.push(sql.slice(i, j).toUpperCase());
      i = j;
    } else {
      content();
      i++;
    }
  }
  return { words, positional, otherPlaceholders, multiple };
}

function invalid(message: string, migrationId?: string): MigrationError {
  return new MigrationError({
    code: 'MIGRATION_INVALID',
    phase: 'validate',
    message,
    ...(migrationId !== undefined && { migrationId }),
    status: 'not-applied'
  });
}

/** Whether a statement obviously drops, renames or deletes (the `destructive: false` contradiction check). */
function obviouslyDestructive(words: readonly string[]): boolean {
  const first = words[0];
  if (first === 'DROP' || first === 'DELETE') return true;
  if (first === 'ALTER' && words[1] === 'TABLE') {
    return words.includes('DROP') || words.includes('RENAME');
  }
  return false;
}

function isMigrationValue(value: unknown): value is MigrationValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

/** Validates one definition; throws `MigrationError` (`MIGRATION_INVALID`) naming the first problem. */
export function assertValidMigration(definition: MigrationDefinition): void {
  const d = definition as unknown as Record<string, unknown>;
  if (typeof d !== 'object' || d === null) throw invalid('A migration must be an object.');
  const id = d.id;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw invalid(
      `Invalid migration id ${JSON.stringify(typeof id === 'string' ? id : String(id))}: use 1–128 ` +
        'characters from A–Z, a–z, 0–9, ".", "_" and "-", starting with a letter or digit.'
    );
  }
  if (typeof d.description !== 'string' || d.description.trim() === '') {
    throw invalid(`Migration "${id}" needs a non-empty description.`, id);
  }
  if (typeof d.destructive !== 'boolean') {
    throw invalid(`Migration "${id}" must declare destructive: true or false explicitly.`, id);
  }
  const statements = d.statements;
  if (!Array.isArray(statements) || statements.length > MIGRATION_MAX_STATEMENTS) {
    throw invalid(
      `Migration "${id}" needs at most ${MIGRATION_MAX_STATEMENTS} statements (it runs as one transactional batch).`,
      id
    );
  }
  // A migration with no SQL is only meaningful as a baseline reset (data already migrated by hand).
  const resets = Array.isArray(d.resetBaseline) ? d.resetBaseline.length : 0;
  if (statements.length === 0 && resets === 0) {
    throw invalid(
      `Migration "${id}" has no statements. A migration without SQL must declare resetBaseline.`,
      id
    );
  }
  statements.forEach((raw: unknown, index) => {
    const where = `Migration "${id}" statement ${index + 1}`;
    const statement = raw as Record<string, unknown> | null;
    if (typeof statement !== 'object' || statement === null) {
      throw invalid(`${where} must be { sql, args? }.`, id);
    }
    const sql = statement.sql;
    if (typeof sql !== 'string' || sql.trim() === '' || sql.length > MAX_SQL_LENGTH) {
      throw invalid(`${where} needs a non-empty sql string (at most ${MAX_SQL_LENGTH} chars).`, id);
    }
    const args = statement.args ?? [];
    if (!Array.isArray(args) || args.length > MAX_ARGS || !args.every(isMigrationValue)) {
      throw invalid(
        `${where}: args must be an array of at most ${MAX_ARGS} strings, finite numbers, booleans or null.`,
        id
      );
    }
    const scanned = scanSql(sql);
    if (scanned.multiple) {
      throw invalid(
        `${where} contains more than one SQL statement; split it into separate statements.`,
        id
      );
    }
    if (scanned.otherPlaceholders) {
      throw invalid(`${where} uses numbered or named placeholders; use positional "?" only.`, id);
    }
    if (scanned.positional !== args.length) {
      throw invalid(
        `${where} has ${scanned.positional} "?" placeholder(s) but ${args.length} arg(s).`,
        id
      );
    }
    const leading = scanned.words[0];
    if (leading === undefined) throw invalid(`${where} contains no SQL.`, id);
    if (FORBIDDEN_LEADING.has(leading)) {
      throw invalid(
        `${where} starts with ${leading}. The runner owns the transaction; transaction control, VACUUM, ` +
          'ATTACH and DETACH are not allowed.',
        id
      );
    }
    if (OWNED_TABLES.test(sql)) {
      throw invalid(
        `${where} references a Forge-owned table (_forge_migrations or _forge_schema). The runner writes ` +
          'the ledger itself; declare baseline resets with resetBaseline.',
        id
      );
    }
    if (d.destructive === false && obviouslyDestructive(scanned.words)) {
      throw invalid(
        `${where} drops, renames or deletes, but the migration declares destructive: false. Declare it ` +
          'destructive: true so running it needs explicit approval.',
        id
      );
    }
  });
  const reset = d.resetBaseline;
  if (reset !== undefined) {
    if (
      !Array.isArray(reset) ||
      reset.length > MAX_RESET_BASELINE ||
      !reset.every((t) => typeof t === 'string' && TABLE_PATTERN.test(t)) ||
      new Set(reset).size !== reset.length
    ) {
      throw invalid(
        `Migration "${id}": resetBaseline must list at most ${MAX_RESET_BASELINE} distinct table names.`,
        id
      );
    }
  }
}

/** Validates a definition and returns a frozen copy. The one documented way to write a migration. */
export function defineMigration(definition: MigrationDefinition): MigrationDefinition {
  assertValidMigration(definition);
  return Object.freeze({
    id: definition.id,
    description: definition.description,
    destructive: definition.destructive,
    statements: Object.freeze(
      definition.statements.map((s) =>
        Object.freeze({
          sql: s.sql,
          ...(s.args !== undefined && { args: Object.freeze([...s.args]) })
        })
      )
    ),
    ...(definition.resetBaseline !== undefined && {
      resetBaseline: Object.freeze([...definition.resetBaseline])
    })
  });
}

// --- Checksum ---------------------------------------------------------------------------------

function tagValue(value: MigrationValue): unknown[] {
  if (value === null) return ['null'];
  if (typeof value === 'string') return ['s', value];
  if (typeof value === 'number') return ['n', value];
  return ['b', value];
}

/**
 * The canonical checksum input (spec 072 §2): id, destructive flag, sorted baseline resets, and every
 * statement's SQL byte for byte with its type-tagged args. Description is excluded; nothing
 * environment-dependent is included.
 */
export function canonicalMigration(definition: MigrationDefinition): string {
  return JSON.stringify([
    'forge-migration',
    1,
    definition.id,
    definition.destructive,
    [...(definition.resetBaseline ?? [])].sort(),
    definition.statements.map((s) => [s.sql, (s.args ?? []).map(tagValue)])
  ]);
}

/** Lowercase hex SHA-256 of {@link canonicalMigration}. Web Crypto: identical on Node 22 and workerd. */
export async function migrationChecksum(definition: MigrationDefinition): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalMigration(definition));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface PreparedMigration {
  position: number;
  definition: MigrationDefinition;
  checksum: string;
}

/** Validates the whole list (including id uniqueness) and computes checksums. No I/O. */
export async function prepareMigrations(
  migrations: readonly MigrationDefinition[]
): Promise<PreparedMigration[]> {
  if (!Array.isArray(migrations)) throw invalid('migrations must be an array.');
  const seen = new Set<string>();
  const prepared: PreparedMigration[] = [];
  for (const [index, definition] of migrations.entries()) {
    assertValidMigration(definition);
    if (seen.has(definition.id)) {
      throw invalid(`Migration id "${definition.id}" appears more than once.`, definition.id);
    }
    seen.add(definition.id);
    prepared.push({
      position: index + 1,
      definition,
      checksum: await migrationChecksum(definition)
    });
  }
  return prepared;
}

// --- History rules ----------------------------------------------------------------------------

export interface MigrationHistoryPlan {
  states: MigrationState[];
  /** The recorded failed migration (always the last ledger row), if any. */
  failed: MigrationRecord | null;
}

function mismatch(
  code: 'MIGRATION_HISTORY_MISMATCH' | 'MIGRATION_CHECKSUM_MISMATCH',
  message: string,
  record?: MigrationRecord
): MigrationError {
  return new MigrationError({
    code,
    phase: 'preflight',
    message,
    ...(record !== undefined && { migrationId: record.id, position: record.position }),
    ...(record !== undefined && {
      status: record.status === 'applied' ? ('applied' as const) : ('failed' as const)
    })
  });
}

/**
 * Compares the ledger with the definitions (spec 072 §4). Pure. The ledger must be an exact prefix of
 * the list: positions 1..n, all applied but possibly the last (failed); every row's id and checksum must
 * match the definition at its position — except a failed row the caller approved replacing.
 */
export function planMigrationHistory(
  history: readonly MigrationRecord[],
  prepared: readonly PreparedMigration[],
  options: Pick<RunMigrationsOptions, 'replaceFailed'> = {}
): MigrationHistoryPlan {
  const rows = [...history].sort((a, b) => a.position - b.position);
  let failed: MigrationRecord | null = null;
  rows.forEach((row, index) => {
    if (row.position !== index + 1) {
      throw mismatch(
        'MIGRATION_HISTORY_MISMATCH',
        `The migration ledger is not contiguous: expected position ${index + 1}, found ${row.position} ` +
          `("${row.id}"). The ledger was edited by hand; restore it before running migrations.`,
        row
      );
    }
    if (row.status === 'failed' && index !== rows.length - 1) {
      throw mismatch(
        'MIGRATION_HISTORY_MISMATCH',
        `Migration "${row.id}" at position ${row.position} is recorded as failed but later migrations are ` +
          'recorded after it. The ledger was edited by hand.',
        row
      );
    }
    if (row.status === 'failed') failed = row;
    const expected = prepared[index];
    if (!expected) {
      throw mismatch(
        'MIGRATION_HISTORY_MISMATCH',
        `Migration "${row.id}" is recorded at position ${row.position} but the migrations list has only ` +
          `${prepared.length}. Migrations are append-only: never remove one that ran.`,
        row
      );
    }
    const replacing = row.status === 'failed' && options.replaceFailed === row.id;
    if (expected.definition.id !== row.id) {
      if (replacing) return;
      const elsewhere = prepared.find((p) => p.definition.id === row.id);
      throw mismatch(
        'MIGRATION_HISTORY_MISMATCH',
        elsewhere
          ? `Migration "${row.id}" is recorded at position ${row.position} but the list has it at position ` +
              `${elsewhere.position} and "${expected.definition.id}" at ${row.position}. Migrations are ` +
              'append-only: never reorder them.'
          : `Position ${row.position} is recorded as "${row.id}" but the list has "${expected.definition.id}" ` +
              'there. The database was migrated by a different migration history.',
        row
      );
    }
    if (expected.checksum !== row.checksum) {
      if (replacing) return;
      throw mismatch(
        'MIGRATION_CHECKSUM_MISMATCH',
        `Migration "${row.id}" (position ${row.position}) was ${row.status === 'applied' ? 'applied' : 'attempted'} ` +
          `with checksum ${row.checksum} but its definition now hashes to ${expected.checksum}. A ` +
          (row.status === 'applied'
            ? 'migration that ran must never be edited; write a new migration instead.'
            : 'recorded failed migration keeps its checksum; to run a corrected version, pass ' +
              `replaceFailed: "${row.id}".`),
        row
      );
    }
  });
  const byPosition = new Map(rows.map((row) => [row.position, row]));
  const states = prepared.map((p): MigrationState => {
    const row = byPosition.get(p.position);
    const matches = row && row.id === p.definition.id && row.checksum === p.checksum;
    return {
      position: p.position,
      id: p.definition.id,
      checksum: p.checksum,
      destructive: p.definition.destructive,
      state: matches ? row.status : 'pending'
    };
  });
  return { states, failed };
}
