import type { CollectionDefinition } from '@forge-cms/core';

export { InMemoryDatabaseAdapter } from './in-memory.adapter.js';
export { LibSqlDatabaseAdapter } from './libsql.adapter.js';
export {
  type ResolvedIndex,
  fieldKindToSqlType,
  toDbValue,
  fromDbValue,
  generateCreateTableSql,
  generateAddColumnSql,
  resolveCollectionIndexes,
  generateIndexSql,
  getOrCreateDrizzleTable,
  clearTableCache
} from './schema-generator.js';
export {
  type WhereOperator,
  type WhereValue,
  type WhereCondition,
  type WhereFields,
  type WhereAndGroup,
  type WhereOrGroup,
  type DatabaseWhere,
  type SortField,
  type SortInput,
  WHERE_OPERATORS,
  isWhereValue,
  isWhereAndGroup,
  isWhereOrGroup,
  isWhereGroup,
  isSortFieldArray,
  normalizeSort,
  toOperatorValue,
  toOperatorValues,
  matchesCondition,
  matchesWhere
} from './where.js';
export {
  UniqueConstraintError,
  isUniqueConstraintError,
  parseSqliteUniqueConstraintMessage,
  toUniqueConstraintError
} from './constraint-error.js';
import type { DatabaseWhere, SortInput } from './where.js';

export type DatabaseRecord = Record<string, unknown>;

export interface FindManyOptions {
  collection: string;
  limit?: number;
  offset?: number;
  where?: DatabaseWhere;
  sort?: SortInput;
  /** Only meaningful when `sort` is a plain field name; a `SortField[]` carries its own per-field order. */
  order?: 'asc' | 'desc';
}

export interface DatabaseAdapter<TRecord extends DatabaseRecord = DatabaseRecord> {
  readonly name: string;
  init(env?: unknown): this;
  findById(collection: string, id: string): Promise<TRecord | null>;
  findMany(options: FindManyOptions): Promise<TRecord[]>;
  /** Total matching records, ignoring limit/offset. Omit `where` to count the whole collection. */
  count(collection: string, where?: DatabaseWhere): Promise<number>;
  create(collection: string, data: TRecord): Promise<TRecord>;
  update(collection: string, id: string, data: Partial<TRecord>): Promise<TRecord>;
  delete(collection: string, id: string): Promise<void>;
  syncSchema(collections: CollectionDefinition[]): Promise<void>;
}
