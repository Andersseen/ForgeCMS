import type { CollectionDefinition } from '@forge-cms/core';

export { InMemoryDatabaseAdapter } from './in-memory.adapter.js';
export { LibSqlDatabaseAdapter } from './libsql.adapter.js';
export {
  fieldKindToSqlType,
  toDbValue,
  fromDbValue,
  generateCreateTableSql,
  getOrCreateDrizzleTable,
  clearTableCache
} from './schema-generator.js';

export type DatabaseRecord = Record<string, unknown>;

export interface FindManyOptions {
  collection: string;
  limit?: number;
  offset?: number;
  where?: DatabaseRecord;
}

export interface DatabaseAdapter<TRecord extends DatabaseRecord = DatabaseRecord> {
  readonly name: string;
  init(env?: unknown): this;
  findById(collection: string, id: string): Promise<TRecord | null>;
  findMany(options: FindManyOptions): Promise<TRecord[]>;
  create(collection: string, data: TRecord): Promise<TRecord>;
  update(collection: string, id: string, data: Partial<TRecord>): Promise<TRecord>;
  delete(collection: string, id: string): Promise<void>;
  syncSchema(collections: CollectionDefinition[]): Promise<void>;
}
