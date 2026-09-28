import type { CollectionDefinition, AnyField } from '@forge-cms/core';
import { validateCollectionIdentifiers, validateCollectionIndexes } from '@forge-cms/core';
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

/**
 * The composite kinds (`group`/`array`/`blocks`, spec 022) map to TEXT and are stored as one JSON
 * document. Join tables would only buy the ability to query *inside* nested data, which nothing
 * needs yet, and they cost a migration story this project does not have.
 */
export function fieldKindToSqlType(field: AnyField): SqlColumnType {
  // A localized field holds one value per locale — a JSON map in a TEXT column, whatever its kind
  // (spec 066). Before, a localized field got its kind's column and every SQL write of its map failed.
  if (field.options.localized === true) return 'TEXT';
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

/**
 * {@link toDbValue} for a declared field: a `localized` field's per-locale map is stored as one JSON
 * document (spec 066); every other field is encoded by its kind. What SQL adapters write.
 */
export function encodeFieldValue(value: unknown, field: AnyField): unknown {
  if (field.options.localized === true) {
    if (value === null || value === undefined) return null;
    // Always encoded, so decoding is unambiguous (a stored "2024" is never read back as a number).
    return JSON.stringify(value);
  }
  return toDbValue(value, field.kind);
}

/** The inverse of {@link encodeFieldValue}: what SQL adapters hydrate a stored column into. */
export function decodeFieldValue(value: unknown, field: AnyField): unknown {
  if (field.options.localized === true) {
    if (typeof value !== 'string') return value ?? null;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return fromDbValue(value, field.kind);
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

/** SQLite storage type Forge declares for a column. */
export type SqlColumnType = 'TEXT' | 'REAL' | 'INTEGER';

/** One column of a Forge table: a system column Forge owns, or a declared field. */
export interface DesiredColumn {
  name: string;
  type: SqlColumnType;
  role: 'primary-key' | 'system' | 'field';
  /** The declared field, for `role: 'field'`. */
  field?: AnyField;
}

/** The physical table Forge wants for a collection: the one source DDL generation and planning share (spec 070). */
export interface DesiredTable {
  name: string;
  columns: DesiredColumn[];
  indexes: ResolvedIndex[];
}

/**
 * The desired physical schema of a collection: `id`/`created_at`/`updated_at`, `_status` for drafts,
 * `_storageKey` for uploads, then one column per declared field, plus its resolved indexes. Everything
 * that creates tables or plans changes reads this, so DDL and drift detection cannot disagree.
 */
export function desiredTableSchema(collection: CollectionDefinition): DesiredTable {
  assertValidCollectionSchema(collection);
  const columns: DesiredColumn[] = [
    { name: 'id', type: 'TEXT', role: 'primary-key' },
    { name: 'created_at', type: 'TEXT', role: 'system' },
    { name: 'updated_at', type: 'TEXT', role: 'system' }
  ];
  if (collection.drafts === true) columns.push({ name: '_status', type: 'TEXT', role: 'system' });
  if (collection.upload === true) {
    columns.push({ name: '_storageKey', type: 'TEXT', role: 'system' });
  }
  for (const [name, field] of Object.entries(collection.fields)) {
    columns.push({ name, type: fieldKindToSqlType(field), role: 'field', field });
  }
  return { name: collection.slug, columns, indexes: resolveCollectionIndexes(collection) };
}

/** `CREATE TABLE IF NOT EXISTS` for a desired table. */
export function createTableSql(table: DesiredTable): string {
  const columns = table.columns
    .map((c) => `"${c.name}" ${c.type}${c.role === 'primary-key' ? ' PRIMARY KEY' : ''}`)
    .join(', ');
  return `CREATE TABLE IF NOT EXISTS "${table.name}" (${columns})`;
}

/** `ALTER TABLE … ADD COLUMN` for one desired column. */
export function addColumnSql(table: string, column: DesiredColumn): string {
  return `ALTER TABLE "${table}" ADD COLUMN "${column.name}" ${column.type}`;
}

/** `CREATE [UNIQUE] INDEX IF NOT EXISTS` for one resolved index. */
export function createIndexSql(table: string, index: ResolvedIndex): string {
  const uniqueClause = index.unique ? 'UNIQUE ' : '';
  const columns = index.fields.map((f) => `"${f}"`).join(', ');
  return `CREATE ${uniqueClause}INDEX IF NOT EXISTS "${index.name}" ON "${table}" (${columns})`;
}

export function generateCreateTableSql(collection: CollectionDefinition): string {
  return createTableSql(desiredTableSchema(collection));
}

/**
 * Additive migration: one `ALTER TABLE ... ADD COLUMN` per field in the collection's current
 * definition that isn't already a column on the existing table. Never drops or retypes columns.
 *
 * @deprecated Since spec 070 the SQL adapters plan schema changes (`planSqliteSchema`), which also
 * covers `_status`/`_storageKey`, types and indexes. Kept for compatibility; it only sees fields.
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
  return resolveCollectionIndexes(collection).map((index) =>
    createIndexSql(collection.slug, index)
  );
}

const tableCache = new Map<string, SQLiteTable>();

export function getOrCreateDrizzleTable(collection: CollectionDefinition): SQLiteTable {
  assertValidCollectionSchema(collection);
  const cached = tableCache.get(collection.slug);
  if (cached) return cached;

  const columns: Record<string, ReturnType<typeof text>> = {};
  for (const column of desiredTableSchema(collection).columns) {
    switch (column.type) {
      case 'INTEGER':
        columns[column.name] = integer(column.name) as unknown as ReturnType<typeof text>;
        break;
      case 'REAL':
        columns[column.name] = real(column.name) as unknown as ReturnType<typeof text>;
        break;
      default:
        columns[column.name] =
          column.role === 'primary-key' ? text(column.name).primaryKey() : text(column.name);
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
