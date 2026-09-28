# 070 — Detect schema drift and plan safe upgrades

- **Status:** done <!-- roadmap 0.7 M01, requested by the maintainer after spec 069 -->
- **Author:** agent draft
- **Date:** 2026-09-28
- **Branch:** `feature/spec-070-schema-drift-detection`
- **Affected packages/apps:** @forge-cms/db, @forge-cms/cloudflare, @forge-cms/auth,
  @forge-cms/runtime, @forge-cms/testing, docs

## Context / Why

`syncSchema()` has been optimistic since spec 014: `CREATE TABLE IF NOT EXISTS`, `PRAGMA table_info`,
`ALTER TABLE … ADD COLUMN` for missing **declared fields**, and `CREATE [UNIQUE] INDEX IF NOT EXISTS`.
It reports success whatever the stored schema looks like. Roadmap 0.7 M01 (finding F12) makes drift
visible and actionable before migrations (M02) and backups (M03) exist.

**Reproduced first.** A throwaway probe on the unfixed code synced v1 on an on-disk libSQL file,
seeded a row, then synced v2 through a **new adapter instance** (a restart):

|     | v1 → v2                                            | Pre-M01 `syncSchema()`                            | Stored afterwards                                                                  |
| --- | -------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| A   | `legacy` field removed                             | resolved                                          | `legacy TEXT` still there, value kept (D1 `SELECT *` still returns it)             |
| B   | `views: text` → `number`                           | resolved                                          | `views TEXT` (desired `REAL`)                                                      |
| C   | `drafts: false` → `true`                           | resolved                                          | **no `_status`**: `generateAddColumnSql` only walks `fields`                       |
| D   | `upload: false` → `true`                           | resolved                                          | **no `_storageKey`**, same cause                                                   |
| E   | `slug` `index: true` → `unique: true`              | resolved                                          | `idx_e_posts_slug` **non-unique** (`IF NOT EXISTS` matched the old name)           |
| F   | `slug` `unique: true` → `index: true`              | resolved                                          | `idx_f_posts_slug` still **unique**                                                |
| G   | `index: true` removed                              | resolved                                          | `idx_g_posts_title` still there                                                    |
| H   | unique `(a, b)` → unique `(a, c)`                  | resolved                                          | **both** unique indexes enforced                                                   |
| I   | `unique: true` added over two `slug = 'same'` rows | `Failed query: CREATE UNIQUE INDEX IF NOT EXISTS` | no index; a raw driver error                                                       |
| J   | `title` → `title` localized                        | resolved                                          | `title TEXT` holding `"a"`; the runtime now expects a `{ locale: value }` JSON map |
| K   | relation single → `many: true`                     | resolved                                          | `tag TEXT` holding `tag-1`; the runtime now expects a JSON array                   |
| L   | new `summary: text({ required: true })`, one row   | resolved                                          | `summary` NULL on the existing row                                                 |

J and K are TEXT → TEXT, so no SQLite metadata can see them. In L, the existing row now fails
validation whenever a full-document edit touches `summary`. Defaults (`applyFieldDefaults`) apply
**on create only**, so they never backfill anything. `statusConstraint` gives anonymous callers
`_status = 'published'`, so after C every pre-existing row (`_status` NULL) would silently vanish from
public reads once the column exists.

## Goal

Given the desired Forge schema and a persisted SQLite/libSQL/D1 schema, Forge produces one
deterministic, structured plan. `syncSchema()` applies it only when every change is safe additive, and
otherwise refuses with a typed error **before any DDL**.

## Non-goals

- M02: migration files, ids, checksums, an applied-migrations ledger, a runner, locks, rollback, a CLI.
- M03: backup/restore, R2 backup, historical-version fixtures.
- Any automatic `DROP COLUMN`, `DROP INDEX`, rename, retype, table rebuild, value conversion or backfill.
- Rename inference of any kind.
- Detecting tables of collections removed from the config (recorded as a limitation).
- A schema snapshot that tracks validation/UI options (select `options`, min/max, access, hooks, labels).
- Changing drafts, upload, localization, versions, globals or storage-intent semantics.
- `NODE_ENV`-dependent behaviour, or a `force` option.

## Design

### 1. Models (one source of truth)

