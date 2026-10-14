---
name: forgecms-migrations-recovery
description: Prepare reviewed ForgeCMS schema migrations, drift checks, and backup/restore procedures without risking data.
---

# ForgeCMS migrations and recovery

## Drift first

```ts
import { formatSchemaPlan } from '@forge-cms/db';
console.log(formatSchemaPlan(await runtime.planSchema()));
```

`planSchema()` reports what changed. A startup that finds blocking drift raises `SchemaDriftError`. Adding nullable columns/tables is safe and `syncSchema()` applies it; renames, drops and type changes are **not** safe and need a reviewed migration.

## Reviewed migration

```ts
import { defineMigration } from '@forge-cms/db';

const migrations = [
  defineMigration({
    id: '20260929_001_posts_headline_to_title',
    description: 'Rename posts.headline to title',
    destructive: true,
    statements: [{ sql: 'ALTER TABLE "posts" RENAME COLUMN "headline" TO "title"' }]
  })
];
const report = await runtime.runMigrations(migrations, { allowDestructive: true });
```

- A migration is **data**: id, description, explicit `destructive` flag, single SQL statements with bound arguments. There is no `up(db)` callback.
- **Append-only:** never edit, reorder or remove a migration that ran anywhere (`MIGRATION_CHECKSUM_MISMATCH`, `MIGRATION_HISTORY_MISMATCH`).
- Run from a deploy/maintenance script, **never at application startup**.
- Destructive migrations require `allowDestructive: true` and a **verified backup first**. ForgeCMS cannot verify your backup.
- No down migrations: fix forward or restore a backup. Deploying old code does not roll the database back.
- After migrating, `planSchema()` must no longer block.

## Backup and restore

Both profiles have rehearsed procedures: D1 + R2, and libSQL + S3. There is no atomic cross-store snapshot and no point-in-time recovery. Back up the database and the file store, restore into an **isolated** target first, and check application health before switching. Follow the backup/restore and schema-upgrades docs (`forge_docs_search "backup restore"`).

## Do not

- Do not generate a migration and apply it to production in the same step; produce it for human review.
- Do not rename a column by changing the schema alone.
- Do not run destructive SQL from an agent session against real data.
