# 073 — Rehearse historical upgrades and backup/restore

- **Status:** done <!-- roadmap 0.7 M03, requested by the maintainer after spec 072 -->
- **Author:** agent draft
- **Date:** 2026-09-29
- **Branch:** `feature/spec-073-upgrade-backup-rehearsal`
- **Affected packages/apps:** new private `apps/upgrade-rehearsal` (fixtures, generator, rehearsal
  suites), `@forge-cms/runtime` (one targeted fix, §10), root scripts + CI,
  `scripts/create-github-release.mjs`, `scripts/verify-release.mjs`, apps/www copy, docs.

## Context / Why

M01 (spec 070) answers "is the stored schema compatible?" and M02 (spec 072) "how does a reviewed
migration run exactly once?". Neither proves that a **real installation written by an older release**
— users and password hashes, API keys, drafts, relations, localized values, globals, history, files —
can be upgraded, backed up, restored into a clean environment, and still work. That is M03, the last
packet of roadmap 0.7 and its release gate. Until now there was no historical fixture, no restore
rehearsal and no recovery runbook, and `SCHEMA-UPGRADES.md` told operators to "back up under your
deployment policy" with nothing behind it.

### Release truth at the start (2026-09-29, verified from npm, GitHub and CI logs)

- The brief assumed `main` = `0.8.1` with the M02 changeset pending. By the time this spec started,
  PR #58 (Version Packages → `0.8.2`) had been merged (`830fb9d`, 08:53 UTC): `main` manifests are
  `0.8.2` and no changeset is pending.