**Desired** (`desiredTableSchema(collection)`, exported from `@forge-cms/db` for SQLite adapters): ordered columns `id`
(TEXT, primary key), `created_at`, `updated_at`, `_status` (drafts), `_storageKey` (upload), then
declared fields via `fieldKindToSqlType`. Indexes come from `resolveCollectionIndexes`.
`generateCreateTableSql`, `generateIndexSql` and `getOrCreateDrizzleTable` are rebuilt on it, with
byte-identical output.

**Stored** (read by shared code in `@forge-cms/db` through a two-method executor that libSQL and D1
each implement): `SELECT … FROM pragma_table_info(?)`, `pragma_index_list(?)` and
`pragma_index_info(?)`, with the table/index name **bound** rather than interpolated. The result is
normalized into:

```ts
{ name, columns: { name, type, primaryKey }[], indexes: { name, columns: (string | null)[], unique, origin: 'c' | 'u' | 'pk', partial }[] }
```

Columns are in `cid` order, indexes sorted by name, index columns in `seqno` order. Types compare by
**SQLite affinity** (the five documented rules: INT → INTEGER; CHAR/CLOB/TEXT → TEXT; BLOB or none →
BLOB; REAL/FLOA/DOUB → REAL; else NUMERIC), so `VARCHAR(20)` vs `TEXT` is not drift. A stored
NUMERIC column (e.g. a hand-declared `BOOLEAN`) is accepted for INTEGER and REAL fields. Origin `pk`
indexes (SQLite's autoindex for `id`) are never treated as Forge indexes.

**Baseline (`_forge_schema`).** Result B of the roadmap question: physical metadata cannot see J, K,
or kind changes within TEXT, and data probes would be guesses. So Forge records, per table it syncs,
the **semantic** facts of the definition it last applied:

```ts
{ format: 1, fields: { [name]: { kind, localized, many, target, required, default } } }
```

- `target` is the relation/upload `collection`.
- `default` is the static default as JSON, `"dynamic"` for a non-JSON default (a `Date`, a
  function), or `null` when there is none.

One row per table (`id` = table name, `snapshot` = that JSON). The table is an ordinary
Forge-shaped table defined in `@forge-cms/db`, created and never snapshotted itself. It has no
migration ids, checksums, history or status, so it is not M02's ledger. It is written in the same
batch as the safe DDL, and **only when the plan does not block**.

### 2. Classification

```ts
export type SchemaChangeClassification =
  | 'safe-additive' // syncSchema applies it
  | 'manual-migration' // Forge understands it and will not transform data — blocks
  | 'unsupported' // Forge cannot tell what a safe transformation is — blocks
  | 'informational'; // recorded, nothing to do, does not block
```

| Change                                                                               | Classification                                                                    |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| new table (with its columns and indexes)                                             | safe-additive                                                                     |
| new optional field (with or without a default)                                       | safe-additive; the reason says existing rows stay NULL (defaults are create-only) |
| new **required** field, table has rows                                               | manual-migration (backfill), `affectedRows`                                       |
| new required field, empty table                                                      | safe-additive                                                                     |
| existing field newly required (baseline), rows with NULL                             | manual-migration, `affectedRows`; otherwise informational                         |
| stored column not declared (removed field or rename source)                          | manual-migration: never dropped                                                   |
| rename (one removed + one added)                                                     | reported as those two changes, never paired                                       |
| affinity change (e.g. TEXT → REAL)                                                   | manual-migration                                                                  |
| kind change, same affinity: text ⇄ textarea; email/slug/select → text/textarea       | informational (same representation, no new constraint)                            |
| any other kind change                                                                | manual-migration                                                                  |
| `localized` toggled                                                                  | manual-migration                                                                  |
| relation `many` toggled; relation/upload `collection` changed                        | manual-migration                                                                  |
| default added/changed/removed                                                        | informational ("future creates only; existing rows are not rewritten")            |
| drafts enabled (`_status` missing), empty table                                      | safe-additive                                                                     |
| drafts enabled, rows exist                                                           | manual-migration: the rows would disappear from public reads until backfilled     |
| upload enabled (`_storageKey` missing), empty table                                  | safe-additive                                                                     |
| upload enabled, rows exist                                                           | manual-migration: the rows are not file records                                   |
| drafts / upload disabled (stale `_status` / `_storageKey`)                           | manual-migration (the reason counts draft rows that would become public)          |
| `id` not a TEXT sole primary key; `created_at`/`updated_at` missing or wrongly typed | unsupported                                                                       |
| new non-unique index                                                                 | safe-additive                                                                     |
| new unique index, no duplicates                                                      | safe-additive (see §3)                                                            |
| new unique index over duplicates                                                     | manual-migration, `duplicateGroups`/`affectedRows`                                |
| same-named index with other columns or uniqueness (either direction)                 | manual-migration                                                                  |
| undeclared unique index                                                              | manual-migration (still enforces a rule Forge no longer declares)                 |
| undeclared column-level `UNIQUE` constraint (origin `u`)                             | unsupported (removal needs a table rebuild)                                       |
| undeclared non-unique index                                                          | informational (no behaviour change)                                               |
| desired index name already used by another table (names are database-wide)           | unsupported (IF NOT EXISTS would silently skip it)                                |
| table exists, no baseline yet (first M01 sync)                                       | informational `baseline-recorded`                                                 |

Physical checks always run. Semantic checks (kind within one affinity, localized, many, target,
newly-required on an existing column, default) need a baseline. On the first M01 sync of an existing
table there is none: the current definition is recorded, and the plan says what could not be
compared. **Forge does not reconstruct history it never stored.**

### 3. Why a data-compatible new unique index is safe-additive

The declaration is the operator's intent, and the preflight proves it applies to today's data.
It is a new name, so nothing is replaced. The index goes into the same batch as the rest of the safe
DDL: if a concurrent writer inserts a duplicate in between, the batch fails and nothing commits.
Strengthening an **existing** same-named index is different. SQLite cannot make an index unique in
place, so it needs a drop + create, which is manual.

Duplicate preflight (never loads rows into JS, never returns values):
`SELECT COUNT(*), COALESCE(SUM(n), 0) FROM (SELECT COUNT(*) n FROM t WHERE a IS NOT NULL AND … GROUP BY a, … HAVING COUNT(*) > 1)`.
Rows with a NULL in any indexed column are excluded, matching SQLite's unique semantics.

### 4. Public API

`@forge-cms/db`:

```ts
export type SchemaChangeKind =
  | 'table-added'
  | 'table-structure'
  | 'column-added'
  | 'column-removed'
  | 'column-type-changed'
  | 'system-column-added'
  | 'system-column-removed'
  | 'field-kind-changed'
  | 'field-localized-changed'
  | 'field-cardinality-changed'
  | 'field-target-changed'
  | 'field-required-added'
  | 'field-default-changed'
  | 'index-added'
  | 'index-removed'
  | 'index-changed'
  | 'baseline-recorded'
  | 'baseline-unreadable';

export interface SchemaChange {
  table: string;
  kind: SchemaChangeKind;
  target: { type: 'table' | 'column' | 'system-column' | 'index'; name: string };
  classification: SchemaChangeClassification;
  reason: string;
  stored?: string; // e.g. 'TEXT', 'non-unique (slug)'
  desired?: string;
  affectedRows?: number;
  duplicateGroups?: number;
}
export interface SchemaPlan {
  changes: readonly SchemaChange[];
  blocking: boolean;
}

export class SchemaDriftError extends Error {
  readonly code = 'SCHEMA_DRIFT';
  readonly plan: SchemaPlan;
}
export function isSchemaDriftError(err: unknown): err is SchemaDriftError;
export function formatSchemaPlan(plan: SchemaPlan): string;
export function mergeSchemaPlans(plans: readonly SchemaPlan[]): SchemaPlan;
export const SCHEMA_BASELINE_TABLE = '_forge_schema';
export function desiredTableSchema(collection): DesiredTable; // + DesiredTable, DesiredColumn, SqlColumnType

// For SQLite-backed adapters (libSQL here, D1 in @forge-cms/cloudflare):
export interface SqliteSchemaExecutor {
  query(sql: string, args?: unknown[]): Promise<Record<string, unknown>[]>;
  /** All statements in one transaction. */
  batch(statements: { sql: string; args?: unknown[] }[]): Promise<void>;
}
export function planSqliteSchema(executor, collections): Promise<SchemaPlan>;
export function syncSqliteSchema(executor, collections): Promise<SchemaPlan>; // throws SchemaDriftError

interface DatabaseAdapter {
  // …unchanged…
  /** Optional (third-party adapters keep compiling). Plans; never mutates. */
  planSchema?(collections: CollectionDefinition[]): Promise<SchemaPlan>;
}
```

`generateAddColumnSql` stays exported, unchanged and `@deprecated` (adapters no longer use it).

`@forge-cms/auth`: `AuthAdapter.planSchema?(): Promise<SchemaPlan>` plans the adapter's own internal
tables on its own database. It is implemented by `UsersCollectionAuthAdapter` (`_forge_bootstrap`),
`ApiKeyAuthAdapter` (`_forge_api_keys`) and `CompositeAuthAdapter` (merge). Dependency direction is
unchanged: auth → db.

`@forge-cms/runtime`: `ForgeCmsRuntime.planSchema(): Promise<SchemaPlan>`. It plans every table the
runtime owns: collections (auth fields included), `_forge_storage_intents` when uploads exist,
`_global_<slug>` and `_versions_<slug>`. It merges `auth.planSchema?.()` into the result. An adapter
without `planSchema` makes it **throw**, never report "compatible".

`@forge-cms/testing/contracts`: `runSchemaDriftContractTests(harness)`, one scenario body run on
on-disk libSQL and on local D1.

### 5. `syncSchema()` behaviour

- **Adapter** (`LibSqlDatabaseAdapter`, `D1DatabaseAdapter`): register the collections (as before),
  inspect → plan. If blocking, throw `SchemaDriftError` with **no statement executed**. Otherwise
  send every safe DDL statement plus the baseline upserts as **one** transactional batch; nothing to
  do means no batch. If the batch fails (e.g. a concurrent process already added the column; nothing
  of it committed), re-plan once and apply whatever safe work remains in a second transaction. A
  second failure rethrows. A re-plan that now blocks throws `SchemaDriftError` with the first
  failure as `cause`.
- **Runtime:** when the database implements `planSchema`, `runtime.syncSchema()` first runs
  `runtime.planSchema()` across every table (and the auth adapter's), and throws `SchemaDriftError`
  before **any** adapter sync. Then it runs the existing per-area syncs (each re-plans). An adapter
  without `planSchema` keeps its own `syncSchema` behaviour; this is documented, and
  `runtime.planSchema()` refuses.
- **`_versions_*`:** a duplicate-identity conflict on `(documentId, versionNumber)` keeps spec 062's
  domain message (examples, "will not delete, renumber or merge", the inspection query). It is thrown
  as a `SchemaDriftError` carrying the plan.
- **InMemory:** `planSchema` returns an empty, non-blocking plan. Nothing is persisted, so nothing can
  drift, and it proves nothing about SQL backends.
- Fresh databases and safe additive changes still need exactly `await runtime.syncSchema()`.

### 6. Output

`formatSchemaPlan` groups deterministically into blocking, then safe additive ("not applied while
anything blocks"), then informational. Each line is `table.target  kind  [classification]`, followed by
`stored → desired` and the reason. The output contains no row values. `SchemaDriftError.message` is a
one-line summary followed by the formatted plan. Changes are sorted by `(table, kind order, target
name)`, and `mergeSchemaPlans` de-duplicates identical entries (the shared `_forge_schema` creation).

### 7. Internal tables

| Table                    | Defined by                          | Synced through                                       | Planned by                              |
| ------------------------ | ----------------------------------- | ---------------------------------------------------- | --------------------------------------- |
| consumer collections     | config (`withAuthFields` for users) | runtime → `database.syncSchema`                      | runtime                                 |
| `_global_<slug>`         | runtime (`fields`, `drafts`)        | runtime                                              | runtime                                 |
| `_versions_<slug>`       | `versionCollectionDefinition`       | runtime (+ 062 duplicate diagnostic)                 | runtime                                 |
| `_forge_storage_intents` | `storageIntentsDefinition`          | runtime (only when uploads exist)                    | runtime                                 |
| `_forge_bootstrap`       | `@forge-cms/auth`                   | `UsersCollectionAuthAdapter.syncSchema` (and lazily) | `auth.planSchema`                       |
| `_forge_api_keys`        | `@forge-cms/auth`                   | `ApiKeyAuthAdapter.syncSchema`                       | `auth.planSchema`                       |
| `_forge_schema`          | `@forge-cms/db`                     | every SQLite sync that has something to record       | always included, not itself snapshotted |

All of them are ordinary `CollectionDefinition`s, so there is **one** planner and no second
internal-table framework.

## Implementation plan

- [x] Probe and pin pre-M01 behaviour (table above)
- [x] `schema-plan.ts`: types, desired model, baseline, pure planner, formatter, error, merge
- [x] `sqlite-schema.ts`: introspection, probes, plan/sync over `SqliteSchemaExecutor`
- [x] generator rebuilt on the desired model; libSQL + D1 + InMemory wired
- [x] auth `planSchema` (users-collection, api-key, composite)
- [x] runtime `planSchema`, plan-first `syncSchema`, 062 diagnostic preserved
- [x] tests: pure planner, contract suite on libSQL + D1, runtime (partial-DDL, internal tables)
- [x] docs (consumer upgrade guide, ARCHITECTURE, package READMEs), api-baseline, changeset, STATE

## Test plan

- `packages/db/src/schema-plan.test.ts`: the matrix on fake stored schemas, determinism, formatter,
  affinity normalization, rename non-inference.
- `packages/testing/src/contracts/schema-drift.ts`, run by `packages/db/src/schema-drift.libsql.test.ts`
  (on-disk file, reopened adapters) and `packages/cloudflare/test/workers/schema-drift.test.ts` (local
  D1). It covers A–L, stale unique, strengthening, duplicates (with NULL parity), drafts/upload, JSON,
  localized and relation data unchanged after refusal, repeated plans deep-equal, and no DDL in one
  call with a safe and a blocking table.
- `packages/runtime/src/schema-drift.test.ts`: a safe change on collection A plus a blocking change on
  collection B leaves A's column absent; globals, versions, storage intents, `_forge_bootstrap` and
  `_forge_api_keys` drift; the adapter without `planSchema`.
- Existing 062 upgrade tests (libSQL + D1) keep passing unchanged.
- Gates: format, lint, typecheck, test, build, `test:libsql`, `test:cloudflare`, `check:api`,
  `release:verify`, `e2e:www`, `e2e:tiny-project`, `e2e:demo`.

## Acceptance criteria

1. Pre-M01 A–L are refused or classified as in §2 on on-disk libSQL **and** local D1 (same contract).
2. A refused sync executes no DDL (the partial-DDL regression) and leaves row values byte-identical.
3. Planning twice against unchanged state yields deep-equal plans.
4. A new optional field, index or table still needs only `syncSchema()`; fresh databases unchanged.
5. `runtime.planSchema()` covers collections, globals, versions, storage intents, bootstrap and API
   keys; it throws on an adapter without `planSchema`.
6. Spec 062's duplicate-version message is intact.
7. No migration runner, ledger or CLI; no destructive DDL anywhere.
8. All gates in the test plan green, or reported accurately.

## Open questions

None. Two decisions (safe-additive new unique index, baseline table) are argued in §1 and §3.

## Outcome

Shipped as designed, 2026-09-28. Differences from the first draft, found by review:

- **Index names are database-wide.** A generated `idx_<table>_<fields>` already owned by another
  table, or wanted by two tables of one plan, is `unsupported`. `CREATE INDEX IF NOT EXISTS` would
  have skipped it silently. The probe is `sqlite_master` with a bound name.
- An unreadable or newer baseline is its own kind, `baseline-unreadable` (`unsupported`).
- Non-JSON defaults are fingerprinted `"dynamic"`, so a `new Date()` default is not "changed" on
  every start.
- The 062 duplicate scan registers an identity-only `_versions_*` definition through a sync that
  blocks by construction (the stored table's other columns read as removed). It never re-syncs
  afterwards, because a re-sync could apply DDL if another process fixed the data meanwhile. A
  refused sync leaves adapter registration unfit for use until a sync succeeds, as any refused
  sync does.
- The exported surface is a little wider than §4 first listed: `desiredTableSchema` and its types,
  plus `SCHEMA_BASELINE_TABLE`.

Evidence:

- `runSchemaDriftContractTests` (27 scenarios) on on-disk libSQL and local D1;
- `schema-plan.test.ts`;
- `runtime/src/schema-drift.test.ts`;
- existing 062 upgrade tests unchanged;
- E2E: www 19, tiny-project 13, demo 10.

**Not verified:** remote D1 (the `pragma_*()` table-valued functions and `sqlite_master` reads are
proven on local workerd only) and Turso. Existing production databases may now refuse to start if
their schema drifted. Run `runtime.planSchema()` against them before deploying.
