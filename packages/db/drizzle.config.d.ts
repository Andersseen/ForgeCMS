/**
 * Drizzle Kit configuration for ForgeCMS.
 *
 * - Local development: uses SQLite (better-sqlite3 / libsql driver)
 * - Cloudflare D1: uncomment the D1 block below and comment the SQLite block.
 *
 * Note: schema is generated dynamically from CollectionDefinition at runtime,
 * so this config is primarily for migrations and type generation when using
 * a static schema file. For dynamic schema, use runtime.syncSchema().
 */
declare const _default: import("drizzle-kit").Config;
export default _default;
//# sourceMappingURL=drizzle.config.d.ts.map