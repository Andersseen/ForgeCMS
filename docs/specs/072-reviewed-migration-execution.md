# 072 — Execute reviewed migrations with a durable ledger

- **Status:** done <!-- roadmap 0.7 M02, requested by the maintainer after spec 071 -->
- **Author:** agent draft
- **Date:** 2026-09-29
- **Branch:** `feature/spec-072-reviewed-migrations`
- **Affected packages/apps:** @forge-cms/db, @forge-cms/cloudflare, @forge-cms/runtime,
  @forge-cms/testing, root release scripts + CI, docs

## Context / Why

M01 (spec 070) made drift visible: `syncSchema()` applies only safe additive changes and throws
`SchemaDriftError` for everything else. It left the operator with no supported way forward.

**Reproduced first** (throwaway probe, on-disk libSQL, 2026-09-29). v1 `posts { headline: text() }`,
one row `headline = "Hello"`; v2 `posts { title: text() }`:

```text
Schema plan: 1 blocking, 1 safe additive, 0 informational.
  posts.headline  column-removed  [manual-migration]
  posts.title     column-added    [safe-additive]
syncSchema -> SchemaDriftError SCHEMA_DRIFT
tables: _forge_schema, posts          # no migration history of any kind
runtime.runMigrations: undefined
```

The only path is hand-run SQL against production, sometimes plus a hand `DELETE FROM "_forge_schema"`,
then a retry. Nothing records what ran. Nothing detects a duplicate, an edited script or a second
deploy process running the same SQL, and a half-failed attempt leaves no trace.

This task also closes two release-hygiene problems found by spec 071.

### A. Release numbering: the brief's premise changed before this work started

The brief expected PR #54 (Version Packages, M01 as `minor` → `0.8.0`) to be still open, and asked for
the M01 changeset to be downgraded to `patch`. On 2026-09-29 the facts were:

- PR #54 was **merged** at 19:03 UTC on 2026-09-28. npm has `@forge-cms/*@0.8.0` (M01 + spec 071's
  admin fixes), tagged `v0.8.0` at `47dfae2`. `.changeset/schema-drift-detection.md` no longer exists.
- npm never lets a version number be reused, so `0.8.0` cannot be kept for Angular DX any more.

**Maintainer decision (2026-09-29):**

| npm line | Content                                                                         |
| -------- | ------------------------------------------------------------------------------- |
| `0.8.x`  | roadmap 0.7 upgrade safety: M01 shipped as `0.8.0`; M02 and M03 ship as patches |
| `0.9.0`  | roadmap milestone "0.8 — Angular client/DX" (its first npm minor)               |

Roadmap milestone labels stay as they are. ROADMAP already says they are product checkpoints, not npm
versions. From 0.8 on, npm minors are **one ahead** of the roadmap label. M02's changeset is `patch`.

### B. Aggregate GitHub release tags point at the wrong commit