- **npm `0.8.1` already contains M02.** It was published by the CI run of `f4c22a9` (the merge of PR
  #56), which came after PR #57 (M02) merged. The M02 changeset was still pending then, so the `0.8.1`
  changelog does not mention it; `0.8.2` carries that changelog entry with no code difference.
- **No `v0.8.1` GitHub release/tag exists.** The run logged "0.8.1 was already the version at the
  first parent". Root cause: when the same run also opens a Version Packages PR, `changesets/action`
  leaves `HEAD` on its `changeset-release/main` commit (parent `f4c22a9`, already `0.8.1`);
  `create-github-release.mjs` compared `HEAD^1`, not the triggering commit's parent. Spec 072's fix
  was right for every other path.

### Published-source provenance (from each version's publishing CI run, not from tags)

| npm     | Published (UTC)  | Publishing run → source commit                                            | Aggregate tag          |
| ------- | ---------------- | ------------------------------------------------------------------------- | ---------------------- |
| `0.4.0` | 2026-09-03 13:01 | run 33757940308 on `7103653` (`publish-unpublished` from the bumped tree) | `v0.4.0` → `7103653` ✔ |
| `0.5.0` | 2026-09-19 10:01 | run 35435951343 on `29643d1` (includes specs 057–059)                     | `v0.5.0` → `29643d1` ✔ |
| `0.6.0` | 2026-09-28 08:18 | run 36395781099 on `d2ff7dd` (specs through 065 + 066–068)                | `v0.6.0` → `42fc1d9` ✘ |
| `0.7.0` | 2026-09-28 14:14 | run 36433620409 on `7248ec8`                                              | `v0.7.0` → `2ec5208` ✘ |
| `0.8.0` | 2026-09-28 19:13 | run 36469552403 on `47dfae2`                                              | `v0.8.0` → `47dfae2` ✔ |
| `0.8.1` | 2026-09-29 07:36 | run 36536641296 on `f4c22a9` (M02 code included)                          | none (bug above)       |
| `0.8.2` | 2026-09-29       | run on `830fb9d` (same code as `0.8.1`)                                   | expected `v0.8.2`      |

The fixtures do not depend on this table being exact: they are generated from the **published npm
tarballs** themselves (§2), whose integrity hashes the manifests record.

## Goal

One offline, reproducible command (`pnpm test:upgrade`) proves, on on-disk libSQL and on local
D1/R2 (workerd), that installations written by historical releases upgrade through the documented
M01/M02 path, and that an upgraded installation can be backed up and restored into an isolated empty
environment with working auth, content, history and files.

## Non-goals

- A public backup subsystem: no `runtime.backup()`/`restore()`, no `@forge-cms/backup`, no CLI, no
  scheduler, no remote backup service. Rehearsal helpers stay private to `apps/upgrade-rehearsal`.
- Whole-bucket backup via `StorageAdapter.list()` (R2 `list()` is capped at 1000 with no cursor —
  input for P01/P03). The required object set is derived from the database snapshot.
- An online, atomic DB + object-storage snapshot, point-in-time recovery, maintenance mode,
  multi-database auth backup.
- S3 (P01–P03), SSR, admin, Strata, Angular DX (C01–C03). Finding 24 (dates as strings) stays for C02.
- Any remote D1/R2 command. Remote operator commands are documented, never executed.
- Rewriting historical tags or spec 072.

## Design

### 1. Where it lives

`apps/upgrade-rehearsal` — private workspace (like tiny-project), never deployed, consuming only the
public `@forge-cms/*` entry points:

```text
apps/upgrade-rehearsal/
  fixtures/upgrades/<version>/   manifest.json, database.sql, storage-manifest.json, storage/<sha256(key)>.bin
  generator/                     seed.mjs (historical seed), generate.mjs (maintainer-only, network)
  src/                           model.ts (current app + migrations), fixtures.ts, backup.ts,
                                 libsql.ts, cloudflare.ts, verify.ts
  test/                          fixtures.test.ts, backup.test.ts (fast, in `pnpm test`),
                                 upgrade-libsql.test.ts, upgrade-d1-r2.test.ts (in `pnpm test:upgrade`)
```

Root: `pnpm test:upgrade` (turbo, after `^build`) and `pnpm fixtures:upgrade:generate <version>`.

### 2. Fixtures: generated by the historical release itself

`generate.mjs <version>` installs the **published** `@forge-cms/*@<version>` tarballs (plus pinned
`@libsql/client` 0.17.3 and `miniflare` 4.20260511.0) into a temporary directory and runs `seed.mjs`
there twice: once with that release's `LibSqlDatabaseAdapter` + `InMemoryStorageAdapter`, once with
its `D1DatabaseAdapter` + `R2StorageAdapter` on Miniflare (real local D1/R2). Everything is written
through that release's public API — `createUser`, `createApiKey`, `handleCreate` multipart uploads,
the Local API, `updateGlobalDocument` — so the persisted shape is what that release really wrote.
Nothing is generated from today's `desiredTableSchema()`.

- **Deterministic:** only inside the generator process, `crypto.randomUUID` draws from a queue of
  planned ids (then a counter), `crypto.getRandomValues` from a seeded PRNG, and `Date` from a step
  clock. Every returned id is asserted. A rerun is byte-identical.
- **Dump:** tables in name order with their stored `CREATE` text, rows in `rowid` order as
  `quote()`d literals, then indexes. No `BEGIN`/`COMMIT` (D1 import rule).
- **Both profiles must agree.** For every audited release the libSQL and D1 dumps and the object sets
  are byte-identical, so one `database.sql` serves both lanes; the generator fails if they ever
  differ (then the layout needs a deliberate per-profile split).
- **Never overwritten automatically.** An existing fixture directory is refused without `--force`.
- **Manifest** (`manifest.json`): `forgeVersion`, `sourceKind: "published-package"`, npm integrity
  of each tarball, resolved third-party versions, publishing source commit + evidence, generated
  profiles, row counts, feature flags, test-only credentials, and `files` → `sha256:` for every file.
  `fixtures.test.ts` fails on any hash mismatch, missing or unlisted file.

### 3. Checkpoints (decided from generated dumps, not assumed)

Dumps of the same model generated by every release from 0.4.0 to 0.8.1:

| Release         | Persisted change vs previous (this model)                                                                                                                                                            | Fixture | Why                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------ |
| `0.4.0`         | baseline: users + `passwordHash`, `_forge_api_keys`, `_versions_*` (patch-shaped), `_global_*`, `_status`, `_storageKey`                                                                             | **yes** | the roadmap's 0.4.x baseline                                       |
| `0.5.0`         | `+ _forge_bootstrap` (same DDL as 0.6.0); users column order                                                                                                                                         | no      | covered by 0.4.0 (history, users) + 0.6.0 (bootstrap)              |
| `0.6.0`         | `+ _forge_storage_intents`, `_versions_*.snapshotFormat` + unique `(documentId, versionNumber)`, `users._sessionVersion`; localized values persist (0.4.0/0.5.0 fail with `[object Object]`, probed) | **yes** | full snapshots, localized values, `_sessionVersion`, intents table |
| `0.7.0`         | none — dump byte-identical to 0.6.0                                                                                                                                                                  | no      | nothing new to prove                                               |
| `0.8.0`         | `+ _forge_schema` baseline rows                                                                                                                                                                      | **yes** | the only start state with an existing M01 baseline                 |
| `0.8.1`/`0.8.2` | none at rest — `_forge_migrations` is created by the runner; dump byte-identical to 0.8.0                                                                                                            | target  | the current code under test                                        |

### 4. The representative model

`users` (`defineUsersCollection`), `categories`, `media` (upload), `posts` (drafts, versions,
relation single + many + users relation + upload, richtext, group, json, unique slug; localized
`summary` from 0.6.0), global `settings`. Stable ids: `user_admin`, `user_editor`,
`category_news`, `category_guides`, `media_hero`, `media_brochure`, `post_published`, `post_draft`;
API keys use fixed UUID-shaped ids (a token is `<prefix>_<recordId>_<secret>` and the id may not
contain `_`). `post_published` has 3 historical versions (4 from 0.6.0: the Spanish summary). Test
credentials are fixture-only.

The **current** model (`src/model.ts`) evolved in three ways M01 refuses, applied by one append-only
migration array: `categories.label → name` (destructive, `resetBaseline`), `categories.slug` index →
unique (drop index, post-flight creates the unique one), `media.alt` required with backfill.

### 5. Upgrade lane (per fixture × profile)

Load fixture into a fresh temp environment → current runtime → `planSchema()` (must block on exactly
the expected changes) → `runMigrations(migrations, { allowDestructive: true })` → post-flight plan
clean → behavioral verification through public APIs: login + `handleMe` for both historical users,
roles, no duplicate admin (a new signup is not admin), API keys (active validates, revoked does not),
stable ids and exact values, relations populated (and `passwordHash` never in an HTTP response),
restrict delete refused, draft visibility (anonymous vs trusted/editor), locale reads, global read +
update, history read + restore (legacy patch semantics for 0.4.0), files via `handleFile` with exact
bytes/content type/metadata, edits/creates/publish after upgrade, rerun → `already-applied`.

### 6. Backup/restore lane (per fixture × profile)

Upgraded source → post-upgrade writes + one pending storage intent → **quiesce** → DB snapshot →
required keys = every non-null `_storageKey` of every upload collection **in the snapshot** → copy
those objects (bytes, content type, custom metadata, size, SHA-256) → manifest → verify → destroy the
source → prove the target is empty → restore DB, then objects, verify checksums → start runtime →
`planSchema()` clean, `readMigrationHistory()` equal, migrations rerun `already-applied`, counts and
values equal, login again, one write, `reconcileStorage()` twice (second is a no-op).

- **libSQL:** the source runtime is no longer used; the file must be in rollback-journal mode with no
  `-journal`/`-wal`/`-shm` sidecar (else refuse: checkpoint/close first); byte copy + SHA-256; restore
  copies to a different, non-existing path; the source file is deleted before verification.
  Objects run through the same adapter-neutral code against `InMemoryStorageAdapter` — the libSQL
  profile has no durable object store before P01/P03, which the docs state.
- **D1/R2:** each environment is its own directory with its own `wrangler.jsonc` and local state.
  The source Miniflare is disposed (quiesced) before `wrangler d1 export --local`; the export is loaded
  into a scratch in-memory libSQL database to read the snapshot's keys; objects are copied through the
  R2 binding (Miniflare). Restore: `wrangler d1 execute --local --file` into the empty target
  directory, objects `put` with `httpMetadata`/`customMetadata`, then the current runtime runs on a new
  Miniflare over the target. The source directory is deleted before verification.

### 7. Backup manifest (private rehearsal format)

```ts
interface BackupManifest {
  format: 1;
  createdAt: string;
  profile: 'libsql' | 'd1-r2';
  forgeVersion: string;
  database: { file: string; sha256: string; size: number };
  objects: {
    key: string;
    file: string;
    sha256: string;
    size: number;
    contentType: string | null;
    metadata: Record<string, string>;
  }[];
}
```

Blob files are named `sha256(key).bin`; the manifest maps key → file, so `../`, slashes and Unicode
in keys never reach the filesystem. It never contains `AUTH_SECRET`, passwords, API-key plaintext,
cookies or Cloudflare credentials (asserted). A missing required object fails the backup before any
manifest exists; a corrupted/missing file fails verification before anything is restored.

### 8. Release gate

`pnpm test:upgrade` runs in the CI `checks` job, which `release` already needs. `release:verify`
additionally compiles a consumer against the packed upgrade API (`planSchema`, `runMigrations`,
`planMigrations`, `readMigrationHistory`, `defineMigration`, `reconcileStorage`, `handleFile`).

### 9. Release-tag fix (narrow)

`create-github-release.mjs` reads the triggering commit (`GITHUB_SHA`) and its first parent instead of
`HEAD`/`HEAD^1`, so a run that also opened a Version Packages PR still tags the publishing commit.
`release-decision.mjs` is unchanged. The missing `v0.8.1` is recorded for the maintainer to create at
`f4c22a9` by hand; this change does not create it.

### 10. Targeted package fix found by the rehearsal

`release:verify`'s packed upgrade consumer (§8) ran the runbook's `reconcileStorage()` step on a site
without upload collections and got `Collection '_forge_storage_intents' not registered`: the intents
table is only synced where uploads exist, but `reconcileStorage()` read it unconditionally. It is now a
no-op returning an empty report when no collection is upload-enabled (regression test on on-disk
libSQL, red before the fix). Patch changeset for `@forge-cms/runtime`. No API change.

## Implementation plan

- [x] Generator + fixtures 0.4.0 / 0.6.0 / 0.8.0 with manifests
- [x] `fixtures.ts` integrity + `fixtures.test.ts`
- [x] `backup.ts` + `backup.test.ts` (awkward key, corruption, missing object, secrets scan)
- [x] `libsql.ts`, `cloudflare.ts` (Wrangler/Miniflare environments), `verify.ts`
- [x] upgrade + backup/restore suites for both profiles; timings
- [x] root scripts, turbo task, CI step, `release:verify` upgrade API check
- [x] release-tag fix + test
- [x] docs: `BACKUP-RESTORE.md` runbook, SCHEMA-UPGRADES, STATE, ROADMAP, 0.7 brief, QUALITY, CLAUDE.md map, README(s)

## Test plan

`pnpm test:upgrade` (both lanes, three fixtures, two profiles), `pnpm test` (fixture integrity +
backup units + release scripts), then every gate: format, lint, typecheck, test, build,
`test:libsql`, `test:cloudflare`, `check:api`, `release:verify`, `e2e:www`, `e2e:tiny-project`,
`e2e:demo`.

## Acceptance criteria

1. Committed 0.4.0 fixture with provenance; 0.6.0 and 0.8.0 checkpoints; every release 0.4.0 →
   current accounted for in §3.
2. CI needs no network for fixtures; hashes are verified; fixtures are never regenerated by tests.
3. Each fixture upgrades on libSQL and local D1 through `planSchema` → `runMigrations` → clean plan.
4. Historical logins succeed after upgrade **and** after restore; roles correct; no duplicate admin.
5. Stable ids, exact values, relations, draft visibility, locales, global, history + restore, files
   (bytes, content type, metadata) verified through public APIs; old content is editable.
6. libSQL and D1 backups restore into isolated empty targets; R2 objects referenced by restored
   content are restored with identical bytes and metadata.
7. Corrupt DB/object and missing object are rejected before success is reported.
8. `_forge_migrations` survives; rerunning the array applies nothing. `_forge_schema` survives and the
   final plan is clean.
9. Runbook: quiescence, no DB/R2 atomicity, forward-fix vs restore, snapshot-point recovery only.
10. No remote resource touched. `pnpm test:upgrade` is in the release gate.

## Open questions

None.

## Outcome

Shipped as designed, 2026-09-29. **Roadmap 0.7 (M01 + M02 + M03) is complete.**

- **Fixtures:** `0.4.0`, `0.6.0`, `0.8.0` (84 KB), each generated twice by the published packages (libSQL
  and Miniflare D1/R2) with byte-identical results, regenerated byte-identically, and hash-checked.
  The generator refuses to overwrite. Fixture ids are readable (`user_admin`, `post_published`, …)
  except API keys, which must be UUID-shaped (a first attempt with `key_ci` made the historical token
  unparseable — a fixture artifact, not a Forge defect).
- **Upgrade (each fixture, both profiles):** plan = exactly the 4 expected blocking changes (+ safe
  additive internal tables/columns, `baseline-recorded` where no baseline existed) → `syncSchema()`
  refuses → 3 migrations `applied` → post-flight plan with **no changes** → full behavioral
  verification (spec §5), rerun `already-applied`, an edited migration still detected.
- **Backup/restore (each fixture, both profiles):** exported/copied snapshot contains
  `_forge_migrations` (3 rows), `_forge_schema` and the pending intent; required keys = the fixture's
  two objects (the intent's orphan excluded); source deleted before verification; empty target
  proven; history, counts and values identical after restore; logins and a write work;
  `reconcileStorage()` deletes the orphan's key once, then reports nothing.
- **Durations** (developer laptop, small fixture; ranges over two runs, the slower one sharing the
  machine with `test:cloudflare`): on-disk libSQL — load 7–11 ms, upgrade 10–19 ms, cold backup
  1–2 ms, restore 0–4 ms, verification 25–115 ms. Local D1/R2 (each step spawns Wrangler or starts
  workerd) — load 0.46–1.9 s, upgrade 0.43–1.1 s, `d1 export` + objects 0.46–0.59 s,
  `d1 execute --file` + objects 0.48–0.71 s, verification 0.58–1.6 s. `pnpm test:upgrade` 15–30 s.
- **Differences from the draft:** §10 (a real package fix); the backup lane also rejects a tampered
  D1 export; the anonymous `status: 'all'` read is asserted not to unlock drafts. Website constant
  moved to `0.8.2` because npm published it during this work.
- **Not verified:** remote D1/R2, Turso, S3; restore of a WAL-mode libSQL file (refused by design).
