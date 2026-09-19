import type { AtomicWriteOperation } from './index.js';
import { UniqueConstraintError, parseSqliteUniqueConstraintMessage } from './constraint-error.js';
import { assertValidWriteCondition } from './write-condition.js';

/**
 * Upper bound on operations in one `atomicWrite()` (spec 060). The primitive is for a handful of
 * already-decided writes — a claim and its user, a document and its snapshot — not bulk import. Small on
 * purpose; D1's own per-query and per-invocation limits still apply on top.
 */
export const ATOMIC_WRITE_MAX_OPERATIONS = 25;

/**
 * Thrown by `atomicWrite()` when an operation that had to apply did not: a plain `update` whose row is
 * missing, or an `updateIf`/`deleteIf` with `requireApplied: true` whose row is missing or whose
 * condition failed. Nothing in the batch was persisted. "Missing" and "refused" are not distinguished
 * (as for spec 059's `applied: false`); re-read to find out, knowing the answer is advisory.
 */
export class AtomicWriteConditionError extends Error {
  readonly code = 'ATOMIC_WRITE_CONDITION_FAILED' as const;

  constructor(options?: { cause?: unknown }) {
    super(
      'Atomic write rolled back: an operation that had to apply did not (its target row was missing or its condition did not hold). Nothing was written.',
      options
    );
    this.name = 'AtomicWriteConditionError';
  }
}

export function isAtomicWriteConditionError(err: unknown): err is AtomicWriteConditionError {
  return err instanceof AtomicWriteConditionError;
}

/**
 * SQL statement the SQL adapters place right after a statement that MUST have changed a row. It raises
 * an error — which aborts the whole batch and rolls it back — exactly when the previous statement changed
 * no row: `changes()` is that statement's row count on the same connection/transaction, and `abs()` of
 * the minimum 64-bit integer raises "integer overflow". This is how "the operation did not apply" becomes
 * a rollback decided by the database, without an interactive transaction (D1 has none). Spiked on real
 * libSQL and real local D1 (spec 060). No Forge statement does arithmetic, so a genuine overflow from
 * user data cannot occur.
 */
export const ATOMIC_WRITE_REQUIRE_APPLIED_SQL =
  'SELECT abs(CASE WHEN changes() = 0 THEN -9223372036854775808 ELSE 0 END)';

const GUARD_FAILURE_MESSAGE = /integer overflow/i;

/** How many `.cause` links to follow looking for the real driver message (drizzle/libSQL nest it). */
const MAX_CAUSE_DEPTH = 5;

/**
 * Converts whatever a SQL driver threw for a failed batch into Forge's typed errors: a unique-index
 * violation becomes {@link UniqueConstraintError} (its `collection` is the table SQLite names, which is
 * what tells a caller *which* operation of the batch conflicted); the "required operation did not
 * apply" guard becomes {@link AtomicWriteConditionError}. Anything else is returned unchanged for the
 * caller to rethrow.
 */
export function toAtomicWriteError(err: unknown): unknown {
  let current: unknown = err;
  for (let depth = 0; current instanceof Error && depth < MAX_CAUSE_DEPTH; depth++) {
    const unique = parseSqliteUniqueConstraintMessage(current.message);
    if (unique) return new UniqueConstraintError(unique.table, unique.columns);
    if (GUARD_FAILURE_MESSAGE.test(current.message)) {
      return new AtomicWriteConditionError({ cause: err });
    }
    current = current.cause;
  }
  return err;
}

/** Whether `operation`, when it changes no row, must fail the whole batch. */
export function atomicWriteMustApply(operation: AtomicWriteOperation): boolean {
  switch (operation.type) {
    case 'update':
      return true;
    case 'updateIf':
    case 'deleteIf':
      return operation.requireApplied === true;
    default:
      return false;
  }
}

function fail(index: number, message: string): never {
  throw new TypeError(`atomicWrite operation ${index}: ${message}`);
}

/**
 * Throws unless `operations` is a well-formed batch. Shared by every adapter so invalid input rejects
 * identically and **before anything is sent to the database** (spec 060). Schema-dependent checks
 * (unregistered collection, unknown column) stay with the adapters that know the schema.
 */
export function assertValidAtomicWrite(operations: readonly AtomicWriteOperation[]): void {
  if (!Array.isArray(operations)) {
    throw new TypeError('atomicWrite expects an array of operations');
  }
  if (operations.length > ATOMIC_WRITE_MAX_OPERATIONS) {
    throw new RangeError(
      `atomicWrite accepts at most ${ATOMIC_WRITE_MAX_OPERATIONS} operations, got ${operations.length}`
    );
  }

  operations.forEach((operation: unknown, index) => {
    if (typeof operation !== 'object' || operation === null) fail(index, 'must be an object');
    const op = operation as Record<string, unknown>;
    const type = op.type;
    if (
      type !== 'create' &&
      type !== 'update' &&
      type !== 'delete' &&
      type !== 'updateIf' &&
      type !== 'deleteIf'
    ) {
      fail(index, `unknown type ${JSON.stringify(type)}`);
    }
    if (typeof op.collection !== 'string' || op.collection === '') {
      fail(index, 'collection must be a non-empty string');
    }
    if (type !== 'create' && (typeof op.id !== 'string' || op.id === '')) {
      fail(index, 'id must be a non-empty string');
    }
    if (type !== 'delete' && type !== 'deleteIf') {
      if (typeof op.data !== 'object' || op.data === null || Array.isArray(op.data)) {
        fail(index, 'data must be an object');
      }
    }
    if (type === 'updateIf' || type === 'deleteIf') {
      if (typeof op.condition !== 'object' || op.condition === null) {
        fail(index, 'condition must be an object (use {} for "the row exists")');
      }
      assertValidWriteCondition(op.condition as never);
      if (op.requireApplied !== undefined && typeof op.requireApplied !== 'boolean') {
        fail(index, 'requireApplied must be a boolean');
      }
    }
  });
}
