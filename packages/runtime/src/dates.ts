import type { AnyField, FieldMap } from '@forge-cms/core';

/**
 * One date representation (spec 076, demo finding 24): every valid `date` value a write carries — a
 * `Date`, a parseable string, a finite timestamp — is persisted as its `toISOString()` string, top-level
 * and nested in `group`/`array`/`blocks` alike. Before, the in-memory adapter echoed whatever text was
 * written while SQL printed `toISOString()`, and a numeric timestamp read back as `null` on libSQL/D1.
 *
 * Values validation would reject (unparseable strings, other types) and `null`/`undefined` are left
 * untouched, so validation keeps reporting them. Returns `data` itself when nothing changes.
 */
export function canonicalizeDates(
  fields: FieldMap,
  data: Record<string, unknown>
): Record<string, unknown> {
  let result = data;
  for (const [name, field] of Object.entries(fields)) {
    if (!(name in data)) continue;
    const value = data[name];
    const next = canonicalizeValue(field, value);
    if (next === value) continue;
    if (result === data) result = { ...data };
    result[name] = next;
  }
  return result;
}

function canonicalizeValue(field: AnyField, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  switch (field.kind) {
    case 'date':
      return canonicalDate(value);
    case 'group':
      return isRecord(value) ? canonicalizeDates(field.options.fields, value) : value;
    case 'array':
      return Array.isArray(value) ? mapRows(value, () => field.options.fields) : value;
    case 'blocks':
      return Array.isArray(value)
        ? mapRows(value, (row) => {
            const block = field.options.blocks.find((b) => b.slug === row['blockType']);
            return block?.fields as FieldMap | undefined;
          })
        : value;
    default:
      return value;
  }
}

function mapRows(
  rows: unknown[],
  fieldsFor: (row: Record<string, unknown>) => FieldMap | undefined
): unknown[] {
  let result = rows;
  rows.forEach((row, index) => {
    if (!isRecord(row)) return;
    const fields = fieldsFor(row);
    if (!fields) return;
    const next = canonicalizeDates(fields, row);
    if (next === row) return;
    if (result === rows) result = [...rows];
    result[index] = next;
  });
  return result;
}

function canonicalDate(value: unknown): unknown {
  if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') {
    return value;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const iso = parsed.toISOString();
  return iso === value ? value : iso;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
