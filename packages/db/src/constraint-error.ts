/**
 * Thrown by a `DatabaseAdapter` when a `create`/`update` would violate a unique index — whether that
 * index came from field-level `unique: true` or a collection-level compound `indexes` entry. Every
 * adapter (`InMemoryDatabaseAdapter`, `LibSqlDatabaseAdapter`, and `@forge-cms/cloudflare`'s
 * `D1DatabaseAdapter`) throws this same type, so callers do not need adapter-specific handling.
 */
export class UniqueConstraintError extends Error {
  readonly code = 'UNIQUE_CONSTRAINT' as const;
  readonly collection: string;
  readonly fields: string[];
  readonly indexName?: string;

  constructor(collection: string, fields: string[], indexName?: string) {
    super(
      fields.length > 0
        ? `Unique constraint violated on "${collection}" (${fields.join(', ')})`
        : `Unique constraint violated on "${collection}"`
    );
    this.name = 'UniqueConstraintError';
    this.collection = collection;
    this.fields = fields;
    if (indexName !== undefined) this.indexName = indexName;
  }
}

export function isUniqueConstraintError(err: unknown): err is UniqueConstraintError {
  return err instanceof UniqueConstraintError;
}

/**
 * Parses SQLite's standard `UNIQUE constraint failed: table.col1, table.col2` message. Both D1 and
 * libSQL are backed by SQLite and wrap this same message (D1 prefixes it with `D1_ERROR:`, libSQL
 * with `SQLITE_CONSTRAINT`), so one parser covers both.
 */
export function parseSqliteUniqueConstraintMessage(
  message: string
): { table: string; columns: string[] } | null {
  const match = /UNIQUE constraint failed:\s*([^\n]+)/i.exec(message);
  if (!match?.[1]) return null;

  const columns: string[] = [];
  let table = '';
  for (const part of match[1].split(',')) {
    const [rawTable, rawColumn] = part.split('.').map((s) => s.trim());
    if (rawTable && rawColumn) {
      table = rawTable;
      columns.push(rawColumn);
    }
  }

  return table ? { table, columns } : null;
}

/** How many `.cause` links to follow looking for the real driver message (drizzle/libSQL nest it two
 *  or three deep: DrizzleQueryError -> LibsqlError -> the raw sqlite error). */
const MAX_CAUSE_DEPTH = 5;

/**
 * Converts a raw error caught around an adapter's insert/update call into a
 * {@link UniqueConstraintError}, or returns `null` when the error is not a SQLite unique-constraint
 * violation (callers should rethrow the original error in that case). Driver/ORM layers wrap the
 * actual SQLite error in `.cause`, so this walks that chain rather than only checking the top message.
 */
export function toUniqueConstraintError(
  err: unknown,
  collectionSlug: string
): UniqueConstraintError | null {
  let current: unknown = err;
  for (let depth = 0; current instanceof Error && depth < MAX_CAUSE_DEPTH; depth++) {
    const parsed = parseSqliteUniqueConstraintMessage(current.message);
    if (parsed) return new UniqueConstraintError(collectionSlug, parsed.columns);
    current = current.cause;
  }
  return null;
}
