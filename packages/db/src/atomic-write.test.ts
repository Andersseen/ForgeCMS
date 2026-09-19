import { describe, expect, it } from 'vitest';
import { UniqueConstraintError } from './constraint-error.js';
import {
  AtomicWriteConditionError,
  ATOMIC_WRITE_MAX_OPERATIONS,
  atomicWriteMustApply,
  assertValidAtomicWrite,
  toAtomicWriteError
} from './atomic-write.js';

// Spec 060. The SQL adapters classify a failed batch by the engine's message alone (D1's batch error has
// no statement index), so what is and is not recognised is pinned down here.
describe('toAtomicWriteError', () => {
  it('turns a SQLite unique violation into UniqueConstraintError naming the table', () => {
    const error = toAtomicWriteError(
      new Error('SQLITE_ERROR: UNIQUE constraint failed: slots.key')
    );
    expect(error).toBeInstanceOf(UniqueConstraintError);
    expect(error).toMatchObject({ collection: 'slots', fields: ['key'] });
  });

  it("copes with D1's trailing diagnostic suffix and compound indexes", () => {
    const error = toAtomicWriteError(
      new Error(
        'D1_ERROR: UNIQUE constraint failed: posts.a, posts.b: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)'
      )
    );
    expect(error).toMatchObject({ collection: 'posts', fields: ['a', 'b'] });
  });

  it('turns the must-apply guard failure into AtomicWriteConditionError, keeping the cause', () => {
    const original = new Error('D1_ERROR: integer overflow: SQLITE_ERROR');
    const error = toAtomicWriteError(original);
    expect(error).toBeInstanceOf(AtomicWriteConditionError);
    expect((error as Error).cause).toBe(original);
  });

  it('finds the message through a wrapped cause chain (drizzle / libSQL nesting)', () => {
    const wrapped = new Error('Failed query', {
      cause: new Error('LibsqlBatchError', { cause: new Error('SQLITE_ERROR: integer overflow') })
    });
    expect(toAtomicWriteError(wrapped)).toBeInstanceOf(AtomicWriteConditionError);
  });

  it('returns every other failure untouched, never converting it into a typed rollback', () => {
    for (const original of [
      new Error('D1_ERROR: no such table: slots: SQLITE_ERROR'),
      new Error('network timeout'),
      'not even an Error'
    ]) {
      expect(toAtomicWriteError(original)).toBe(original);
    }
  });
});

describe('atomicWriteMustApply', () => {
  it('is true for a plain update and for requireApplied conditionals only', () => {
    const base = { collection: 'c', id: 'i' };
    expect(atomicWriteMustApply({ type: 'update', ...base, data: {} })).toBe(true);
    expect(atomicWriteMustApply({ type: 'updateIf', ...base, data: {}, condition: {} })).toBe(
      false
    );
    expect(
      atomicWriteMustApply({
        type: 'updateIf',
        ...base,
        data: {},
        condition: {},
        requireApplied: true
      })
    ).toBe(true);
    expect(atomicWriteMustApply({ type: 'deleteIf', ...base, condition: {} })).toBe(false);
    expect(
      atomicWriteMustApply({ type: 'deleteIf', ...base, condition: {}, requireApplied: true })
    ).toBe(true);
    expect(atomicWriteMustApply({ type: 'create', collection: 'c', data: {} })).toBe(false);
    expect(atomicWriteMustApply({ type: 'delete', ...base })).toBe(false);
  });
});

describe('assertValidAtomicWrite', () => {
  it('accepts exactly the cap and rejects one more', () => {
    const create = { type: 'create', collection: 'c', data: {} } as const;
    expect(() =>
      assertValidAtomicWrite(Array.from({ length: ATOMIC_WRITE_MAX_OPERATIONS }, () => create))
    ).not.toThrow();
    expect(() =>
      assertValidAtomicWrite(Array.from({ length: ATOMIC_WRITE_MAX_OPERATIONS + 1 }, () => create))
    ).toThrow(RangeError);
  });
});
