import { describe, expect, it } from 'vitest';
import {
  fromDateInputValue,
  fromDateTimeLocalValue,
  toDateInputValue,
  toDateTimeLocalValue
} from './date-value.js';

// None of these depend on the machine's timezone: expectations are built from the same local
// components the code reads, never from a hard-coded offset.
const local = (y: number, mo: number, d: number, h: number, mi: number): Date =>
  new Date(y, mo - 1, d, h, mi);

describe('date-only fields', () => {
  it('shows a canonical ISO instant as its calendar day', () => {
    expect(toDateInputValue('2026-10-08T00:00:00.000Z')).toBe('2026-10-08');
    expect(toDateInputValue('2026-10-08T23:59:59.999Z')).toBe('2026-10-08');
    expect(toDateInputValue(new Date('2026-01-02T00:00:00.000Z'))).toBe('2026-01-02');
  });

  it('keeps a bare YYYY-MM-DD as is, and shows nothing for non-dates', () => {
    expect(toDateInputValue('2026-10-08')).toBe('2026-10-08');
    for (const value of [undefined, null, '', 'soon', {}, NaN])
      expect(toDateInputValue(value)).toBe('');
  });

  it('submits the picked day, or unset when cleared', () => {
    expect(fromDateInputValue('2026-10-08')).toBe('2026-10-08');
    expect(fromDateInputValue('')).toBeUndefined();
  });
});

describe('withTime fields', () => {
  it('shows an ISO instant as the viewer’s local wall-clock time', () => {
    const instant = local(2026, 10, 8, 12, 30);
    expect(toDateTimeLocalValue(instant.toISOString())).toBe('2026-10-08T12:30');
    expect(toDateTimeLocalValue(local(2026, 1, 2, 3, 4).toISOString())).toBe('2026-01-02T03:04');
  });

  it('turns a picked local time back into a canonical ISO instant', () => {
    const iso = fromDateTimeLocalValue('2026-10-08T12:30');
    expect(iso).toBe(local(2026, 10, 8, 12, 30).toISOString());
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('round-trips without drift', () => {
    const iso = local(2026, 3, 29, 9, 45).toISOString();
    expect(fromDateTimeLocalValue(toDateTimeLocalValue(iso))).toBe(iso);
  });

  it('clears to unset, shows nothing for non-dates, and leaves a half-typed value for the server', () => {
    expect(fromDateTimeLocalValue('')).toBeUndefined();
    expect(toDateTimeLocalValue('nope')).toBe('');
    expect(toDateTimeLocalValue(undefined)).toBe('');
    expect(fromDateTimeLocalValue('2026-10-')).toBe('2026-10-');
  });
});
