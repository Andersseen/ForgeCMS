# @forge-cms/db

Database adapter contract for ForgeCMS, plus `InMemoryDatabaseAdapter` and `LibSqlDatabaseAdapter`
(libSQL / Turso / a local SQLite file).

## Schema upgrades

`syncSchema(collections)` plans before it changes anything (spec 070). Fresh tables and safe additive
changes (a new optional field, a new index) run as one transaction. Anything that would drop, rename,
retype, reinterpret or backfill data throws `SchemaDriftError` with nothing executed. Its `plan`
lists every change, classified `safe-additive`, `manual-migration`, `unsupported` or `informational`.

```ts
import { formatSchemaPlan, isSchemaDriftError } from '@forge-cms/db';

const plan = await database.planSchema(collections); // read-only
console.log(formatSchemaPlan(plan));
```

A SQLite-backed adapter can reuse the planner through `planSqliteSchema`/`syncSqliteSchema` and a
two-method `SqliteSchemaExecutor` (see `D1DatabaseAdapter` in `@forge-cms/cloudflare`). The full
classification and manual-migration guidance:
[docs/SCHEMA-UPGRADES.md](../../docs/SCHEMA-UPGRADES.md).

## Reviewed migrations

The changes `syncSchema` refuses are applied by reviewed migrations (spec 072). A migration is data:
single SQL statements with bound args, and no callback.

```ts
import { defineMigration } from '@forge-cms/db';

export const migrations = [
  defineMigration({
    id: '20260929_001_posts_headline_to_title',
    description: 'Rename posts.headline to title',
    destructive: true,
    statements: [{ sql: 'ALTER TABLE "posts" RENAME COLUMN "headline" TO "title"' }]
  })
];
```

Run them with `runtime.runMigrations(migrations, { allowDestructive: true })` from
`@forge-cms/runtime`, the one documented entry point, from a deploy script. `LibSqlDatabaseAdapter`
(and `D1DatabaseAdapter`) implement the optional `runMigrations`/`readMigrationHistory` capability
through the shared `runSqliteMigrations`/`readSqliteMigrationHistory`. Each migration commits as one
`client.batch(…, 'write')` together with its `_forge_migrations` ledger entry. The ledger enforces
checksums (`MIGRATION_CHECKSUM_MISMATCH`) and an append-only order (`MIGRATION_HISTORY_MISMATCH`).
Failures are a typed `MigrationError`. `InMemoryDatabaseAdapter` does not implement the capability.
Details and the operator guide:
[docs/SCHEMA-UPGRADES.md](../../docs/SCHEMA-UPGRADES.md#reviewed-migrations).
