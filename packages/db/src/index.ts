import type { CollectionDefinition } from '@forge-cms/core';

export { InMemoryDatabaseAdapter } from './in-memory.adapter.js';
export { LibSqlDatabaseAdapter } from './libsql.adapter.js';
export {
  type ResolvedIndex,
  fieldKindToSqlType,
  toDbValue,
  fromDbValue,
  generateCreateTableSql,
  generateAddColumnSql,
  resolveCollectionIndexes,
  generateIndexSql,
  getOrCreateDrizzleTable,
  clearTableCache
} from './schema-generator.js';
export {
  type WhereOperator,
  type WhereValue,
  type WhereCondition,
  type WhereFields,
  type WhereAndGroup,
  type WhereOrGroup,
  type DatabaseWhere,
  type SortField,
  type SortInput,
  WHERE_OPERATORS,
  isWhereValue,
  isWhereAndGroup,
  isWhereOrGroup,
  isWhereGroup,
  isSortFieldArray,
  normalizeSort,
  toOperatorValue,
  toOperatorValues,
  matchesCondition,
  matchesWhere
} from './where.js';
export { assertValidWriteCondition } from './write-condition.js';
export {
  ATOMIC_WRITE_MAX_OPERATIONS,
  ATOMIC_WRITE_REQUIRE_APPLIED_SQL,
  AtomicWriteConditionError,
  isAtomicWriteConditionError,
  assertValidAtomicWrite,
  toAtomicWriteError,
  atomicWriteMustApply
} from './atomic-write.js';
export {
  UniqueConstraintError,
  isUniqueConstraintError,
  parseSqliteUniqueConstraintMessage,
  toUniqueConstraintError
} from './constraint-error.js';
import type { DatabaseWhere, SortInput } from './where.js';

export type DatabaseRecord = Record<string, unknown>;

export interface FindManyOptions {
  collection: string;
  limit?: number;
  offset?: number;
  where?: DatabaseWhere;
  sort?: SortInput;
  /** Only meaningful when `sort` is a plain field name; a `SortField[]` carries its own per-field order. */
  order?: 'asc' | 'desc';
}

/**
 * Precondition of a conditional write (`updateIf`/`deleteIf`). The database evaluates it atomically
 * with the write, against the state at the instant of the write — never against a value the caller
 * read earlier. Every clause present must hold; `{}` holds whenever the target row exists.
 */
export interface WriteCondition {
  /**
   * The target row, as it is right now, must match (per-row compare-and-set). Uses the ordinary
   * `DatabaseWhere` language, so it inherits its one known cross-adapter gap: `ne` against a NULL/unset
   * column matches on InMemory but not on SQL adapters (`NULL != x` is unknown). Prefer `eq`/`in` for
   * compare-and-set.
   */
  targetMatches?: DatabaseWhere;
  /**
   * Set floor. Let S be the rows of the collection matching `where`. If the target row is currently
   * in S, the write applies only when at least `others` OTHER rows are also in S. If the target is
   * not in S the clause holds vacuously (removing a non-member cannot shrink S). `others` must be a
   * non-negative integer.
   *
   * The database does not check that the write really removes the target from S (an update might
   * keep it in); the clause is a conservative precondition. Attach it to writes that _may_ remove
   * the row from S. It is scoped to the write's own collection.
   */
  keepAtLeast?: { where: DatabaseWhere; others: number };
}

export type ConditionalUpdateResult<TRecord extends DatabaseRecord = DatabaseRecord> =
  | { applied: true; record: TRecord }
  | { applied: false };

export interface ConditionalDeleteResult {
  applied: boolean;
}

/**
 * One write of an {@link DatabaseAdapter.atomicWrite} batch (spec 060). Each mirrors the adapter method
 * of the same name, so "a batch of X is calling X in order, atomically" is the whole explanation. Pure
 * data: there is no way to run code between operations.
 */
export type AtomicWriteOperation<TRecord extends DatabaseRecord = DatabaseRecord> =
  | { type: 'create'; collection: string; data: TRecord }
  | { type: 'update'; collection: string; id: string; data: Partial<TRecord> }
  | { type: 'delete'; collection: string; id: string }
  | {
      type: 'updateIf';
      collection: string;
      id: string;
      data: Partial<TRecord>;
      condition: WriteCondition;
      /** Fail (and roll back) the whole batch when this write does not apply. Default `false`: `applied: false` is a valid result. */
      requireApplied?: boolean;
    }
  | {
      type: 'deleteIf';
      collection: string;
      id: string;
      condition: WriteCondition;
      /** Fail (and roll back) the whole batch when this write does not apply. Default `false`: `applied: false` is a valid result. */
      requireApplied?: boolean;
    };

