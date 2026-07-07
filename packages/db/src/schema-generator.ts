import type { CollectionDefinition, AnyField } from '@forge-cms/core';
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

export function fieldKindToSqlType(field: AnyField): string {
  switch (field.kind) {
    case 'text':
    case 'relation':
    case 'date':
    case 'json':
    case 'select':
    case 'slug':
    case 'email':
    case 'textarea':
      return 'TEXT';
    case 'number':
      return 'REAL';
    case 'boolean':
      return 'INTEGER';
    default:
      return 'TEXT';
  }
}

export function toDbValue(value: unknown, kind: AnyField['kind']): unknown {
  if (value === null || value === undefined) return null;
  switch (kind) {
    case 'boolean':
      return value ? 1 : 0;
    case 'relation':
      return Array.isArray(value) ? JSON.stringify(value) : value;
    case 'date':
      return value instanceof Date ? value.toISOString() : value;
    case 'json':
      return typeof value === 'string' ? value : JSON.stringify(value);
    default:
      return value;
  }
}

export function fromDbValue(value: unknown, kind: AnyField['kind']): unknown {
  if (value === null || value === undefined) return null;
  switch (kind) {
    case 'boolean':
      return value === 1 || value === true;
    case 'relation':
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      return value;
    case 'date':
      return typeof value === 'string' ? new Date(value) : value;
    case 'json':
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      return value;
    default:
      return value;
  }
}

export function generateCreateTableSql(collection: CollectionDefinition): string {
  const fieldColumns = Object.entries(collection.fields)
    .map(([name, field]) => `"${name}" ${fieldKindToSqlType(field)}`)
    .join(', ');

  // Must be a single line: Cloudflare D1's real exec() splits its input on '\n' to detect multiple
  // statements, so a pretty-printed multi-line CREATE TABLE gets sliced into invalid fragments and
  // fails with "incomplete input" (verified against a real local D1 binding, not just mocks).
  return `CREATE TABLE IF NOT EXISTS "${collection.slug}" ("id" TEXT PRIMARY KEY, "created_at" TEXT, "updated_at" TEXT${fieldColumns ? ', ' + fieldColumns : ''})`;
}

const tableCache = new Map<string, SQLiteTable>();

export function getOrCreateDrizzleTable(collection: CollectionDefinition): SQLiteTable {
  const cached = tableCache.get(collection.slug);
  if (cached) return cached;

  const columns: Record<string, ReturnType<typeof text>> = {
    id: text('id').primaryKey(),
    created_at: text('created_at'),
    updated_at: text('updated_at')
  };

  for (const [name, field] of Object.entries(collection.fields)) {
    switch (fieldKindToSqlType(field)) {
      case 'INTEGER':
        columns[name] = integer(name) as unknown as ReturnType<typeof text>;
        break;
      case 'REAL':
        columns[name] = real(name) as unknown as ReturnType<typeof text>;
        break;
      default:
        columns[name] = text(name);
        break;
    }
  }

  const table = sqliteTable(collection.slug, columns);
  tableCache.set(collection.slug, table);
  return table;
}

export function clearTableCache(): void {
  tableCache.clear();
}
