import type { CollectionDefinition, AnyField } from '@forge-cms/core';
import { validateCollectionIdentifiers, validateCollectionIndexes } from '@forge-cms/core';
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

/**
 * The composite kinds (`group`/`array`/`blocks`, spec 022) map to TEXT and are stored as one JSON
 * document. Join tables would only buy the ability to query *inside* nested data, which nothing
 * needs yet, and they cost a migration story this project does not have.
 */
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
    case 'richtext':
    case 'upload':
    case 'group':
    case 'array':
    case 'blocks':
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
    case 'richtext':
    case 'group':
    case 'array':
    case 'blocks':
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
    case 'richtext':
    case 'group':
    case 'array':
    case 'blocks':
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

function assertValidCollectionSchema(collection: CollectionDefinition): void {
  const errors = [
    ...validateCollectionIdentifiers(collection),
    ...validateCollectionIndexes(collection)
  ];
  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }
}

export function generateCreateTableSql(collection: CollectionDefinition): string {
  assertValidCollectionSchema(collection);
  const fieldColumns = Object.entries(collection.fields)
    .map(([name, field]) => `"${name}" ${fieldKindToSqlType(field)}`)
    .join(', ');

  const statusColumn = collection.drafts === true ? ', "_status" TEXT' : '';
  const storageKeyColumn = collection.upload === true ? ', "_storageKey" TEXT' : '';

  return `CREATE TABLE IF NOT EXISTS "${collection.slug}" ("id" TEXT PRIMARY KEY, "created_at" TEXT, "updated_at" TEXT${statusColumn}${storageKeyColumn}${fieldColumns ? ', ' + fieldColumns : ''})`;
}

/**
 * Additive migration: one `ALTER TABLE ... ADD COLUMN` per field in the collection's current
 * definition that isn't already a column on the existing table. Never drops or retypes columns.
 */
export function generateAddColumnSql(
  collection: CollectionDefinition,
  existingColumns: Iterable<string>
): string[] {
  assertValidCollectionSchema(collection);
  const existing = new Set(existingColumns);
  const statements: string[] = [];

  for (const [name, field] of Object.entries(collection.fields)) {
    if (!existing.has(name)) {
      statements.push(
        `ALTER TABLE "${collection.slug}" ADD COLUMN "${name}" ${fieldKindToSqlType(field)}`
      );
    }
  }

  return statements;
}

/** One SQL index, normalized from either a field-level `unique`/`index` option or an `indexes` entry. */
export interface ResolvedIndex {
  name: string;
  fields: string[];
  unique: boolean;
}

function indexName(collectionSlug: string, fields: string[]): string {
  return `idx_${collectionSlug}_${fields.join('_')}`;
}

/**
 * Normalizes every index a collection declares — single-field `unique: true`/`index: true` on a field
 * plus collection-level `indexes` — into one deterministically-named list. Naming matches the
 * pre-existing single-field convention exactly (`idx_<collection>_<field>`), so collections that only
 * ever used field-level options generate the same index names as before.
 */
export function resolveCollectionIndexes(collection: CollectionDefinition): ResolvedIndex[] {
  assertValidCollectionSchema(collection);
  const indexes: ResolvedIndex[] = [];

  for (const [fieldName, field] of Object.entries(collection.fields)) {
    if (field.options.unique === true || field.options.index === true) {
      indexes.push({
        name: indexName(collection.slug, [fieldName]),
        fields: [fieldName],
        unique: field.options.unique === true
      });
    }
  }

  for (const index of collection.indexes ?? []) {
    indexes.push({
      name: indexName(collection.slug, index.fields),
      fields: index.fields,
      unique: index.unique === true
    });
  }

  return indexes;
}

/**
 * Generates `CREATE [UNIQUE ]INDEX IF NOT EXISTS` statements for every index a collection declares.
 * Shared by `LibSqlDatabaseAdapter` (this package) and `D1DatabaseAdapter` (`@forge-cms/cloudflare`,
 * which already depends on this package) so the two SQLite-backed adapters cannot diverge.
 */
export function generateIndexSql(collection: CollectionDefinition): string[] {
  return resolveCollectionIndexes(collection).map((index) => {
    const uniqueClause = index.unique ? 'UNIQUE ' : '';
    const columns = index.fields.map((f) => `"${f}"`).join(', ');
    return `CREATE ${uniqueClause}INDEX IF NOT EXISTS "${index.name}" ON "${collection.slug}" (${columns})`;
  });
}

const tableCache = new Map<string, SQLiteTable>();

export function getOrCreateDrizzleTable(collection: CollectionDefinition): SQLiteTable {
  assertValidCollectionSchema(collection);
  const cached = tableCache.get(collection.slug);
  if (cached) return cached;

  const columns: Record<string, ReturnType<typeof text>> = {
    id: text('id').primaryKey(),
    created_at: text('created_at'),
    updated_at: text('updated_at'),
    ...(collection.drafts === true && { _status: text('_status') }),
    ...(collection.upload === true && { _storageKey: text('_storageKey') })
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
