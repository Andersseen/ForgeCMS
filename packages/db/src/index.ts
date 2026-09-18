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
  syncSchema(collections: CollectionDefinition[]): Promise<void>;
}
