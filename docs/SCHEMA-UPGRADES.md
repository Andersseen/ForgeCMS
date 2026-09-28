# Schema upgrades — what `syncSchema()` does and does not do

This guide is for anyone who changes a ForgeCMS collection or global definition after data already
exists: on a local libSQL file, a Turso database or Cloudflare D1. It describes behaviour since
[spec 070](specs/070-schema-drift-detection-and-upgrade-planning.md) (roadmap 0.7, M01).

ForgeCMS has **no migration runner yet** (that is M02). What it does have is a reliable plan: before
it touches anything, it compares the schema you declared with the schema actually stored. It applies
only changes that cannot lose or reinterpret data, and it refuses everything else with a precise
report.

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

**After migrating a semantic change by hand** (for example, wrapping every `title` into `{"en": …}`),
tell Forge the data now matches by resetting that table's baseline. The next sync records the new one:

```sql
DELETE FROM "_forge_schema" WHERE "id" = 'posts';
```

This is a deliberate operator action. Physical checks still run after the reset.

## Internal tables

ForgeCMS plans its own tables with the same rules: `_versions_<collection>`, `_global_<slug>`,
`_forge_storage_intents`, `_forge_bootstrap`, `_forge_api_keys` and `_forge_schema`. The auth
adapter's tables are included in `runtime.planSchema()`, so drift there also blocks the whole sync.
Duplicate version identities keep their dedicated report (spec 062). Auth columns (`passwordHash`,
`_sessionVersion`) are part of your users collection (`withAuthFields`). A users table from before
`_sessionVersion` existed gains it automatically as an optional column.

## Limits of this version

- No automatic `DROP`, rename, retype, rebuild, conversion or backfill. Those are M02's reviewed
  migrations.
- Tables of collections you removed from the config are not reported.
- Validation-only options (select `options`, `minLength`, access rules, hooks, labels) are not
  tracked. Existing values are not re-validated when they change.
- `InMemoryDatabaseAdapter` persists nothing; its plan is always empty.
- A custom `DatabaseAdapter` without `planSchema()` keeps its own `syncSchema()` behaviour, and
  `runtime.planSchema()` refuses it rather than calling it compatible.
- Behaviour does not depend on `NODE_ENV`, and there is no `force` option.
