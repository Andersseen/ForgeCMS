---
title: Schema upgrades
description: What happens to an existing database when you change a collection, and what ForgeCMS will and will not do for you.
group: Client & deploy
order: 5
---

> **Availability.** Drift detection (`planSchema()`, `SchemaDriftError`) ships in `@forge-cms/*@0.8.0`,
> reviewed migrations (`runtime.runMigrations()`) from `0.8.1`. With `0.7.0` or older, `syncSchema()`
> is additive only: it creates tables and adds columns, and it does **not** detect or refuse the
> changes below.

You change a collection in TypeScript. The database already holds rows written with the old
definition. What happens on the next start?

**ForgeCMS plans before it writes.** `runtime.syncSchema()` compares the schema you declared with the
schema actually stored. It applies only changes that cannot lose or reinterpret data. It refuses
everything else with a precise report and **executes nothing**. It never runs migrations for you: the
changes it refuses are applied by [reviewed migrations](#reviewed-migrations) you write and run from
your deploy script.

```ts
await runtime.syncSchema(); // still the only call a fresh or additive setup needs
```

| Situation                            | What `syncSchema()` does                               |
| ------------------------------------ | ------------------------------------------------------ |
| Fresh database                       | Creates every table.                                   |
| Only safe additive changes           | Applies them all in one transaction.                   |
| Anything that needs a data migration | Throws `SchemaDriftError`. Nothing runs, in any table. |

## Check before you deploy

`planSchema()` is read-only. Run it against a copy of production, or from a deploy check:

```ts
import { formatSchemaPlan, isSchemaDriftError } from '@forge-cms/db';

const plan = await runtime.planSchema();
console.log(formatSchemaPlan(plan)); // table/column/index names and counts, never row values
if (plan.blocking) process.exit(1);

try {
  await runtime.syncSchema();
} catch (err) {
  if (isSchemaDriftError(err)) console.error(formatSchemaPlan(err.plan));
  throw err;
}
```

## What counts as safe

**Applied automatically:** a new collection or global, a new optional field, a new required field on
an empty table, `drafts`/`upload` on an empty table, a new non-unique index, and a new unique index
when the existing data has no duplicates.

**Refused until a reviewed migration converts the data:**

- a removed or **renamed** field (a rename is never guessed; it looks like a removal plus an addition);
- a changed storage type (`text` → `number`);
- `localized` or relation `many` switched on or off;
- a new required field on a table with rows;
- `drafts`/`upload` enabled on a table with rows;
- `unique` ⇄ `index` changes;
- a new unique index over duplicate rows.

**Reported as information only:** a stale non-unique index, a changed default, and compatible text
kinds (`text` ⇄ `textarea`).

A `defaultValue` is applied when a document is created. It is never written into existing rows, and
it is never a backfill.

## Your first upgrade of an existing database

ForgeCMS records a small semantic baseline per table in `_forge_schema` after each successful sync.
A database created before drift detection has none. The first sync can only compare what SQLite
metadata shows (columns, types, indexes), and records the baseline from there. Semantic changes you
made _before_ that first sync (for example switching `localized` on) cannot be detected after the
fact.

## Reviewed migrations

A migration is data: an id, a description, an explicit `destructive` flag, and single SQL statements
with bound arguments. There is no `up(db)` callback. That is what lets libSQL and D1 both run it as
**one transactional batch** together with its entry in the `_forge_migrations` history table.

```ts
import { defineMigration, formatSchemaPlan } from '@forge-cms/db';

// Append-only: never edit, reorder or remove a migration that ran anywhere.
const migrations = [
  defineMigration({
    id: '20260929_001_posts_headline_to_title',
    description: 'Rename posts.headline to title',
    destructive: true,
    statements: [{ sql: 'ALTER TABLE "posts" RENAME COLUMN "headline" TO "title"' }]
  })
];

// In a deploy/maintenance script, never at application startup:
console.log(formatSchemaPlan(await runtime.planSchema())); // what drifted
const report = await runtime.runMigrations(migrations, { allowDestructive: true });
console.log(report.results, formatSchemaPlan(report.after)); // after never blocks
```

- **Exactly once.** A migration that already ran is skipped. An edited one fails with
  `MIGRATION_CHECKSUM_MISMATCH`, and a reordered or removed one with `MIGRATION_HISTORY_MISMATCH`,
  before anything runs.
- **Concurrent deploys are safe.** Two runners cannot both run the same position; the database decides.
- **Failures are honest.** An error means one of:
  - rolled back, and recorded as failed (rerun only with `retryFailed` or `replaceFailed`);
  - applied, when the ledger proves it after a lost response;
  - outcome unknown (never retried automatically).
- **Destructive migrations** need `allowDestructive: true`. Back up first; ForgeCMS cannot verify
  backups.
- **Post-flight.** After the migrations, `syncSchema()` applies the safe remainder and `planSchema()`
  must no longer block. If it does, the error says the migrations **committed** and were not rolled
  back.
- **No down migrations.** A wrong committed migration is fixed forward or by restoring a backup.
  Deploying old code does not roll the database back.

## Where this is going

- **Done (roadmap 0.7):** detect drift and refuse it safely (M01), reviewed, ordered migrations with
  a durable history (M02), and a release-gating rehearsal (M03): databases written by `0.4.0`, `0.6.0`
  and `0.8.0` upgrade through this path on libSQL and local D1/R2, and an upgraded installation is
  backed up and restored into an empty environment with working logins, content, history and files.

## Backups

A backup is the whole database plus every object a document references (`_storageKey`), taken while
writes are stopped: the database and the object storage do not share a transaction. Restore into a
new, empty database and bucket, verify (`planSchema()` clean, `readMigrationHistory()` unchanged,
the same migrations report `already-applied`, a login, a file), then switch over. Commands for
libSQL, D1 (`wrangler d1 export` / `d1 execute --file`) and R2 are in `docs/BACKUP-RESTORE.md` in the
repository.

The full reference, with the complete change matrix and the operator guide, is
`docs/SCHEMA-UPGRADES.md` in the repository.