| Tag      | Tag commit                 | npm source actually published        |
| -------- | -------------------------- | ------------------------------------ |
| `v0.6.0` | `42fc1d9` (spec 069 merge) | `d2ff7dd` (PR #43, Version Packages) |
| `v0.7.0` | `2ec5208` (spec 070 merge) | `7248ec8` (PR #52, Version Packages) |
| `v0.8.0` | `47dfae2` (PR #54)         | `47dfae2`, correct                   |

The root cause is proven from the log of CI run `7248ec8`, job "Release packages to npm":

1. `changeset publish` published all ten `0.7.0` packages at 14:14:54.
2. `publish-unpublished.mjs` then ran `npm view @forge-cms/admin@0.7.0`. The registry had not caught
   up and answered 404, so the script published again: `E409 Cannot publish over previously staged
version "0.7.0"`. The step failed.
3. So `release:github` never ran on the publishing commit.
4. The next `main` push (`2ec5208`, spec 070) ran `create-github-release.mjs`. That script tags
   `GITHUB_SHA` with whatever version `package.json` holds, so it created `v0.7.0` there.

PR #43's run failed the same way, which explains `v0.6.0`.

## Goal

A deployment script can run an ordered list of reviewed, declarative SQL migrations against libSQL or
D1. Each migration commits exactly once, atomically with its ledger entry, or not at all. Every failure
is classified truthfully, and M01's plan verifies the result.

## Non-goals

- M03: backup/restore, historical-version upgrade fixtures, R2 in the backup scope.
- Down/rollback/reverse migrations.
- JavaScript callbacks, interactive transactions, a generic migration framework, a CLI package, migration
  file discovery or code generation.
- Running migrations from `runtime.init()` or `runtime.syncSchema()`, or on application startup at all.
  `syncSchema()` stays safe-additive only.
- InMemory migration support: it persists nothing, so it reports "unsupported".
- Migrating the deployed demo's `site_settings`, or touching any remote D1/Turso database.
- Finding 24 (SQL adapters return dates as strings): roadmap 0.8 C02.
- Retagging `v0.6.0`/`v0.7.0`: history is documented, not rewritten.
- Strata changes.

## Design

### 1. Migration definition (`@forge-cms/db`)

```ts
export type MigrationValue = string | number | boolean | null;

export interface MigrationStatement {
  /** Exactly one SQL statement. Positional `?` placeholders only. */
  readonly sql: string;
  readonly args?: readonly MigrationValue[];
}

export interface MigrationDefinition {
  /** Stable identity, e.g. '20260929_001_posts_headline_to_title'. /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/ */
  readonly id: string;
  /** For humans and reports. Not part of the checksum (§2). */
  readonly description: string;
  /** Required and explicit. `true` needs `allowDestructive` at run time (§6). */
  readonly destructive: boolean;
  /** 0–40 statements (0 only with `resetBaseline`), executed in this order, in one transaction. */
  readonly statements: readonly MigrationStatement[];
  /**
   * Tables whose M01 semantic baseline this migration makes obsolete (e.g. it wrapped `title` values
   * into `{"en": …}`). Their `_forge_schema` rows are deleted **in the same transaction**; the post-flight
   * `syncSchema()` records fresh ones. Replaces spec 070's manual `DELETE FROM "_forge_schema"`.
   */
  readonly resetBaseline?: readonly string[];
}

export function defineMigration(definition: MigrationDefinition): MigrationDefinition; // validates, freezes
```

Validation runs before any database access, in `defineMigration` and again in the runner (plain
objects are accepted too). Any violation throws `MigrationError` with code `MIGRATION_INVALID`:

- the id format; ids unique within the list; description non-empty; `destructive` a boolean;
- 0–40 statements. D1's free plan allows 50 queries per invocation, and the runner adds up to 7 (replace mode). Zero
  statements are allowed only with a non-empty `resetBaseline`. That is a **baseline-only migration**,
  which records that data was already converted and replaces spec 070's manual `DELETE FROM
"_forge_schema"`.
- Each `sql` is one statement. A small scanner skips string literals, quoted identifiers and comments,
  and rejects anything but whitespace or comments after a `;`.
- Only positional `?` placeholders are allowed (no `?NNN`, `:name`, `@name` or `$name`), and their count
  must equal `args.length`, at most 100 (D1's bound-parameter limit).
- Args must be strings, finite numbers, booleans or `null`.
- The leading keyword must not be `BEGIN`, `COMMIT`, `END`, `ROLLBACK`, `SAVEPOINT`, `RELEASE`,
  `VACUUM`, `ATTACH` or `DETACH`. These would break the batch's atomicity.
- The SQL must not mention `_forge_migrations` or `_forge_schema`, case-insensitively. The ledger and
  baseline belong to the runner.
- `destructive: false` is refused when a statement obviously destroys something: it begins with `DROP`
  or `DELETE`, or is an `ALTER TABLE … DROP`/`RENAME`. The flag is the author's declaration, and this
  check only catches contradictions. An `UPDATE` backfill may be non-destructive.
- `resetBaseline` entries are unique SQL identifiers, at most 50.

Migration definitions are trusted deployment code. Nothing derived from a request may build one.

### 2. Checksum

`migrationChecksum(definition): Promise<string>` is the lowercase hex SHA-256 (`crypto.subtle`, the same
in Node 22 and workerd) of the UTF-8 bytes of:

```ts
JSON.stringify([
  'forge-migration',
  1, // canonical format version
  id,
  destructive,
  [...(resetBaseline ?? [])].sort(),
  statements.map((s) => [s.sql, (s.args ?? []).map(tag)])
]);
// tag: null → ['null'], string → ['s', v], number → ['n', v], boolean → ['b', v]
```

- **Included:** id, the destructive flag (flipping it would bypass the review gate on a retry), the
  baseline resets, and the SQL text **byte for byte** (no whitespace normalization) with typed args. The
  tags keep `'1'`, `1` and `true` distinct.
- **Excluded:** description (it changes nothing in the database, and fixing a typo must not look like
  tampering), timestamps, file paths, host names and randomness.
- A golden test pins the checksum of one fixed definition.

### 3. Ledger `_forge_migrations`

An ordinary Forge-shaped table, defined as a `CollectionDefinition` in `@forge-cms/db`. It is created
and checked by the **same M01 planner**, so there is no second schema path:

| Column                     | Type               | Meaning                                                         |
| -------------------------- | ------------------ | --------------------------------------------------------------- |
| `id`                       | TEXT PK            | migration id (unique)                                           |
| `created_at`, `updated_at` | TEXT               | Forge system columns (runner clock)                             |
| `position`                 | REAL, unique index | 1 + index in the migrations array                               |
| `checksum`                 | TEXT, required     | §2                                                              |
| `status`                   | TEXT, required     | `applied` or `failed` (see below)                               |
| `started_at`               | TEXT, required     | runner clock when the (last) attempt started                    |
| `finished_at`              | TEXT               | database clock (`strftime`) at commit; NULL for `failed`        |
| `attempts`                 | REAL, required     | never decreases at a position (see §5, "no ABA")                |
| `failure_code`             | TEXT               | error class/code of the last failure (e.g. `SQLITE_CONSTRAINT`) |

- No SQL text, no bound args and no error messages are stored.
- **No durable `running` state.** The claim is written as `running` and flipped to `applied` inside the
  same transaction, so `running` is never committed. A `running` row read back means corruption, and it
  is reported as `MIGRATION_HISTORY_MISMATCH`.
- **Bootstrap:** the runner first runs `syncSqliteSchema(executor, [ledgerDefinition])`. It plans only
  the ledger and `_forge_schema`, so it works while application tables are blocked. If the ledger itself
  has drifted, it refuses (`MIGRATION_HISTORY_MISMATCH`, with the drift error as `cause`).
- The ledger is not part of `runtime.planSchema()`: a runtime never syncs it. The migration runner owns
  it. Listed in the internal-table inventory.

### 4. History rules (pure, `planMigrationHistory`)

The migrations array is append-only history. The ledger rows, ordered by `position`, must be
`1..n` without gaps, all `applied` except possibly the **last** one, which may be `failed`. For each row
at position p:

- `migrations[p-1]` missing → `MIGRATION_HISTORY_MISMATCH` (removed or truncated).
- a different id → `MIGRATION_HISTORY_MISMATCH` (reordered if the row's id is elsewhere in the list,
  divergent otherwise).
- same id, other checksum → `MIGRATION_CHECKSUM_MISMATCH`, never re-run and never overwritten. The one
  exception is a `failed` row the operator named in `replaceFailed` (§5).

Everything is checked before any statement executes. The result is one `MigrationState` per definition:
`applied` | `failed` | `pending`.

### 5. Runner (`runSqliteMigrations(executor, migrations, options)`)

```ts
export interface RunMigrationsOptions {
  /** Permit migrations declared `destructive: true`. Default false. */
  allowDestructive?: boolean;
  /** Approve re-running the recorded failed migration with this id: same position and checksum. */
  retryFailed?: string;
  /** Approve replacing the recorded failed migration with this id by whatever definition now sits at its position. */
  replaceFailed?: string;
}
```

Order: validate + checksum → bootstrap ledger → read history → `planMigrationHistory` → gates → execute
pending migrations one at a time.

**Gates (preflight, before anything executes):**

- A failed row without a matching approval → `MIGRATION_RETRY_REQUIRED`. Approvals naming no failed row
  are ignored.
- `retryFailed` requires the same id and checksum. An edited migration is a `replaceFailed` decision.
- Any pending (or approved failed) migration with `destructive: true` and no `allowDestructive` →
  `MIGRATION_REVIEW_REQUIRED`. Nothing runs, not even earlier non-destructive migrations.

**One transactional batch per migration** (libSQL `client.batch(…, 'write')`, D1 `batch()`, both via
the existing `SqliteSchemaExecutor.batch`):

```text
1. prefix guard   SELECT abs(CASE WHEN <p-1 applied rows below p, and p-1 (fresh) or p (retry/replace) rows in total> THEN 0 ELSE MIN_INT END)
2. claim          fresh:   INSERT ledger row (id, position p, checksum, status 'running', attempts 1)
                  retry:   UPDATE … SET status 'running', attempts+1 WHERE id, position, checksum, status 'failed', attempts = read value  + changes() guard
                  replace: DELETE the failed row WHERE id, position, checksum, 'failed', attempts = read value + changes() guard; then INSERT with attempts = read value + 1
3. baseline       DELETE FROM "_forge_schema" WHERE "id" IN (resetBaseline…)       (only if declared)
4. migration SQL  statements in order, with their args
5. mark applied   UPDATE … SET status 'applied', finished_at = strftime(…) WHERE id AND status 'running' + changes() guard
```

The guards reuse spec 060's `abs(MIN_INT)` overflow trick. The `id` primary key and the unique
`position` make a second claim of the same id or position fail inside the database. The pre-read is
advisory; correctness comes from the batch.

**After a failed batch: fence, then reconcile.** Error types cannot tell a SQL error from a lost
response, so the runner first writes a **fence**, a single-statement batch that records the attempt as
`failed`:

- fresh: `INSERT` the row with status `failed`;
- retry: the guarded `UPDATE attempts+1, failure_code` on the failed row with the attempts value read;
- replace: the same guarded `DELETE`, plus an `INSERT` of the new row as `failed` with attempts = read + 1.

**No ABA.** Retry and replace batches find the failed row by the `attempts` value they read. Every
write to a position after its first (a retry or replace claim, and every fence) sets `attempts` to the
previous value + 1, and a position's row is never deleted without being re-inserted in the same batch.
So once anything else has written that position, a late copy of an old batch can never match again.
(The first draft inserted `attempts = 1` on replace. Review reproduced a retry batch committing after
being reported failed; see Outcome.)

- replace: guarded `DELETE` of the old failed row + `INSERT` of the new one as `failed`.

The fence conflicts with every committed claim, and every late claim conflicts with the fence. So:

| Fence              | Then                                              | Outcome                                                                                           |
| ------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| committed          | —                                                 | `MIGRATION_EXECUTION_FAILED`, status `failed`: proven not committed, and it never can be (fenced) |
| rejected or errors | reconcile read shows same id + checksum `applied` | `reconciled`: applied (this runner's lost response, or another runner). Continue.                 |
|                    | shows same id + checksum `failed`                 | `MIGRATION_EXECUTION_FAILED` (another runner recorded it)                                         |
|                    | shows another id/checksum at p                    | `MIGRATION_HISTORY_MISMATCH` / `MIGRATION_CHECKSUM_MISMATCH` (a divergent runner won)             |
|                    | shows no row at p, or the read fails              | `MIGRATION_OUTCOME_UNKNOWN`: stop, no retry                                                       |

After `OUTCOME_UNKNOWN`, the next invocation is safe. If the lost batch committed, the ledger says
`applied` and it is skipped. If it never commits, the next claim runs normally. If it is still in
flight, the database decides between it and the next claim, and only one can win.

**Result:**

```ts
export interface MigrationRunResult {
  position: number;
  id: string;
  checksum: string;
  outcome: 'applied' | 'already-applied' | 'reconciled';
}
```

### 6. Errors

One class, precise codes:

```ts
export type MigrationErrorCode =
  | 'MIGRATION_INVALID'
  | 'MIGRATION_UNSUPPORTED'
  | 'MIGRATION_HISTORY_MISMATCH'
  | 'MIGRATION_CHECKSUM_MISMATCH'
  | 'MIGRATION_RETRY_REQUIRED'
  | 'MIGRATION_REVIEW_REQUIRED'
  | 'MIGRATION_EXECUTION_FAILED'
  | 'MIGRATION_OUTCOME_UNKNOWN'
  | 'MIGRATION_POSTFLIGHT_FAILED';

export type MigrationPhase = 'validate' | 'preflight' | 'execute' | 'reconcile' | 'postflight';
/** What is known about the named migration's effect on the database. */
export type MigrationSafeStatus = 'not-applied' | 'failed' | 'applied' | 'unknown';

export class MigrationError extends Error {
  readonly code: MigrationErrorCode;
  readonly phase: MigrationPhase;
  readonly migrationId?: string;
  readonly position?: number;
  readonly status?: MigrationSafeStatus;
  /** Migrations this invocation committed (or reconciled) before the error. */
  readonly results: readonly MigrationRunResult[];
  /** Post-flight only: the plan that still blocks. */
  readonly plan?: SchemaPlan;
}
export function isMigrationError(err: unknown): err is MigrationError;
```

Messages contain ids, positions, codes and table names, never bound values or row contents. `cause`
keeps the raw driver error for local debugging. It is never persisted.

### 7. Adapter capability (optional)

```ts
interface DatabaseAdapter {
  // …unchanged…
  runMigrations?(
    migrations: readonly MigrationDefinition[],
    options?: RunMigrationsOptions
  ): Promise<MigrationRunResult[]>;
  readMigrationHistory?(): Promise<MigrationRecord[]>;
}
export interface MigrationRecord {
  position: number;
  id: string;
  checksum: string;
  status: 'applied' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  attempts: number;
  failureCode: string | null;
}
```

`LibSqlDatabaseAdapter` and `D1DatabaseAdapter` delegate to `runSqliteMigrations` /
`readSqliteMigrationHistory` over their existing `SqliteSchemaExecutor`, so there is one engine and two
small bindings. Custom adapters keep compiling. InMemory does not implement them.

### 8. The one supported entry point: `ForgeCmsRuntime`

```ts
runtime.planMigrations(migrations): Promise<MigrationState[]>;            // read-only preflight
runtime.runMigrations(migrations, options?): Promise<MigrationReport>;
runtime.readMigrationHistory(): Promise<MigrationRecord[]>;

interface MigrationState { position: number; id: string; checksum: string; destructive: boolean; state: 'applied' | 'failed' | 'pending' }
interface MigrationReport { before: SchemaPlan; results: MigrationRunResult[]; after: SchemaPlan }
```

`runMigrations`:

1. Validate (pure). An adapter without `runMigrations` → `MIGRATION_UNSUPPORTED`.
2. **Preflight:** `before = await this.planSchema()`, the drift the migrations are meant to resolve, as
   data.
3. `database.runMigrations(…)`, as in §5.
4. **Post-flight:** `await this.syncSchema()` applies the safe remainder and records baselines. Then
   `after = await this.planSchema()`. A `SchemaDriftError` or a blocking `after` →
   `MIGRATION_POSTFLIGHT_FAILED`, phase `postflight`, status `applied` when anything committed. The
   message says the migrations **committed and were not rolled back**, and to inspect and forward-fix
   or restore.

Adapter methods are the capability. `runtime.runMigrations` is the documented consumer path. Neither
`init()` nor `syncSchema()` ever calls them.

### 9. Release fixes

- `scripts/release-decision.mjs` (pure, tested with `node --test`):
  - `decideAggregateRelease({ head, base })` returns `{ create, version, reason }`. `create` is true only
    when every public package at HEAD shares one version V and the first-parent commit did not already
    carry V. `base` is null when the first parent is unreadable, and then `create` is false: missing a
    tag is safe, a wrong tag is not.
  - `isAlreadyPublishedError(stderr)` recognises `E409 … previously staged` and `E403 … cannot publish
over the previously published versions`.
- `create-github-release.mjs` reads `HEAD^1:packages/*/package.json` with `git show` and exits without
  tagging when there is no transition. The CI release job checks out with `fetch-depth: 2`.
  - Merge commits (GitHub merge button): parent 1 is the previous `main`.
  - Squash merges and ordinary pushes: parent 1 is the previous commit.
  - The Version Packages merge carries the transition.
  - A multi-commit direct push whose bump is not the head commit is not tagged, and the operator tags it
    by hand.
- `publish-unpublished.mjs` treats those errors as "already published", so registry lag right after
  `changeset publish` no longer fails the job before tagging.
- Root `test` runs `turbo run test` and then `node --test scripts/`.

## Implementation plan

- [x] Reproduce the gap (Context)
- [x] Release: decision module + tests, create-github-release, publish-unpublished, CI fetch-depth
- [x] db: `migrations.ts` (definition, validation, checksum, history rules, error), `sqlite-migrations.ts`
      (ledger, bootstrap, runner, fence/reconcile, history), adapter interface, libSQL binding, exports
- [x] cloudflare: D1 binding
- [x] runtime: `planMigrations`, `runMigrations` (pre/post-flight), `readMigrationHistory`
- [x] testing: `runMigrationContractTests` wired on libSQL (runtime package) and local D1 (workers)
- [x] docs: SCHEMA-UPGRADES, ARCHITECTURE, STATE, ROADMAP + 0.7 status, db/cloudflare READMEs, version policy
- [x] api-baseline, patch changeset, gates

## Test plan

- `packages/db/src/migrations.test.ts`: validation matrix, the golden checksum, arg typing, and every
  `planMigrationHistory` rule.
- `packages/db/src/sqlite-migrations.test.ts` (libSQL on-disk, with an executor fault wrapper):
  - known rollback and fence;
  - lost response after commit → `reconciled`;
  - lost request → `failed`;
  - unreachable database → `OUTCOME_UNKNOWN`, then the next run is safe;
  - the ledger bootstrap works while app drift blocks.
- `packages/testing/src/contracts/migrations.ts`, run on on-disk libSQL (`packages/runtime`) and local
  D1 (`packages/cloudflare/test/workers`). Through `ForgeCmsRuntime`:
  - seeded rename, required backfill, drafts enable, index `index` → `unique` and localized with
    `resetBaseline`;
  - duplicate invocation, edited applied migration, reordered and removed migrations;
  - divergent and same-migration runners with a deterministic batch hold;
  - mid-batch failure then refusal then an approved retry; `replaceFailed`;
  - the destructive gate;
  - post-flight failure reported as committed;
  - `syncSchema()` never runs migrations;
  - history read.
- Release: `scripts/release-decision.test.mjs`.
- Gates: format, lint, typecheck, test, build, `test:libsql`, `test:cloudflare`, `check:api`,
  `release:verify`, `e2e:www`, `e2e:tiny-project`, `e2e:demo`, `changeset status`.

## Acceptance criteria

1. One migration definition format with stable ids and deterministic checksums (golden test).
2. History is persisted and an exact prefix is enforced. Reorder, removal and divergence fail before
   execution.
3. An applied migration is never re-run. An edited applied migration fails with
   `MIGRATION_CHECKSUM_MISMATCH` before anything runs.
4. Claim, migration SQL and the `applied` transition are one batch, and a mid-batch failure leaves no
   trace of the SQL (libSQL and D1).
5. Two concurrent runners never both execute the same position, whether the migrations are the same or
   divergent (libSQL and D1).
6. Known failure, reconciled success and unknown outcome are distinct. Failed migrations need an explicit
   `retryFailed`/`replaceFailed`.
7. Destructive migrations need `allowDestructive`. `syncSchema()` and `init()` run no migrations.
8. Post-flight uses `planSchema`/`syncSchema`, and a post-flight failure reports committed migrations as
   committed.
9. The seeded rename, backfill, drafts, index and localized fixtures pass on on-disk libSQL and local D1.
10. No down migrations, no CLI, no remote database touched.
11. The aggregate tag is only created on a version transition (tested). M02 ships as a `patch` (0.8.x).

## Outcome

Shipped as designed, 2026-09-29, as a `patch` (npm `0.8.1` per the version policy above). Differences
from the first draft, found while implementing or by review (forge-rules-reviewer and spec-reviewer):

- **Replace no longer resets `attempts` (HIGH, review).** With `attempts = 1` on replace, a lost retry
  batch could match the row again after a later replace, and commit after the runner had reported it
  as proven failed. Now `attempts` strictly increases at a position (§5 "No ABA"). A regression test
  replays the exact sequence and fails on the old code.
- **Baseline-only migrations.** A migration may have zero statements when it declares
  `resetBaseline`. That is the recorded replacement for spec 070's manual `DELETE FROM "_forge_schema"`,
  and the forward fix for a post-flight failure.
- **Replace-mode reconcile.** An old failed row whose `attempts` changed is known failed, not
  unknown; an old row now `applied` is a mismatch.
- **Post-flight.** A `planSchema()` error during post-flight is reported as
  `MIGRATION_POSTFLIGHT_FAILED` with the committed results, not as a raw error.
- **Validation.** `$1`/`:1`/`@1` placeholders are refused. Trigger bodies (`BEGIN …; END`) cannot be
  expressed as one statement; this is documented as a limitation.
- **D1 budget.** The runner adds up to 7 statements per batch (40 + 7 ≤ 50). A whole
  `runMigrations()` call also plans the schema before and after, which counts against the Workers
  per-invocation query limit. This is documented as a limitation. It is not proven on remote D1.
- **Surface.** Also exported: `PreparedMigration`, `MigrationHistoryPlan`, `prepareMigrations` and
  `planMigrationHistory`, plus `MIGRATION_MAX_STATEMENTS` and `MIGRATION_LEDGER_TABLE`.
  `@forge-cms/runtime` exports `MigrationReport`.

Evidence:

- `migrations.test.ts`: 38 pure tests, including the golden checksum
  `a00258125b9a5712617029ec6823ce6e312b87371cade31f364d1a2d038e7e93`.
- `sqlite-migrations.test.ts`: 13 on on-disk libSQL, with transport faults: mid-batch rollback,
  retry/replace, lost request/response in fresh, retry and replace mode, the ABA replay,
  outcome-unknown, then a safe rerun.
- `runMigrationContractTests`: 13 on on-disk libSQL through the runtime (11 contract + 2
  runtime-only) and 11 on local D1 (workerd).
- Release scripts: 8 `node --test` tests, and a replay against real history.
- E2E: www 22, tiny-project 13, demo 17.

**Not verified:** remote D1 and Turso. Outcome-unknown is exercised on libSQL only (the D1 harness
hooks batches, not reads).
