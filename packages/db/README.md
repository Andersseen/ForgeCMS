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
