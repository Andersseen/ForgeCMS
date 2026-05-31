import { defineConfig } from 'drizzle-kit';

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

export default defineConfig({
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'file:./forge-cms.db'
  },
  // For Cloudflare D1, replace the above with:
  // dialect: 'sqlite',
  // driver: 'd1',
  // dbCredentials: {
  //   databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID!,
  //   token: process.env.CLOUDFLARE_API_TOKEN!
  // }
});
