import { describe, expect, it } from 'vitest';
import { parseSqliteUniqueConstraintMessage, toUniqueConstraintError } from './constraint-error.js';

describe('parseSqliteUniqueConstraintMessage', () => {
  it('parses plain SQLite/libSQL single-column messages', () => {
    expect(parseSqliteUniqueConstraintMessage('UNIQUE constraint failed: widgets.slug')).toEqual({
      table: 'widgets',
      columns: ['slug']
    });
  });

  it('parses plain SQLite/libSQL compound-column messages', () => {
    expect(
      parseSqliteUniqueConstraintMessage('UNIQUE constraint failed: pages.tenant, pages.slug')
    ).toEqual({ table: 'pages', columns: ['tenant', 'slug'] });
  });

  // spec 051: found by testing against a real local D1 binding. A real D1 driver appends a
  // trailing diagnostic suffix *after* the column list that plain SQLite/libSQL never emits; the
  // hand-rolled D1 test mock's crafted error strings never included it, so this regressed silently
  // until proven against real D1.
  it('parses a real D1 compound-column message, stripping the trailing diagnostic suffix', () => {
    expect(
      parseSqliteUniqueConstraintMessage(
        'D1_ERROR: UNIQUE constraint failed: pages.tenant, pages.slug: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)'
      )
    ).toEqual({ table: 'pages', columns: ['tenant', 'slug'] });
  });

  it('parses a real D1 single-column message with the trailing diagnostic suffix', () => {
    expect(
      parseSqliteUniqueConstraintMessage(
        'D1_ERROR: UNIQUE constraint failed: widgets.slug: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)'
      )
    ).toEqual({ table: 'widgets', columns: ['slug'] });
  });

  it('returns null for an unrelated message', () => {
    expect(parseSqliteUniqueConstraintMessage('no such table: widgets')).toBeNull();
  });
});

describe('toUniqueConstraintError', () => {
  it('never lets the diagnostic suffix leak into .fields (client-facing via UniqueConstraintError.fields)', () => {
    const err = new Error(
      'D1_ERROR: UNIQUE constraint failed: pages.tenant, pages.slug: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)'
    );
    const converted = toUniqueConstraintError(err, 'pages');
    expect(converted?.fields).toEqual(['tenant', 'slug']);
    expect(converted?.fields.join(' ')).not.toMatch(/SQLITE|extended/i);
  });

  it('walks .cause chains looking for the real driver message', () => {
    const driverErr = new Error('UNIQUE constraint failed: widgets.slug');
    const wrapped = new Error('insert failed', { cause: driverErr });
    const converted = toUniqueConstraintError(wrapped, 'widgets');
    expect(converted?.fields).toEqual(['slug']);
  });

  it('returns null for a non-constraint error', () => {
    expect(toUniqueConstraintError(new Error('no such table: widgets'), 'widgets')).toBeNull();
  });
});