/** Result of one operation, in the same position and with the same `type` as the input operation. */
export type AtomicWriteResult<TRecord extends DatabaseRecord = DatabaseRecord> =
  | { type: 'create'; record: TRecord }
  | { type: 'update'; record: TRecord }
  | { type: 'delete' }
  | ({ type: 'updateIf' } & ConditionalUpdateResult<TRecord>)
  | ({ type: 'deleteIf' } & ConditionalDeleteResult);

export interface DatabaseAdapter<TRecord extends DatabaseRecord = DatabaseRecord> {
  readonly name: string;
  init(env?: unknown): this;
  findById(collection: string, id: string): Promise<TRecord | null>;
  findMany(options: FindManyOptions): Promise<TRecord[]>;
  /** Total matching records, ignoring limit/offset. Omit `where` to count the whole collection. */
  count(collection: string, where?: DatabaseWhere): Promise<number>;
  create(collection: string, data: TRecord): Promise<TRecord>;
  update(collection: string, id: string, data: Partial<TRecord>): Promise<TRecord>;
  delete(collection: string, id: string): Promise<void>;
  /**
   * Conditional `update()` (spec 059): applies `data` to the row `id` only if `condition` holds, with
   * the check and the write as ONE atomic step against every other writer of the same database.
   *
   * - Applied → `{ applied: true, record }`, the row as written (hydrated like `update()`'s result).
   * - Row missing or condition false → `{ applied: false }`, nothing changed. Neither is an error
   *   (unlike `update()`, which throws for a missing row). `applied` is authoritative; a caller that
   *   re-reads to tell the two apart gets an advisory answer only.
   * - Would violate a unique index → throws `UniqueConstraintError`, nothing changed. A failed
   *   condition wins over a constraint conflict (constraints are only checked for a row actually written).
   * - Database failure or invalid input (unknown column, unregistered collection, bad `others`) →
   *   rejects; never reported as `applied: false`. Invalid input rejects before any write — except
   *   that `InMemoryDatabaseAdapter` (like all its other methods) does not check column names or that
   *   the collection was synced, so on it a typo in a condition's `where` silently matches nothing;
   *   a non-integer `others` rejects on every adapter.
   *
   * Atomicity: libSQL (one SQL statement), D1 (one statement; the database runs queries one at a
   * time), InMemory (one synchronous turn — one adapter instance/process only). Not atomic across
   * calls, and not a transaction: it cannot span more than one row write.
   */
  updateIf(
    collection: string,
    id: string,
    data: Partial<TRecord>,
    condition: WriteCondition
  ): Promise<ConditionalUpdateResult<TRecord>>;
  /**
   * Conditional `delete()` (spec 059): deletes row `id` only if `condition` holds, atomically with the
   * check. Returns `{ applied: true }` when a row was deleted, `{ applied: false }` when the row was
   * missing or the condition false (neither is an error). Failures reject, exactly as for `updateIf`.
   */
  deleteIf(
    collection: string,
    id: string,
    condition: WriteCondition
  ): Promise<ConditionalDeleteResult>;
  /**
   * Atomic write batch (spec 060): runs `operations` in order and **either commits all of them or none**.
   * Declarative and database-only — not a callback transaction, and never spans object storage.
   *
   * - Success → one result per operation, same order/length as the input (empty batch → `[]`, no I/O).
   *   Later operations observe the effects of earlier ones. Records are hydrated as the single calls do.
   * - `update` of a missing row, or a `requireApplied` conditional that does not apply → rejects with
   *   `AtomicWriteConditionError`. Without `requireApplied`, `updateIf`/`deleteIf` report `applied: false`
   *   (spec 059) and the rest of the batch still commits. `delete` of a missing row is a no-op.
   * - Unique-index violation, including between two operations of the batch → `UniqueConstraintError`
   *   (`collection` names the table that conflicted). Nothing persisted.
   * - Invalid input (more than `ATOMIC_WRITE_MAX_OPERATIONS`, malformed operation, bad `others`, and on
   *   SQL adapters an unregistered collection or unknown column) rejects before anything is written.
   * - Any other failure rejects; SQL backends roll back. Never reported as a result.
   *
   * Retry: the errors above mean "known rolled back". A network failure after the request left the
   * process is outcome-unknown — do not blindly retry; supply your own unique keys (on SQL adapters, ids too) so a retry is
   * recognisable. No exactly-once promise.
   *
   * Atomicity: libSQL (`client.batch(…, 'write')`), D1 (`batch()`), InMemory (staged copy published in
   * one synchronous turn — one adapter instance/process only). Not atomic across calls.
   */
  atomicWrite(
    operations: readonly AtomicWriteOperation<TRecord>[]
  ): Promise<AtomicWriteResult<TRecord>[]>;
  syncSchema(collections: CollectionDefinition[]): Promise<void>;
}
