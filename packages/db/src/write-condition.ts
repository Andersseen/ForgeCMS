import type { WriteCondition } from './index.js';

/**
 * Throws `RangeError` unless `keepAtLeast.others` is a non-negative integer. Shared by every adapter so
 * invalid input rejects identically, and before anything is written (spec 059).
 */
export function assertValidWriteCondition(condition: WriteCondition): void {
  // Validated whenever the clause is present, `others: undefined` included: an omitted floor must not
  // slip through and be ignored by one adapter (`n < undefined` is false) while another rejects it.
  if (condition.keepAtLeast === undefined) return;
  const { others } = condition.keepAtLeast;
  if (!Number.isInteger(others) || others < 0) {
    throw new RangeError(
      `WriteCondition.keepAtLeast.others must be a non-negative integer, got ${String(others)}`
    );
  }
}
