/**
 * Conversions between a stored date and what the browser's native date controls speak.
 *
 * After spec 076 a date on the wire is a canonical ISO instant (`2026-10-08T12:30:00.000Z`); a
 * `<input type="date">` only accepts `YYYY-MM-DD` and `<input type="datetime-local">` only
 * `YYYY-MM-DDTHH:mm` (local wall-clock). No timezone is configurable: a date-only field is read and
 * written as its UTC calendar day, a `withTime` field as the viewer's local wall-clock time.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** `YYYY-MM-DD` for a native date control, or `''` when the value is not a date. */
export function toDateInputValue(value: unknown): string {
  if (typeof value === 'string' && DATE_ONLY.test(value)) return value;
  const date = toDate(value);
  return date === null ? '' : date.toISOString().slice(0, 10);
}

/** What a changed native date control submits: the `YYYY-MM-DD` day, or unset when cleared. */
export function fromDateInputValue(raw: string): string | undefined {
  return raw === '' ? undefined : raw;
}

/** `YYYY-MM-DDTHH:mm` (the viewer's local wall-clock time) for a native datetime-local control. */
export function toDateTimeLocalValue(value: unknown): string {
  const date = toDate(value);
  if (date === null) return '';
  return (
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * A changed datetime-local value as a canonical ISO instant. Unset when cleared; an unparseable
 * (half-typed) value is returned as typed so the field stays editable and the server reports it.
 */
export function fromDateTimeLocalValue(raw: string): string | undefined {
  if (raw === '') return undefined;
  // `new Date()` is lenient about partial strings; only a complete local date-time is converted.
  if (!DATE_TIME_LOCAL.test(raw)) return raw;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toISOString();
}
