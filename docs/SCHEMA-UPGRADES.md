# Schema upgrades — `syncSchema()`, drift plans and reviewed migrations

This guide is for anyone who changes a ForgeCMS collection or global definition after data already
exists: on a local libSQL file, a Turso database or Cloudflare D1. It covers two layers:

- **Drift planning** ([spec 070](specs/070-schema-drift-detection-and-upgrade-planning.md), roadmap
  0.7 M01, in npm `0.8.0`). Before it touches anything, `syncSchema()` compares the schema you
  declared with the schema actually stored. It applies only changes that cannot lose or reinterpret
  data, and refuses everything else with a precise report.
- **Reviewed migrations** ([spec 072](specs/072-reviewed-migration-execution.md), roadmap 0.7 M02, in
  npm `0.8.1` and later). They apply the refused changes, as SQL you wrote and reviewed, exactly once,
  atomically with a durable history. See [Reviewed migrations](#reviewed-migrations) and the
  [operator guide](#operator-guide).

Both are rehearsed on every CI run against databases written by older releases (`0.4.0`, `0.6.0`,
`0.8.0`), on libSQL and local D1/R2, followed by a backup and a restore into an empty environment
(roadmap 0.7 M03, [spec 073](specs/073-historical-upgrade-and-backup-restore-rehearsal.md)). Backups
and recovery: [BACKUP-RESTORE.md](BACKUP-RESTORE.md).

## The short version

```ts
await runtime.syncSchema(); // unchanged: still the only call a fresh or additive setup needs
```

- **Fresh database:** every table is created. Nothing else to do.
- **Only safe additive changes** (a new optional field, a new collection, a new index): applied
  automatically, in one transaction.
- **Anything else:** `syncSchema()` throws a `SchemaDriftError` and **executes nothing**, in any
  table. A safe change in collection A is not applied either when collection B is blocked.

To see the plan without changing anything:

```ts
import { formatSchemaPlan } from '@forge-cms/db';

const plan = await runtime.planSchema(); // read-only
console.log(formatSchemaPlan(plan));
if (plan.blocking) process.exit(1); // e.g. in a deploy check
```

The error is typed, so a deploy script never has to parse SQLite messages:

```ts
import { isSchemaDriftError, formatSchemaPlan } from '@forge-cms/db';

try {
  await runtime.syncSchema();
} catch (err) {
  if (isSchemaDriftError(err)) {
    console.error(formatSchemaPlan(err.plan)); // err.code === 'SCHEMA_DRIFT'
  }
  throw err;
}
```

Example output:

```text
Schema plan: 2 blocking, 1 safe additive, 1 informational.

Blocking (manual migration or unsupported):
  posts.views  column-type-changed  [manual-migration]
    stored: TEXT; desired: REAL
    The stored values are in the old storage type; Forge never converts values. Convert the column in a reviewed migration.
  posts.idx_posts_slug  index-changed  [manual-migration]
    stored: non-unique (slug); desired: unique (slug)
    The Forge schema now requires uniqueness but the stored index of the same name is not unique, …

Safe additive (applied by syncSchema() only when nothing blocks):
  posts.summary  column-added  [safe-additive]
    New optional field; existing rows read as empty.

Informational:
  posts.legacy_idx  index-removed  [informational]
    An index the Forge schema does not declare. It changes no behaviour; drop it when convenient.
```

The output never contains row values, only table, column and index names and counts.

## The three categories

### Safe additive: Forge applies it

| Change                                                | Why it is safe                                                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| New collection / global / versions table              | No existing data.                                                                             |
| New optional field                                    | Existing rows read it as empty. A `defaultValue` is **not** written into them (see Defaults). |
| New required field on an **empty** table              | No row can lack it.                                                                           |
| `drafts: true` / `upload: true` on an **empty** table | No row needs a status or an object key.                                                       |
| New non-unique index                                  | Changes no behaviour.                                                                         |
| New unique index, and existing data has no duplicates | You declared the rule; a preflight proved today's data satisfies it (see below).              |

### Manual migration: Forge understands the change and will not transform your data

| Change                                                                                   | What to do                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Field removed                                                                            | The column (and its values) stays. Copy data elsewhere if needed, then `ALTER TABLE … DROP COLUMN`.                                                                                                          |
| **Field renamed**                                                                        | Reported as "removed old field" + "added new field". **Forge never guesses a rename.** Copy values, drop the old column.                                                                                     |
| Storage type changed (e.g. `text` → `number`)                                            | Convert values in a new column or table.                                                                                                                                                                     |
| Kind changed within TEXT (e.g. `text` → `email`, `json` → `blocks`, `text` → `relation`) | The values are stored the same way but mean something else, or fail new validation. Convert or validate them.                                                                                                |
| `localized` switched on or off                                                           | Plain `"Hello"` ⇄ `{"en":"Hello"}`. Wrap values under a locale, or pick one locale to keep.                                                                                                                  |
| Relation `many` switched on or off                                                       | `"id"` ⇄ `["id"]`. Convert the values.                                                                                                                                                                       |
| Relation/upload target collection changed                                                | Stored ids point at the old collection. Re-point them.                                                                                                                                                       |
| New required field, rows exist                                                           | Add the column, backfill every row.                                                                                                                                                                          |
| Existing field made required, rows lack a value                                          | Backfill. Once no row is missing a value, the next sync passes by itself.                                                                                                                                    |
| `drafts: true` on a table with rows                                                      | Add `_status TEXT` and set it to `'published'` or `'draft'` for every row. Anonymous reads only return published rows, so leaving it empty would hide them all.                                              |
| `upload: true` on a table with rows                                                      | The rows are not file records. Add `_storageKey TEXT` and backfill it, or move the rows.                                                                                                                     |
| `drafts` / `upload` switched off                                                         | The `_status` / `_storageKey` column stays. Publish or delete the drafts (they would become public) or decide about the stored objects, then drop the column.                                                |
| `unique` → `index` (or an index removed while unique)                                    | The stored UNIQUE index still rejects duplicates. Drop or replace it.                                                                                                                                        |
| `index` → `unique` on the same field                                                     | SQLite cannot make an index unique in place. Check for duplicates, drop the old index, sync again.                                                                                                           |
| Compound unique index columns changed                                                    | The old UNIQUE index would keep enforcing the old rule, so the sync blocks. Drop it; the next sync adds the new index. A changed **non-unique** compound index does not block: the old one is only reported. |
| New unique index over duplicate rows                                                     | Resolve the duplicates. The report gives counts only. Forge never deletes or rewrites rows.                                                                                                                  |

### Unsupported: Forge cannot tell what a safe transformation is

- A table whose `id` is not the only TEXT primary key, or that lacks `created_at`/`updated_at`.
- A column-level `UNIQUE` constraint Forge did not create (removing it needs a table rebuild).
- A Forge system column with the wrong type.
- A generated index name (`idx_<table>_<fields>`) that another table already uses. SQLite index names
  are database-wide, e.g. `blog` + `posts_slug` and `blog_posts` + `slug`. Rename one of them.
- A baseline (see below) written by a newer ForgeCMS version.

### Informational: nothing to do

- A stale non-unique index.
- `text` ⇄ `textarea` and `email`/`slug`/`select` → `text`/`textarea` (same representation, no new rule).
- A changed default.
- A newly required field that every row already fills.
- The first baseline being recorded.

## Defaults

`defaultValue` is applied when a document is **created**, never on read and never retroactively.
Adding, changing or removing a default does not rewrite any stored row. A plan reports a changed
default as informational only. A default is also never a backfill: a new required field with a
default is still a manual migration when rows exist.

## Uniqueness and NULL

A unique index follows SQLite's rule: rows with a NULL in any indexed column never conflict.
Forge's duplicate preflight uses the same rule, so it only reports a conflict SQLite would really
reject.

## The baseline table (`_forge_schema`) and your first upgrade

SQLite metadata cannot tell `"Hello"` from `{"en":"Hello"}`, a single id from an id array, or `text`
from `email`. So on every successful sync Forge records, per table, the few semantic facts it needs
next time: kind, localized, relation cardinality and target, required, static default. It lives in
`_forge_schema`, one row per table. It is not a migration history: it has no ids, checksums or
status.

**A database created before this version has no baseline.** On its first sync:

- Physical checks all run (columns, types, `_status`/`_storageKey`, indexes, uniqueness, duplicates).
- Semantic changes made **before** the upgrade cannot be detected. Forge does not know your previous
  TypeScript configuration and does not guess it. The plan says so (`baseline-recorded`,
  informational), and the current configuration becomes the baseline.
- From then on, semantic changes are detected.

**After converting a semantic change** (for example, wrapping every `title` into `{"en": …}`), the
old baseline no longer describes the data. Declare that in the migration itself with
`resetBaseline: ['posts']` (see [Reviewed migrations](#reviewed-migrations)). The baseline row is
deleted in the same transaction as the conversion, and the post-flight sync records the new one.
Physical checks still run.

If the data was already converted by hand, record that with a migration that has no SQL:

```ts
defineMigration({
  id: '20260929_002_posts_title_baseline',
  description: 'posts.title was wrapped into {"en": …} by hand; record the new baseline',
  destructive: false,
  statements: [],
  resetBaseline: ['posts']
});
```

`DELETE FROM "_forge_schema" WHERE "id" = 'posts'` by hand still works, but it is now an emergency
escape hatch: it leaves no history.

## Reviewed migrations

A reviewed migration is **data, not code**: an id, a description, a `destructive` flag and an ordered
list of single SQL statements with bound arguments. There is no `up(db)` callback. This lets libSQL
and D1 run the whole migration as **one transactional batch**, because D1 has no interactive
transaction.

```ts
import { defineMigration } from '@forge-cms/db';

// migrations.ts — append-only. Never edit, reorder or remove an entry that ran anywhere.
export const migrations = [
  defineMigration({
    id: '20260929_001_posts_headline_to_title',
    description: 'Rename posts.headline to title',
    destructive: true,
    statements: [{ sql: 'ALTER TABLE "posts" RENAME COLUMN "headline" TO "title"' }]
  }),
  defineMigration({
    id: '20260929_002_notes_summary',
    description: 'Add notes.summary and backfill it',
    destructive: false,
    statements: [
      { sql: 'ALTER TABLE "notes" ADD COLUMN "summary" TEXT' },
      { sql: 'UPDATE "notes" SET "summary" = ? WHERE "summary" IS NULL', args: ['(none)'] }
    ]
  })
];
```

`defineMigration` validates before anything touches the database:

- **The id** uses `A–Z a–z 0–9 . _ -` and is unique in the list.
- **The description** is required.
- **`destructive`** is explicit.
- **Statements:** at most 40, each exactly one SQL statement with positional `?` placeholders matching
  `args` (strings, finite numbers, booleans, `null`).
- **Refused statements:**
  - transaction control, `VACUUM`, `ATTACH` or `DETACH`;
  - any reference to `_forge_migrations` or `_forge_schema`;
  - `destructive: false` on a statement that obviously drops, renames or deletes.

Migration definitions are trusted deployment code. Never build one from request data.

### Running them

The one supported entry point is the runtime, from a deployment or maintenance script. **Never from
application startup**: `init()` and `syncSchema()` never run migrations.

```ts
import { formatSchemaPlan, isMigrationError } from '@forge-cms/db';
import { migrations } from './migrations';

const runtime = createRuntime(env).init(); // your usual runtime factory

// 1. Preflight (read-only): what drifted, and which migrations are pending.
console.log(formatSchemaPlan(await runtime.planSchema()));
console.table(await runtime.planMigrations(migrations)); // position, id, checksum, destructive, state

// 2. Run. Destructive migrations need explicit approval, after a backup.
try {
  const report = await runtime.runMigrations(migrations, { allowDestructive: true });
  console.table(report.results); // applied | already-applied | reconciled
  // 3. Post-flight already ran: syncSchema() for the safe remainder, then planSchema().
  console.log(formatSchemaPlan(report.after)); // never blocking here
} catch (err) {
  if (isMigrationError(err)) console.error(err.code, err.migrationId, err.status, err.message);
  throw err;
}
```

`runMigrations` runs these steps in order:

1. Validates every definition.
2. `before = planSchema()`.
3. Runs each pending migration as one batch.
4. Post-flight: `syncSchema()` applies whatever safe additive work remains (e.g. the unique index a
   migration made possible) and records baselines.
5. `after = planSchema()` must not block.

`runtime.readMigrationHistory()` returns the ledger: position, id, checksum, status, timestamps,
attempts and failure code.

### What one migration commits

```text
one transactional batch (libSQL client.batch(…, 'write'), D1 batch())
  1. guard: the ledger is exactly the prefix this runner planned against
  2. claim: INSERT the ledger row (id primary key, unique position), status "running"
  3. DELETE the resetBaseline rows from _forge_schema (if declared)
  4. your statements, in order
  5. mark the row "applied" (finished_at = database clock)
```

All of it commits or none of it does. A `running` row is never committed.

### The ledger `_forge_migrations`

| Column                     | Meaning                                                                   |
| -------------------------- | ------------------------------------------------------------------------- |
| `id` (primary key)         | migration id                                                              |
| `position` (unique)        | 1 + index in your array; the history is an exact prefix of the array      |
| `checksum`                 | SHA-256 (lowercase hex) of the canonical definition                       |
| `status`                   | `applied` or `failed`                                                     |
| `started_at`/`finished_at` | runner clock at the latest attempt / database clock at commit             |
| `attempts`, `failure_code` | attempts recorded; error class/code of the last failure (e.g. `D1_ERROR`) |

No SQL text, argument or error message is stored. The ledger is created through the same M01
planner. Creating it touches nothing else, so it works while your tables are blocked by drift.

**Checksum.** It covers the id, the `destructive` flag, the sorted `resetBaseline`, and every
statement's SQL byte for byte with type-tagged args (`'1'`, `1` and `true` differ). It excludes the
description, dates, paths and host names. Reformatting the SQL of a migration that ran is an edit.

### History rules

- The array is **append-only**. Before anything runs, the ledger must be an exact prefix of it.
- Applied migrations are skipped (`already-applied`).
- An applied migration whose checksum changed → `MIGRATION_CHECKSUM_MISMATCH`. Write a new migration
  instead.
- A missing, reordered or different migration at a recorded position → `MIGRATION_HISTORY_MISMATCH`.

### Concurrency

Two deploy processes can race. The claim is unique by id and by position, inside the same batch as
the SQL, so the database lets only one of them commit a position:

- Same migration: the winner reports `applied` and the loser `reconciled`. The SQL ran once.
- Different migrations at the same position: the loser fails closed with
  `MIGRATION_HISTORY_MISMATCH` and none of its SQL runs.

Proven with independent clients/adapter instances and a deterministic barrier on on-disk libSQL and
local D1.

## Operator guide

### Fresh install

`await runtime.syncSchema()`. Nothing else.

### Safe additive upgrade

`planSchema()` to look (optional), then `syncSchema()`.

### Blocking upgrade (reviewed migration)

1. Back up the database **and** the objects its documents reference, with writes stopped
   ([BACKUP-RESTORE.md](BACKUP-RESTORE.md)).
2. Deploy nothing yet. Run `planSchema()` with the **new** configuration and read the blocking changes.
3. Write the migration and review it. Mark it `destructive: true` if it drops, renames, rewrites or
   deletes.
4. From the deploy script: `runMigrations(migrations, { allowDestructive: true })`. Its post-flight
   runs `syncSchema()` and verifies the plan no longer blocks.
5. Deploy the application.

### When a migration fails

| Error `code` / `status`                                      | What it means                                                                                                                                 | What to do                                                                                                                                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MIGRATION_EXECUTION_FAILED` / `failed`                      | The batch failed and **rolled back**, proven: the attempt is recorded as `failed`, which also blocks a late copy of the batch from committing | Fix the cause (data, missing table). Rerun with `retryFailed: '<id>'` (same definition) or `replaceFailed: '<id>'` (corrected definition)                                      |
| `MIGRATION_RETRY_REQUIRED` / `failed`                        | A failed attempt is recorded; it is never retried automatically                                                                               | As above                                                                                                                                                                       |
| `reconciled` result (not an error)                           | The batch's response was lost or another runner won, and the ledger proves it **applied**                                                     | Nothing                                                                                                                                                                        |
| `MIGRATION_OUTCOME_UNKNOWN` / `unknown`                      | The database could not be reached to prove the outcome. Nothing was retried                                                                   | When reachable, inspect `readMigrationHistory()`, then run again. It skips an applied migration and runs one that never committed; a batch still in flight cannot commit twice |
| `MIGRATION_POSTFLIGHT_FAILED` / `applied`                    | The migrations **committed** (not rolled back), but the schema still does not match                                                           | Read `err.plan`. Forward-fix with a new migration (e.g. a `resetBaseline`-only one), or restore a backup                                                                       |
| `MIGRATION_REVIEW_REQUIRED`                                  | A pending migration is destructive; nothing ran                                                                                               | Back up, review, pass `allowDestructive: true`                                                                                                                                 |
| `MIGRATION_CHECKSUM_MISMATCH` / `MIGRATION_HISTORY_MISMATCH` | Your array does not extend the recorded history; nothing ran                                                                                  | Restore the migration as it ran; put new work in a new migration                                                                                                               |

A recorded failed migration keeps its checksum. A corrected version runs only with `replaceFailed`.
That is safe because a recorded failure is proven never to have committed.

### A migration committed but was wrong

There are **no down migrations**. Some transformations cannot be reversed. Two options:

- write a **forward-fix** migration, or
- **restore a backup** ([BACKUP-RESTORE.md](BACKUP-RESTORE.md)); writes made after the backup are
  lost.

Deploying the previous application code does **not** roll the database back; it only runs old code
against new data.

## Internal tables

ForgeCMS plans its own tables with the same rules: `_versions_<collection>`, `_global_<slug>`,
`_forge_storage_intents`, `_forge_bootstrap`, `_forge_api_keys` and `_forge_schema`. The auth
adapter's tables are included in `runtime.planSchema()`, so drift there also blocks the whole sync.
Duplicate version identities keep their dedicated report (spec 062). Auth columns (`passwordHash`,
`_sessionVersion`) are part of your users collection (`withAuthFields`). A users table from before
`_sessionVersion` existed gains it automatically as an optional column.

`_forge_migrations` is owned by the migration runner, not by `runtime.syncSchema()`. The runner
creates and plans it on every run, and refuses to trust it if its own schema drifted. Migration SQL
may not reference it or `_forge_schema`.

## Limits of this version

- `syncSchema()` never drops, renames, retypes, rebuilds, converts or backfills. Reviewed migrations
  do, when you write them.
- No down/rollback migrations, no CLI, no migration file discovery: the array in your code is the
  history.
- Migrations run on the runtime's `database` adapter. An auth adapter on a separate database is not
  migrated.
- libSQL and D1 only. `InMemoryDatabaseAdapter` and custom adapters without `runMigrations()` report
  `MIGRATION_UNSUPPORTED`.
- Evidence is on-disk libSQL and local D1 (workerd), including upgrades of databases written by
  `0.4.0`, `0.6.0` and `0.8.0` (`pnpm test:upgrade`). Remote D1 and Turso behave per their documented
  batch semantics but are not exercised by the test suite.
- At most 40 statements per migration, 100 args per statement. The runner adds up to 7 statements
  of its own to each batch.
- On D1, `runMigrations()` runs inside one Worker invocation. It plans the schema before and after
  (several reads per table) and sends one batch per migration. On the Workers free plan (50 queries
  per invocation) run few migrations per invocation. If a limit is hit mid-run, the error is typed
  (`MIGRATION_OUTCOME_UNKNOWN` or `MIGRATION_POSTFLIGHT_FAILED`) and a rerun continues safely.
- Each statement is exactly one SQL statement, so `CREATE TRIGGER … BEGIN …; END` cannot be
  expressed yet.
- Tables of collections you removed from the config are not reported.
- Validation-only options (select `options`, `minLength`, access rules, hooks, labels) are not
  tracked. Existing values are not re-validated when they change.
- `InMemoryDatabaseAdapter` persists nothing; its plan is always empty.
- A custom `DatabaseAdapter` without `planSchema()` keeps its own `syncSchema()` behaviour, and
  `runtime.planSchema()` refuses it rather than calling it compatible.
- Behaviour does not depend on `NODE_ENV`, and there is no `force` option.
