# 089 — Measurable reliability and a performance baseline (roadmap 0.12 / R02)

- **Status:** done (2026-10-10)
- **Author:** agent draft (implementation requested by the maintainer, 2026-10-10 — "spec 089 — roadmap 0.12 / R02"; per
  [SDD.md](../SDD.md) an explicit request to implement counts as approval)
- **Date:** 2026-10-10
- **Branch:** feature/spec-089-measurable-reliability
- **Affected packages/apps:** `scripts/quality/` (new gates), `apps/performance-baseline` (new, private),
  `.github/workflows/ci.yml`, `apps/*/playwright*.ts`, `apps/www/e2e/theme.spec.ts`, docs; and — because measuring found real
  defects — `@forge-cms/runtime`, `@forge-cms/db`, `@forge-cms/cloudflare`, `@forge-cms/testing` (**patch**, one changeset, no
  public API change).

## Context / Why

R01 ([088](088-packed-production-consumers-and-durable-profiles.md)) proved _which bytes_ are certified. R02 proves _how well
those bytes are tested, how stable the critical journeys are, and what normal operation costs_ — with numbers a reviewer can
re-run, not impressions. Until now the only coverage gate was the B04 ratchet in a root `vitest.config.ts` (60/64/50/60,
deliberately below a 2026-09-18 measurement of 66.8/70.3/59.4/67.3): one global number, in which a heavily tested package hid a
thin one, and in which `@forge-cms/testing` read ~0% because the contract suites reach it through its built `dist`. There was no
performance fixture, no database-call accounting, no flake inventory, and one known intermittent failure
(`apps/www/e2e/theme.spec.ts`) that R01 handed over.

## Goal

The exact ForgeCMS pre-1.0 package line has measured package-level coverage at the agreed [QUALITY](../roadmap/v1/QUALITY.md)
floors, every critical uncovered release behaviour has explicit evidence, critical journeys run repeatedly without unexplained
flakiness, and a fixed deterministic fixture records bounded database work plus reproducible latency/memory/bundle baselines with
frozen regression budgets.

## Non-goals

No new product capability; no speculative optimization; no database rewrite, cache or new storage provider; no dependency
sweep; no 100% coverage target; no comparison with other CMSs; no universal latency claim, no remote or cloud benchmark; no R03
staging, no R04 documentation/dossier, no release candidate. Local timings are **regression baselines for this repository, not
production latency**.

## Design

### 1. Coverage is per package, source-attributed, and gated by class

`pnpm test:coverage` → `scripts/quality/coverage-release.mjs`:

1. For each of the eleven public packages it runs that package's **own** Vitest environment (so `@forge-cms/admin` keeps its
   Angular compile transform and jsdom; `@forge-cms/cloudflare` its `src/`-only include) through
   `scripts/quality/vitest.coverage.config.mjs`, which loads the package's `vitest.config.ts` and adds source-attributed V8
   coverage. Scope = what the package build ships: `src/**/*.ts` minus `*.test.ts`, `*.test-helpers.ts` (excluded by every
   `tsconfig.build.json`) and `*.d.ts`.
2. **Attribution fix.** `@forge-cms/testing` resolves to its **source** in these runs, so the contract suites that
   db/auth/storage/runtime/cloudflare execute are credited to `packages/testing/src/contracts/*`. Every other `@forge-cms/*`
   import still goes through `dist`, deliberately: a package's coverage is what _its own tests_ execute of _its own source_.
3. The raw istanbul reports are merged per file (hit counts summed; incompatible maps refuse to merge), assigned to the owning
   package, and totalled per package — `coverage/packages.json`, `summary.md`, `files.json` and `uncovered.md` (uncovered
   lines per file) are written to the gitignored `coverage/`.
4. Each package is judged against its class in `scripts/quality/coverage-floors.json` — **non-UI 90/90/90/85, Angular runtime
   85/85/85/80** (statements/lines/functions/branches), the QUALITY.md floors, unchanged. A package under its floor fails the
   command; no package can lend its numbers to another. The logic lives in `coverage-lib.mjs` and is unit-tested against
   synthetic coverage just under/over a floor (`scripts/quality-gates.test.mjs`).
5. The B04 coverage ratchet in the root `vitest.config.ts` is **removed** (its global thresholds were not the 1.0 contract, and
   it could not run the Angular suites: 16 files / 93 tests failed under a root `--coverage` run without the Angular
   transform). The file itself stays, reduced to its `include`: Vitest discovers it from any package without a config of its
   own, so it still decides what `pnpm test` runs there (e.g. it keeps `packages/s3/test/*.integration.test.ts`, which needs the
   Garage service, out of the default run — deleting it was tried and broke exactly that).

**Cloudflare worker suites are not counted.** `@cloudflare/vitest-plugin` runs inside workerd, where V8 coverage is unavailable
(`node:inspector` is not implemented there). `@forge-cms/cloudflare`'s number comes from its node suites (D1/R2 mocks, emitted-SQL
tests) only; the workerd suites (`pnpm test:cloudflare`) add real-D1/R2 evidence that is **not** in the percentage — the figure is
a lower bound. Adding an Istanbul provider only to merge two incompatible statement maps was judged worse than an honest lower
bound.

**Templates.** TypeScript coverage does not measure Angular templates. `@forge-cms/angular` and `@forge-cms/admin` are held to
the TS floors above **and** certified by the rendered/browser evidence of U01/U02/U03 (TestBed reliability and accessibility
suites, the www/tiny-project/demo Playwright journeys). Neither is substituted for the other, and no component class was
excluded to make a number.

### 2. Critical-behaviour matrix, with the missing evidence added

QUALITY.md requires explicit positive _and_ negative evidence for each high-risk behaviour regardless of any percentage. The
audit (Outcome → _Critical behaviour matrix_) found every row backed by existing suites **except** the gaps below, each closed
with a focused behavioural test (never a line-marking call):

| Gap found                                                                                                                                                                                                                                                                                            | Evidence added                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| core: slug / email / select / json / localized / array-row / blocks-row validation and unknown-field rejection                                                                                                                                                                                       | `packages/core/src/validation-boundaries.test.ts`                     |
| auth: managed-delete guard (referenced, plural, race, malformed/cross-database guard, batch ceiling), last-admin on the guarded path, uninitialised adapters fail closed, composite delegation, cookie parsing, API-key edge cases, session expiry                                                   | `packages/auth/src/managed-delete-and-edges.test.ts`                  |
| runtime HTTP: query bounds (16 malformed forms → 400 with **zero** database reads), upload size/MIME/missing-part with nothing persisted, version list/get/restore auth + roles, global auth/roles/bad JSON/adapter fault, preview, **HTTP never honours a caller-supplied `overrideAccess`/`user`** | `packages/runtime/src/handlers-boundaries.test.ts`                    |
| runtime: row-scoped delete race (409 vs 404), versions disabled, global access denial, global write fault leaves the value unchanged, unsupported global locale, cascade cycle terminates, dangling ids in many-relations, locale fallback chain                                                     | `packages/runtime/src/fault-and-fallback-edges.test.ts`               |
| runtime/auth/storage: no secret or provider detail in responses, logger or console on dependency failure                                                                                                                                                                                             | `packages/runtime/src/log-redaction.test.ts` (§5)                     |
| testing: the concurrency harness itself (write barrier, its timeout diagnostic, contender validation, first-admin fault injector, winner selection)                                                                                                                                                  | `packages/testing/src/contracts/harness.test.ts`                      |
| storage / cloudflare: public-URL base, uninitialised D1/R2 fail closed, R2 `head`, D1 `OFFSET` SQL                                                                                                                                                                                                   | `storage/src/index.test.ts`, `cloudflare/src/{d1,r2}.adapter.test.ts` |

### 3. Defects found by measuring (fixed, regression-tested)

- **`?offset=N` without `limit` was a 500 on libSQL and D1.** SQLite rejects `OFFSET` without `LIMIT`; the in-memory adapter
  served it, so the adapters diverged and every suite passed. Found by reading why D1's `OFFSET` branch was uncovered, then
  reproduced over HTTP on libSQL. Fixed generically in both SQL adapters (an unbounded `LIMIT` when only an offset is given);
  the shared query contract now pages with offset alone, offset + limit and past the end for **every** adapter (InMemory, libSQL,
  D1 mock, workerd D1), plus an HTTP regression over real libSQL and a D1 emitted-SQL test. Severity: medium (a valid public
  request returned 500; no data exposure).
- **Depth-1 population failed on D1 beyond 100 distinct targets.** Population sent every distinct related id of a page in one
  `id in (…)`; D1 allows 100 bound parameters per statement (documented; reproduced on local workerd: `too many SQL variables`),
  so listing 50 posts with 3 tags each from 150 tags was a 500 on the D1 profile although it passed on libSQL and InMemory. Found
  by auditing the population algorithm against platform limits while designing the fixture. Fixed in `populate.ts` (chunks of 80
  ids; calls now equal 1 + ⌈distinct targets / 80⌉ per relation field, still independent of the row count), with a unit test of the
  chunking and a workerd regression that fails without the fix. Severity: high for the D1 profile (a normal depth-1 list could
  500), no data exposure. The fixture's invariant was restated accordingly (Outcome → _N+1_).
- **Provider errors reached the log.** `handlers.ts` logged the whole error object for any unexpected failure, and storage
  cleanup logged the provider's message. A driver/SDK error can quote a connection string, key id or token in its message or
  properties. Reproduced with deterministic marker secrets (3 of 6 new tests failed), then fixed: unexpected failures log the
  error's **class name and short machine code only** (`describeErrorForLog`, internal, not exported), the policy the auth handlers
  already had (spec 069). Responses were already generic. Severity: medium (information disclosure into logs).

### 4. Flakiness

- `scripts/quality/stability.mjs` (`pnpm test:stability`) runs the critical journeys repeatedly in fresh processes with
  **retries forced off** and records each run's first-attempt result; the CI profile is smaller.
- Every Playwright config keeps its CI retry (it exists to capture a trace) but now sets `failOnFlakyTests` in CI, so a test that
  needed a retry **fails the job** instead of silently turning green. Local runs have no retries.
- The theme flake: see Outcome → _Flakiness inventory_.

### 5. Secret and internal-error leakage

`log-redaction.test.ts` injects deterministic failures carrying `FORGE_R02_AUTH_SECRET_DO_NOT_LOG`,
`FORGE_R02_S3_SECRET_DO_NOT_LOG` and `FORGE_R02_TOKEN_DO_NOT_LOG` (in the message **and** in provider-style properties such as
`$metadata`, `config.authToken`) through: a failing database read, a failing auth adapter on a protected write, a failing login
adapter, a failing storage `put` during upload, a failing storage `delete` during cleanup, and a provider outage while reading a
stored file. It asserts the markers appear in neither the HTTP body, the Forge logger, nor `console.*`, that the response is the
generic `INTERNAL_ERROR` envelope, and that nothing was persisted. Useful redacted diagnostics are kept (the log line still
names the failing operation and error class). The R01 browser-bundle secret scan is unchanged.

### 6. The performance fixture (`apps/performance-baseline`, private, not deployed)

One fixed fixture; local; no network, no cloud, no Docker.

- **Database:** on-disk libSQL file in a temp directory (a real portable SQL adapter; Cloudflare parity is R01's job).
  **Storage:** the InMemory adapter (this measures Forge's upload lifecycle overhead, not a network provider — real S3 stays
  certification, not latency benchmarking). Built `dist` of the `@forge-cms/*` packages.
- **Dataset (`FIXTURE_VERSION r02-1`, mulberry32 seed `0x0f0f6e`, positional ids, byte-identical on every machine):**
  50 authors · 100 tags · 200 media documents (metadata) · 2,000 posts (`drafts: true`, every 10th a draft; unique slug; unique
  `rank` permutation; 8 categories; `views`; `featured`; indexes on `category` and `rank`) with 1 author, 3 tags and 1 cover each.
  Sizes were chosen after reading the algorithms: population is one `id in (…)` query per relation field and the hard page
  maximum is 500, so 2,000 posts × 3 relation fields is large enough that an N+1, a per-row loop or accidental full-table work
  would show in call counts and timings, and small enough to load in <1 s and measure in <30 s.
- **Measured:** query (first page, deep page at offset 1,500, filtered, nested and/or, three-field sort), count (the _same_
  predicates as the finds — parity is asserted), population (depth-1 pages of 50 and 500, `findByID`), the admin's HTTP list
  (`handleList` with an admin token: page, filter+sort, the largest accepted 4 KB `where`, an over-deep `where` rejected with zero
  calls), upload (the real multipart `handleCreate`, 64 KiB fixed payload, then: one owning document, correct `filename`/
  `contentType`/`filesize`, one stored object per document, **no storage intent left**), memory (RSS/heap at start, after load,
  and after six repeated workload rounds with an explicit GC before each reading), and admin list rendering (the published
  `ForgeCollectionWorkspaceComponent` under Angular TestBed + jsdom — Angular work, not browser paint — for 50 and 500 rows).
- **Database calls** are counted at the `DatabaseAdapter` boundary by a test-only Proxy; Forge ships no telemetry for this.
- **Latency:** 20 warm-ups then 200 timed iterations (60 for 500-row pages, 100 for uploads, 25/8 for renders) on
  `performance.now()`; p50, p95, max and mean (nearest-rank percentiles).
- **Bundle size** (`scripts/quality/bundle-size.mjs`): packs the workspace, installs the two R01 packed consumers (the SDK-only
  technical SSR app and the tiny-project app with the reusable admin) from the tarballs, builds them **for production** and
  measures the real browser output: total/initial JS, gzip and brotli, the largest initial chunk, and the admin's lazy route chunk
  (found by a label string that survives minification). The same builds still run R01's server-marker/secret/unlinked-declaration
  scans first. The measurement hooks are opt-in (`FORGE_BUNDLE_REPORT`), so the certification runs are unchanged.
- **Budgets** (`scripts/quality/performance-budgets.json`) were written **after** three measured runs. Every metric records its
  baseline, budget, hard/report gate, rationale and environment sensitivity (Outcome → _Budgets_). Deterministic algorithmic
  metrics (database calls, DOM nodes, bundle bytes, scaling shape) hard-gate; wall-clock figures are report-only until CI
  repeatability proves otherwise; memory gates on the heap (stable after GC) and only ceilings RSS, which the native driver moves
  up and down independent of Forge. `pnpm test:performance` runs the fixture, the bundle build and the judge
  (`judge.mjs`, unit-tested) and exits non-zero on a hard violation.
- **Algorithmic regressions fail ordinary `pnpm test`** too: `packages/runtime/src/query-work-bounds.test.ts` pins the batching
  invariant (a depth-1 page costs the same calls for 10, 50 and 100 rows while its distinct targets fit one chunk, and ⌈distinct/80⌉ lookups beyond; each lookup is a single de-duplicated `id in (…)`; a
  relation cycle does not recurse; find and count receive the identical predicate), and bounded-work rules (structurally invalid
  queries reach **zero** database calls; the deepest legal nesting, a 2,000-wide `or` and a 200-field sort each cost exactly a page
  query + a count; an over-long `where`, an over-large `limit`, or a bad `offset` never reach the database over HTTP; the largest
  legal page is 500 rows). A temporary per-id population loop made four of these fail, then was reverted.

### 7. CI

A new required job **`reliability`** ("Reliability · Coverage · Performance") runs in parallel with `checks` and `certify`:
build → `pnpm test:coverage` → `pnpm test:performance` → `pnpm test:stability --profile ci`, uploading the coverage summaries,
the performance results and the stability results (always). `release` now `needs: [checks, certify, reliability]` — no path
filter, so a package change cannot publish without it. `release:certify` (R01) stays independent and does **not** run R02;
for a release candidate both must pass on the same commit.

## Implementation plan

- [x] Verify release truth (CI, npm, GitHub) and reconcile R01 documentation
- [x] Honest per-package coverage tooling + the starting table
- [x] Critical-matrix audit and the missing focused evidence (core, auth, runtime, testing, storage, cloudflare)
- [x] Defects found: offset-without-limit; provider errors in logs
- [x] Theme flake: reproduce, root-cause, fix, repeat; CI retry policy
- [x] Performance fixture, database-call accounting, N+1 / bounded-work regressions, bundle measurement, frozen budgets
- [x] Stability runner; `reliability` CI job; `release` dependency
- [x] Changeset; STATE / ROADMAP / 0.12 / spec 088 reconciliation; website version
- [x] Full CI-equivalent validation, PR #91

## Test plan

`pnpm test:coverage`, `pnpm test:performance`, `pnpm test:stability`, `pnpm test:scripts` (the gates' own tests), the per-package
suites touched, `pnpm test:cloudflare` / `pnpm test:libsql` (the new offset contract on workerd D1 and real libSQL), the full
CI-equivalent gate list in the Outcome.

## Acceptance criteria

The 62 numbered criteria of the R02 brief; each is mapped to its evidence in the Outcome.

## Open questions

None.

## Outcome

**Shipped (2026-10-10, PR #91):** per-package coverage gate (`pnpm test:coverage`), the fixed performance fixture with frozen
budgets (`pnpm test:performance`), the stability runner (`pnpm test:stability`), the required `reliability` CI job, the theme-flake
fix, ~140 new behavioural tests, and **three product defects found by measuring and fixed** (one patch changeset, no public API
change). R03 and R04 are not started; no release candidate was created; no remote or cloud action occurred.

### Release identity

| Item                                                    | Result                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Starting `main`                                         | `4daec40ab3f5145c2dd6a56918717f530457a5f9` (PR #90)                                                                                                                                                                                                                                                                                                                                                                                      |
| PR #89 (Version Packages)                               | merged `0d2f317`, 16:45Z; its own run was cancelled by the concurrency group when #90 landed                                                                                                                                                                                                                                                                                                                                             |
| Post-merge CI of #90 (`38069257116`)                    | ✓ checks · **certify** · changeset-check · **release** · both Pages deploys                                                                                                                                                                                                                                                                                                                                                              |
| `certify` of that run                                   | `0.13.0`, commit `4daec40…`, **sealed**, 11 tarballs, 323 s (consumers 6 · release 18 · compat 62 · ssr 18 · s3 110 · upgrade 34), Node `v22.23.3`, Garage `v2.4.1`                                                                                                                                                                                                                                                                      |
| Publication                                             | npm `latest` = `0.13.0` for all 11 packages (the dist-tag lagged for ~2 min: one package briefly read `0.12.1`); GitHub has the 11 `@forge-cms/*@0.13.0` releases                                                                                                                                                                                                                                                                        |
| Registry vs CI-certified tarballs (same Linux platform) | 9 of 11 SHA-256 identical; `runtime` and `cloudflare` differ **only in the order of keys** inside the packed `package.json` dependency maps (verified by file diff — contents equal)                                                                                                                                                                                                                                                     |
| Website `CURRENT_FORGE_VERSION`                         | `0.13.0` (was `0.12.1`); the website roadmap list also showed 0.11 as "next" — corrected (0.11 complete, 0.12 next)                                                                                                                                                                                                                                                                                                                      |
| R01 documentation                                       | STATE / ROADMAP / 0.12 / spec 088 reconciled (a dated _Resolution_ block; the historical hashes stay as written)                                                                                                                                                                                                                                                                                                                         |
| `0.13.0` hashes (CI, `4daec40`)                         | core `e3bf5cd6…1377` · db `34609d99…82c8` · auth `b3c73705…52c5` · storage `f50b5a2d…d595` · s3 `c9aeec79…c375` · api `217dbad2…a7c` · runtime `2b47f54e…45b6` · cloudflare `4c01307a…f740` · angular `3baeb499…7c37` · admin `b2e8b712…7aed` · testing `5fa12743…c3cb` (full values in the CI `certification-result` artifact)                                                                                                          |
| This branch re-certified (`release:certify`, local)     | `430bf68` ✓ 241 s, then the final code `6722633b9c5523f97e744474330de93a11c8911d` ✓ 237 s, version `0.13.0`, sealed, clean tree, all six stages passed. Tarball hashes differ from CI's because of tar-header differences between macOS and Linux **and** because `runtime`/`db`/`cloudflare`/`testing` carry the fixes; the seven unchanged packages' **contents are byte-identical to the published `0.13.0`** (extracted and diffed). |

Final-tree local hashes (macOS arm64; for the record, not a registry claim): core `acea9724…39f2` · db `16864bea…6732` · auth
`132a7bb9…9eefc7` · storage `d0057814…a974` · s3 `2e5f67d6…cdcd` · api `d32a6ffa…dfe9c` · runtime `9cca7b59…7d8e53` ·
cloudflare `99d5aec1…5a43` · angular `d564f8ab…7e57` · admin `d2ee9e3e…9ab6` · testing `97c66c7d…c54`. (`auth` changed hash between
two runs with no source change — the same packed-`package.json` key-order effect.)

### Coverage

**Tooling.** `scripts/quality/{coverage-release,coverage-lib,vitest.coverage.config}.mjs` + `coverage-floors.json`; outputs
`coverage/packages.json`, `summary.md`, `files.json` (per file), `uncovered.md` (uncovered lines per file) — gitignored, uploaded by
CI. HTML was not generated (no new dependency; `uncovered.md` is the human-readable diagnostic). ~18 s locally, 62 s on CI.

**Attribution defects found and fixed:** (1) `@forge-cms/testing` read **0.08 / 0.8 / 0.36 / 0.08** because the contract suites
run its built `dist`; now source-aliased → 98.9 / 87.0 / 97.7 / 99.5. (2) The root run could not execute the Angular suites at all
(16 files / 93 tests failed without the Angular transform), so the old global number was unreproducible; coverage is now per
package in each package's own environment. (3) `*.test-helpers.ts` (build-excluded) were being counted in admin. (4) Cloudflare
**workerd** suites cannot produce V8 coverage (documented caveat: cloudflare's figure is a lower bound).

**Starting per-package table** (honest, source-attributed, before any R02 test; statements / branches / functions / lines %):

| Package    | Class  | Stmts | Branch | Funcs | Lines | vs floor                                  |
| ---------- | ------ | ----: | -----: | ----: | ----: | ----------------------------------------- |
| core       | non-UI | 81.92 |  82.52 | 72.55 | 81.89 | **below all four**                        |
| db         | non-UI | 93.58 |  87.14 | 95.21 | 95.55 | ok                                        |
| auth       | non-UI | 84.84 |  81.08 | 86.23 | 86.41 | **below all four**                        |
| storage    | non-UI | 95.24 |    100 |    80 | 94.74 | **functions**                             |
| s3         | non-UI | 98.61 |  98.41 |   100 |   100 | ok                                        |
| api        | non-UI |   100 |    100 |   100 |   100 | ok                                        |
| runtime    | non-UI | 89.78 |  83.85 | 94.43 | 91.49 | **statements, branches**                  |
| cloudflare | non-UI | 94.79 |  84.86 | 93.75 | 96.71 | **branches** (workerd suites not counted) |
| testing    | non-UI | 98.21 |  79.92 | 97.64 | 99.13 | **branches** (after attribution fix)      |
| angular    | UI     | 93.88 |  90.15 |  94.7 | 95.02 | ok                                        |
| admin      | UI     | 98.07 |   93.6 |  97.3 | 98.59 | ok                                        |

(Old recorded baseline for context: global 66.8 / 70.3 / 59.4 / 67.3 on 2026-09-18, thresholds 60/64/50/60.)

**Gap classification (significant gaps).** _Critical promised behaviour:_ core slug/email/select/json/localized/array-row/blocks
validation and unknown-field rejection; auth managed-delete guard + last-admin on the guarded path + fail-closed uninitialised
adapters; runtime upload size/MIME rejection, version routes, global auth, query bounds; row-scoped delete race; D1 `OFFSET` path.
_Useful behavioural:_ locale fallback, cascade cycles, many-relation orphans, cookie parsing, API-key edge cases, R2 `head`, D1
fail-closed. _Defensive/impossible:_ the single justified exclusion below. _Pure type/declaration:_ none counted (`.d.ts` excluded).
_Integration-environment attribution:_ testing contracts; cloudflare workerd. _Still uncovered after the work, deliberately left:_
admin `analytics-dashboard.component.ts` (a useful behavioural gap in a non-matrix feature, owner: post-1.0 backlog — the admin
package still passes its floor with it included), `vite-linker.ts` browser-error branches (covered by the packed compat/consumer
builds, not by unit tests).

**Final per-package table** (CI run `38074330019` = local; full run, 11 packages, every one passes its class floor):

| Package    | Class  | Stmts | Branch | Funcs | Lines | Floor (s/b/f/l) |
| ---------- | ------ | ----: | -----: | ----: | ----: | --------------- |
| core       | non-UI | 99.26 |  99.03 |   100 | 99.62 | 90/85/90/90     |
| db         | non-UI | 93.81 |  87.42 | 95.22 | 95.81 | 90/85/90/90     |
| auth       | non-UI | 96.43 |  93.69 |  91.3 | 96.69 | 90/85/90/90     |
| storage    | non-UI |   100 |    100 |   100 |   100 | 90/85/90/90     |
| s3         | non-UI | 98.61 |  98.41 |   100 |   100 | 90/85/90/90     |
| api        | non-UI |   100 |    100 |   100 |   100 | 90/85/90/90     |
| runtime    | non-UI | 94.09 |   88.3 | 96.21 | 95.75 | 90/85/90/90     |
| cloudflare | non-UI |  96.3 |  87.27 | 94.79 | 97.82 | 90/85/90/90     |
| testing    | non-UI |  98.9 |  86.98 | 97.67 | 99.52 | 90/85/90/90     |
| angular    | UI     | 93.88 |  90.15 |  94.7 | 95.02 | 85/80/85/85     |
| admin      | UI     | 98.07 |   93.6 |  97.3 | 98.59 | 85/80/85/85     |

`testing`'s function figure varies by ≈0.2 points between runs (which racer wins decides which side's arrow function runs); its
margin to the floor is >7 points on every metric, so this cannot flake the gate. Environments per package are in
`coverage-floors.json` and the artifact.

**Tests added (exact files).** core `validation-boundaries.test.ts` (12) · auth `managed-delete-and-edges.test.ts` (31) · runtime
`handlers-boundaries.test.ts` (28), `fault-and-fallback-edges.test.ts` (11), `log-redaction.test.ts` (6), `query-work-bounds.test.ts`
(14), `offset-pagination.libsql.test.ts` (1) · testing `contracts/harness.test.ts` (11) + a shared-contract case in
`contracts/database.ts` (offset paging, run by InMemory, libSQL, the D1 mock **and workerd D1**) · storage `index.test.ts` (+1) ·
cloudflare `d1.adapter.test.ts` (+2), `r2.adapter.test.ts` (+2), `test/workers/population-bound-parameters.test.ts` (+1 on workerd)
· `scripts/quality-gates.test.mjs` (12, the gates' own tests) · `apps/performance-baseline/test/dataset.test.ts` (3).

**Justified unreachable branch (the only one).** `packages/core/src/validation.ts`, `case 'json'`: `if (value === undefined)` —
`validateField` returns earlier for `undefined`/`null` (`if (value === undefined || value === null) return errors`), so the arm
cannot run. It was **not** excluded from coverage (the percentage is simply 99.03% rather than 100%); it is documented here. No
security or data-integrity branch was waived anywhere.

### Critical behaviour matrix (audit)

Every row below has positive **and** negative evidence; ★ marks evidence added by this spec.

| Capability             | Evidence                                                                                                                                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CRUD / validation      | core `validation.test.ts`, ★`validation-boundaries.test.ts`; runtime `defaults.test.ts`, `unique-constraints.test.ts`, `operations.test.ts`, `handlers.test.ts`; db constraint contract (duplicate, missing id, partial update, null vs omitted)         |
| Query / count          | testing `contracts/database.ts` (operators, nested and/or, multi-sort, ★offset), db `where.test.ts`; ★runtime `handlers-boundaries.test.ts` (16 malformed forms → 400, zero reads), ★`query-work-bounds.test.ts` (list/count one predicate)              |
| Access                 | runtime `write-access.test.ts`, `field-access.test.ts`, `operations.test.ts`, contracts `write-access`; ★`handlers-boundaries.test.ts` (HTTP never honours caller `overrideAccess`/`user`; Local API trusted default)                                    |
| Indirect reads         | runtime `populate.test.ts` (target access, drafts, hidden fields, missing target, depth), `localization.test.ts`, `storage-lifecycle.test.ts` (file ownership/denied reads); ★`fault-and-fallback-edges.test.ts` (locale fallback), ★population chunking |
| Auth                   | auth `users-collection.adapter.test.ts`, ★`managed-delete-and-edges.test.ts` (session revocation on password change/delete, expiry, API-key scopes, fail-closed), runtime `auth-abuse.test.ts` (adapter outage → 500 not 401), ★`log-redaction.test.ts`  |
| Provisioning           | auth `first-admin-provisioning.test.ts`, contracts `bootstrap`/`last-admin` (parallel first admin, last-admin races — libSQL and workerd D1), runtime `auth-managed-collection.test.ts` (signup cannot escalate), ★guarded-path last-admin               |
| Versions               | runtime `versions.test.ts`, `version-consistency.test.ts`, contracts `version-history` (concurrency, failure before/after write); ★`handlers-boundaries.test.ts` (list/get/restore auth + roles, forbidden restore leaves data/history unchanged)        |
| Relations              | runtime `relation-integrity.test.ts`, `relation-lifecycle.test.ts` + contract (restrict/cascade/set-null/fault injection); ★cascade cycle terminates, ★many-relation orphans, ★auth-managed delete guard                                                 |
| Globals / localization | runtime `globals.test.ts`, `global-lifecycle.test.ts`, contracts `global-lifecycle`/`locale-merge`; ★global access denial, ★write fault leaves value unchanged, ★unsupported locale rejected                                                             |
| Uploads                | runtime `storage-lifecycle.test.ts` (DB-after-object failure, object-delete failure, reconciliation), workers `storage-lifecycle.test.ts`; ★size/MIME/missing-part with nothing persisted; ★storage put/delete/read outage without leakage               |
| SDK                    | angular `transport.test.ts`, `api.service.test.ts`, `typed-client.test.ts`, tiny-project `wire-types.integration.test.ts` (custom URLs, error code/details, encoded ids, typed wire values)                                                              |
| SSR                    | tiny-project `ssr-isolation.integration.test.ts` (per-request identity), angular `transfer.test.ts`/`transfer-server.test.ts` (forwarded credential policy, hydration, no private transfer), packed `release:ssr`                                        |
| Admin                  | admin `*.reliability.test.ts` (failed save, dirty state, stale reads/writes), `*.accessibility.test.ts` (keyboard/focus/confirmation), tiny-project `golden-path.spec.ts` (role matrix, invalidated session)                                             |
| Upgrade                | db `migrations.test.ts`/`sqlite-migrations.test.ts`, contract `migrations` (interruption), upgrade-rehearsal `upgrade-*.test.ts`, `backup.test.ts` (corrupt/missing/over-existing restore refused)                                                       |

No CRITICAL row lacked evidence after the ★ additions.

### Deterministic fault and outage evidence

| Failure                           | Deterministic evidence                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| DB failure before commit          | ★`fault-and-fallback-edges.test.ts` (global write), runtime `version-consistency.test.ts`, workers `d1-failure-semantics.test.ts`     |
| Failure inside an atomic batch    | db `atomic-write.test.ts` + atomic contract (libSQL, D1 mock, workerd D1), contract fault injectors (`bootstrap`, relation lifecycle) |
| Storage put / delete failure      | `storage-lifecycle.test.ts`, ★`log-redaction.test.ts` (both, plus compensation + intent kept)                                         |
| Migration interruption            | contract `migrations` (held mid-run), db `sqlite-migrations.test.ts`, workers `migrations.test.ts`, upgrade rehearsal                 |
| Auth adapter / dependency failure | runtime `auth-abuse.test.ts`, ★`log-redaction.test.ts`, ★global route fault → 500                                                     |
| Stale / concurrent write          | contracts `write-access`, `version-history`, `last-admin`, `global-lifecycle`, `locale-merge`; ★row-scoped delete race (409 / 404)    |
| Provider outage during file read  | ★`log-redaction.test.ts` (generic 500)                                                                                                |
| Failed restore verification       | upgrade-rehearsal `backup.test.ts` (corrupt object/db, deleted object, missing reference, refuses to restore over existing)           |

### Secret and internal-error leakage

Markers `FORGE_R02_AUTH_SECRET_DO_NOT_LOG`, `FORGE_R02_S3_SECRET_DO_NOT_LOG`, `FORGE_R02_TOKEN_DO_NOT_LOG` (in messages and in
`$metadata`/`config` properties) across six failure paths (§5). **Before the fix 3 of 6 failed** (the database-read and
storage-put paths logged the whole provider error with its message, properties and stack; the cleanup path logged the provider
message). After: none of the markers appears in any response body, Forge logger call or `console.*`; responses are the generic
`INTERNAL_ERROR` envelope; nothing persisted. The R01 browser-bundle scan still runs on both bundle builds. The `certify`
child-process stderr is not asserted (it never carries Forge runtime logs).

### Flakiness inventory

| ID  | Suite / test                                                                                                   | First observed                                  | Frequency                                                                                                                                        | Root cause                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Class                                                            | Fix                                                                                                                                                                                                                                                                | Post-fix evidence                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| F1  | `apps/www/e2e/theme.spec.ts` — "light/dark theme is consistent across Home, Demo and Docs and survives reload" | R01 (spec 088): 2 failures in 4 maintainer runs | R02 reproduction: **1/40** (4 workers), **9/200** under 8 workers (8 light, 1 dark); every failure `Received: ""` for `.forge-header` background | Each page component (landing/demo/docs) renders **its own** `forge-cms-header`. After clicking a nav link the test polled `.forge-public` (in light mode the page being left already matches, so the poll passed immediately) and then read `.forge-header` through a separate locator; a route change detaches the old header, and `getComputedStyle` of a detached node is `''`. A held handle to the old header proves it: `isConnected:false`, bg `''`; the fresh header has `rgb(247, 249, 252)`. | **Test bug** (observation race); the app renders the right theme | One atomic in-page snapshot `{path, header, page}` polled with `expect.poll` until it equals the destination's expected values (also asserts the destination URL and re-checks after reload — stricter than before). No `waitForTimeout`, retry or timeout change. | **0/200** under the same 8-worker load; 0/80 and 0/200 again inside the stability runs (local and CI) |
| F2  | CI Playwright `retries: 2` in www/tiny-project/demo (`1` for www prod)                                         | by inspection                                   | n/a                                                                                                                                              | A retry turns a first-attempt failure green without any record in the job result.                                                                                                                                                                                                                                                                                                                                                                                                                      | **Process defect**                                               | `failOnFlakyTests: !!process.env.CI` in all four configs: retries still capture traces, but a test that needed one fails the job.                                                                                                                                  | covered by the unit-free config change; every CI stability run is retries-off                         |

No other intermittent test was encountered in any run (all numbers below). No unexplained flaky critical path remains.

**Repeated isolated runs (retries OFF, fresh process per run, first-attempt result):**

| Journey                                                       | Local full sample                      | Local CI-profile | CI (ubuntu-latest, run `38074330019`) |
| ------------------------------------------------------------- | -------------------------------------- | ---------------- | ------------------------------------- |
| www theme (the formerly flaky test, light + dark)             | 200 executions (8 workers), 0 failures | 80, 0 failures   | 80, 0 failures                        |
| apps/www e2e (41 tests)                                       | 3 runs, 0 failures                     | 2, 0             | 2, 0                                  |
| tiny-project admin/auth/content (27 tests)                    | 5 runs, 0 failures                     | 3, 0             | 3, 0                                  |
| demo-aesthetics (32 tests)                                    | 3 runs, 0 failures                     | 2, 0             | 2, 0                                  |
| packed production SSR consumer (hydration in Chromium)        | 3 runs, 0 failures                     | 2, 0             | 2, 0                                  |
| local workerd + D1 + R2 (`test:cloudflare --force`)           | 3 runs, 0 failures                     | 2, 0             | 2, 0                                  |
| on-disk libSQL profile                                        | 3 runs, 0 failures                     | 2, 0             | 2, 0                                  |
| Node+libSQL+S3 and workerd+D1+R2 production journeys (Docker) | 2 runs, 0 failures                     | —                | in `certify` (once per run)           |

Sample sizes were chosen from suite duration (28 s … 90 s), the F1 failure rate (≈1–4.5% → 100 repeats of the two affected
tests makes a 2.5% mode miss with probability <1%), and risk. A first local `cloudflare-local` sample was discarded because
Turbo replayed its cache for runs 2–3 (0.3 s); the runner now passes `--force` and the three runs were redone (≈10 s each, real).
Plus: `release:certify` ran three times in this packet (CI `38074330019`, local `430bf68`, local `6722633`) — all certified.

### Performance

**Fixture.** `apps/performance-baseline` (private): `FIXTURE_VERSION r02-1`, seed `0x0f0f6e`; 50 authors · 100 tags · 200 media ·
2,000 posts (1 author, 3 tags, 1 cover each; 200 drafts; indexes on `category` and `rank`); database = on-disk libSQL file;
storage = InMemory; built `dist` packages; baseline machine macOS (Darwin 25.6) arm64, Apple M4 (10 cores), Node `v22.23.1`; CI sample
GitHub `ubuntu-latest` 4 vCPU Xeon 6973P-C, Node `v22.23.3`. 20 warm-ups + 200 timed iterations (60 / 100 / 25 / 8 for the heavy
cases). Runtime ≈ 5 s measure + 40 s bundle build; **53 s** for the whole command locally, 95 s on CI.

**Database calls and latency** (calls are exact; latency p50 / p95 ms, macOS baseline → CI sample):

| Operation                                         | DB calls                                   | p50 / p95 (macOS)         | p50 / p95 (CI)            |
| ------------------------------------------------- | ------------------------------------------ | ------------------------- | ------------------------- |
| `find` first page (50, sort rank)                 | 2 (page + count)                           | 0.75 / 0.90               | 1.43 / 2.18               |
| `find` deep page (offset 1500)                    | 2                                          | 0.76 / 0.91               | 1.44 / 2.11               |
| `find` filtered (category AND featured)           | 2                                          | 0.84 / 1.00               | 1.68 / 2.33               |
| `find` nested and/or (3 levels)                   | 2                                          | 1.09 / 1.24               | 2.13 / 2.85               |
| `find` 3-field sort                               | 2                                          | 0.86 / 0.98               | 1.68 / 2.19               |
| `count` (filtered / nested — **same predicates**) | 1 / 1                                      | 0.06 / 0.06 · 0.25 / 0.25 | 0.07 / 0.12 · 0.36 / 0.41 |
| depth-1 page of 50                                | 5 (page + count + author + tags + cover)   | 1.5 / 1.7                 | 2.96 / 4.41               |
| depth-1 page of 500 (the hard maximum)            | 8 (= 5 + extra id chunks: tags 2, cover 3) | 8.5 / 8.8                 | 16.0 / 16.8               |
| `findByID` depth 1                                | 4 (read + 3 lookups)                       | 0.23 / 0.25               | 0.44 / 0.84               |
| HTTP admin list page (`handleList`, admin token)  | 2                                          | 0.85 / 1.02               | 1.81 / 2.52               |
| HTTP filtered list                                | 2                                          | 0.55 / 0.70               | 1.34 / 1.95               |
| HTTP largest accepted `where` (4 KB)              | 2                                          | 3.59 / 3.88               | 6.98 / 8.05               |
| HTTP over-deep `where` → 400                      | **0**                                      | 0.04 / 0.05               | 0.08 / 0.11               |
| Upload 64 KiB multipart (`handleCreate`)          | 2 (intent create + atomic batch)           | 0.95 / 1.12               | 4.50 / 5.64               |
| Admin list render, 50 rows (TestBed + jsdom)      | — (1,453 DOM nodes)                        | 53.9 / 88.8               | 140 / 178                 |
| Admin list render, 500 rows                       | — (14,053 DOM nodes)                       | 458 / 503                 | 1,170 / 1,427             |

Each measured operation's upload run also verified one owning document with correct `filename`/`contentType`/`filesize`, one stored
object per document and **zero** dangling storage intents.

**N+1 result.** None exists. Before this PR a depth-1 page cost `1 page + 1 count + 1 lookup per relation field` for any row
count. The fixture's invariant is asserted on pages of 10, 50 and 500: lookups = `1 + Σ ⌈distinct targets / 80⌉` per page (the
chunking is the D1 bound-parameter fix above). A deliberately seeded per-id population loop made the fixture fail (153 `findMany`
vs 46 expected) and four runtime tests fail; it was reverted. No optimization was needed or made; nothing was added for speed.

**Query-work bounds** (existing public limits, no new limit invented): `where` nesting ≤ 6 (7 → 400, zero calls); `where` param ≤
4096 chars; `limit` ≤ 500; invalid shapes/operators/sort/offset/depth/status → 400 with **zero** database calls; the deepest legal
nesting, a 2,000-wide `or` and a 200-field sort each cost exactly page + count; the largest accepted `where` costs 3.6 ms (7 ms CI).
Not a bound added: user-supplied `in` lists are capped only by the URL; on D1 a filter with >~95 values exceeds the platform's 100
bound parameters (see issue K3).

**Memory** (explicit GC before each reading; baseline machine): process start 101 MB RSS / 19 MB heap → fixture loaded 164 / 22 →
after 6 rounds of 160 mixed operations 396 / 25.4 MB; **heap growth over the last three rounds 0.0 MB** (CI 0.1). RSS climbs ~4
MB/round while the heap is flat; a bisect (raw adapter without Forge, then each runtime path) showed RSS moving up _and down_ by
tens of MB with no Forge code in the path — native libSQL/allocator behaviour — so RSS is only ceilinged. No production profiler.

**Bundle size** (production browser output of the R01 packed consumers; identical bytes on macOS and the Linux CI runner):

| Consumer                                       | Total JS (bytes / gzip / brotli) | Initial JS (bytes / gzip)  | Largest chunk |
| ---------------------------------------------- | -------------------------------- | -------------------------- | ------------- |
| SDK-only Analog SSR app (`@forge-cms/angular`) | 240,676 / 73,036 / 64,589        | 240,676 / 73,036 (1 file)  | 240,676       |
| tiny-project + reusable admin                  | 800,106 / 220,554 / 189,607      | 610,445 / 176,792 (1 file) | 610,445       |
| …the admin's lazy content-list route chunk     | 181,154 / 39,431 / 33,158        | not in the initial load    | —             |

The R01 server-marker scans (`@aws-sdk`, libSQL, adapters, `ForgeCmsRuntime`, secrets, unlinked declarations) run on the same builds
before measuring and still fail immediately, independent of any size budget.

**Budgets** (`scripts/quality/performance-budgets.json`, 67 metrics, **40 hard**, 27 report-only; frozen after three measured
runs; each entry carries baseline, budget, gate, rationale, sensitivity and, where applicable, the first CI observation):

| Class                         | Metrics                                                                                                                       | Budget rule (rationale)                                                                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database calls — hard         | 16 (every operation above + population over-bound = 0)                                                                        | **Exact** baseline. Machine-independent; any extra query fails.                                                                                                                     |
| DOM nodes — hard              | 2                                                                                                                             | baseline +10% (1,600 / 15,500): deterministic, template bloat is a review decision.                                                                                                 |
| Scaling shape — hard          | 4 (pop. 500÷50 = 5.6 → ≤12; deep÷first page = 1.0 → ≤5; nested÷first = 1.5 → ≤6; render 500÷50 = 8.6 → ≤20)                   | Ratios on one machine in one run (macOS vs CI differed ≤5%); fails super-linear behaviour, not machine speed.                                                                       |
| Heap — hard                   | growth ≤ 5 MB (baseline 0); used ≤ 100 MB (baseline 25.4, review 45)                                                          | Heap is stable after GC: a ≥10 KB/op leak or 4× the heap fails.                                                                                                                     |
| RSS — hard ceiling            | ≤ 1,024 MB (baseline 396, review 700)                                                                                         | Native allocator noise: only a gross ceiling.                                                                                                                                       |
| Bundle bytes — hard           | 8 (technical total/gzip; admin total/gzip/initial/largest-initial/route chunk bytes/gzip)                                     | baseline +5% rounded up to 1,000 B. Deterministic for a lockfile+toolchain; a dependency bump legitimately moves it and updates the number in its PR.                               |
| Latency ceilings — hard       | 7 p95 (first page ≤50 ms, nested ≤60, depth-1 page ≤100, admin list ≤50, 4 KB where ≤200, upload ≤120, render 50 rows ≤1,800) | **Release-blocker ceilings**: 20× (render 10×) the slowest observed p95. Not precision budgets; catch hangs/full scans only.                                                        |
| Latency p50/p95 — report-only | 27                                                                                                                            | One CI sample cannot prove repeatability and runner speed differs 2–5× from a laptop. Promote with CI history; algorithmic regressions are already caught by the exact gates above. |

Self-checks of the gates: `scripts/quality-gates.test.mjs` (a package one point under a floor fails; one package cannot rescue
another; +1 database call / +1 byte over / a leak / a worse ratio each fail; a missing hard metric fails; report-only never fails)
and two end-to-end mutations (seeded N+1 → `pnpm test:performance` red; the original restored).

### CI

New required job **`reliability`** (parallel to `checks` and `certify`): build → `pnpm test:coverage` → `pnpm test:performance` →
Playwright install → `pnpm test:stability --profile ci`; `release` `needs: [checks, certify, reliability]`, no path filter.
First run (`38074330019`): **checks 10m05s · certify 9m41s · reliability 15m01s** (build 1m23 · coverage 1m02 · performance 1m35
· stability 10m16); the slowest job is now `reliability` (15 min; `checks` was ≈14 min before R01 moved the packed verifiers out), so end-to-end CI time grows by about a minute. Uploaded (always):
`coverage-evidence` (`packages.json`, `summary.md`, `files.json`, `uncovered.md`), `performance-evidence`
(`summary.json`, `results.json`, `runtime.json`, `render.json`, `bundle.json` — fixture version, runtime/toolchain identity, metrics,
budget comparison; no credentials, no database/object contents), `stability-evidence` (`results.json` + Playwright
`test-results` on failure). `release:certify` does **not** run R02 and R02 does not run certification; at RC time both must be
green on the same commit.

### Validation (final tree, this branch)

| Command                                                                                                                                    | Result                                                                                   | Class                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------- |
| `pnpm format:check`                                                                                                                        | clean (only the maintainer's untracked local `.kilo/worktrees` is flagged; absent in CI) | newly executed                            |
| `pnpm lint` · `pnpm typecheck`                                                                                                             | 17 / 28 tasks ✓                                                                          | newly executed                            |
| `pnpm test`                                                                                                                                | 28 turbo tasks ✓ + `test:scripts` 44 ✓                                                   | newly executed                            |
| `pnpm build` · `pnpm check:api`                                                                                                            | ✓ · public surface unchanged                                                             | newly executed                            |
| `pnpm test:coverage`                                                                                                                       | all 11 pass (18 s)                                                                       | newly executed                            |
| `pnpm test:performance`                                                                                                                    | every hard budget holds (53 s)                                                           | newly executed                            |
| `pnpm test:stability` (full sample + CI profile)                                                                                           | 0 first-attempt failures                                                                 | newly executed                            |
| `pnpm test:cloudflare --force`                                                                                                             | 293 workerd tests ✓ (incl. offset contract + D1 population regression)                   | newly executed (forced)                   |
| `pnpm test:libsql`                                                                                                                         | ✓                                                                                        | newly executed                            |
| `release:certify` = consumers · release · compat · ssr · **test:s3** (adapter, lifecycle, consumer, recovery, profiles) · **test:upgrade** | CERTIFIED ×2 on this branch, ×1 on `4daec40` in CI                                       | newly executed (stages of one sealed run) |
| `pnpm e2e:www` · `e2e:www:prod` · `e2e:tiny-project` · `e2e:demo`                                                                          | 41 · 11 · 27 · 32 passed                                                                 | newly executed                            |
| CI run on the pushed branch                                                                                                                | see STATE.md (PR #91)                                                                    | CI                                        |

Not runnable / not applicable: remote Cloudflare or AWS (out of scope; R03); `pnpm release:verify|compat|ssr|consumers` and
`test:s3`/`test:upgrade` were executed as stages of `release:certify` rather than separately (same code, one sealed artifact
set). Cached Turbo output was never counted: `--force` was used for workers tests and the stability runner.

### Issues and their status

| ID  | Finding                                                                                                                                | Severity          | Status                                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1  | `?offset=N` with no `limit` → 500 on libSQL and D1 (InMemory served it)                                                                | medium            | **fixed** (adapters + shared contract + HTTP regression)                                                                                                                                          |
| K2  | Depth-1 population sent >100 bound parameters on D1 → 500 for pages referencing >100 distinct targets                                  | high (D1 profile) | **fixed** (chunked lookups; workerd regression fails without the fix)                                                                                                                             |
| K3  | A user-supplied `in` filter (or any single statement) with >~95 values exceeds D1's 100 bound parameters → 500 on the D1 profile       | medium            | **accepted non-blocking pre-1.0**, owner R03: verify on the authorised remote D1; options are a clean 400 or chunking in the D1 adapter. Not fixable inside R02 without inventing a public limit. |
| K4  | Provider errors reached logs                                                                                                           | medium            | **fixed**                                                                                                                                                                                         |
| K5  | Theme e2e flake                                                                                                                        | test              | **fixed** (F1)                                                                                                                                                                                    |
| K6  | CI retries could hide first-attempt failures                                                                                           | process           | **fixed** (F2)                                                                                                                                                                                    |
| K7  | Coverage attribution (`testing` ≈ 0%; root run could not run Angular suites)                                                           | tooling           | **fixed**                                                                                                                                                                                         |
| K8  | Cloudflare percentage excludes the workerd suites (V8 coverage unavailable in workerd)                                                 | low               | **accepted non-blocking**: documented lower bound; the workerd suites remain required evidence                                                                                                    |
| K9  | The root `vitest.config.ts` `include` is the implicit config of packages without their own                                             | low               | **accepted non-blocking**, owner maintainer: documented in the file; explicit per-package configs are a post-1.0 tidy                                                                             |
| K10 | Packed tarball hashes are reproducible only per platform; two packages' `package.json` dependency key order varies across environments | low               | **accepted non-blocking**: compare extracted contents, not hashes, across platforms (done here)                                                                                                   |
| K11 | `findOrphanedDocuments` performs one lookup per referenced id (O(rows × refs)); used by diagnostics/tests, not on a request path       | low               | **post-1.0 opportunity**, no budget/regression exists for it                                                                                                                                      |
| K12 | `analytics-dashboard.component.ts` (admin) 62% statements / 0% branches; vite-linker browser-error branches not unit-covered           | low               | **accepted non-blocking**, owner post-1.0 backlog (outside the critical matrix)                                                                                                                   |
| K13 | `apps/www` `handleFile` returns `{ error: string }` for 400 (not the `{ error: { code, message } }` envelope)                          | low               | **noted, not changed** (public-surface behaviour; address in a deliberate envelope review)                                                                                                        |

No critical or high issue remains open (K2 was high and is fixed).

### Package impact

No public API change (`pnpm check:api` ✓; `describeErrorForLog`, `POPULATE_ID_CHUNK` and the testing `harness` are internal).
Changeset `.changeset/measured-reliability-fixes.md`: **patch** for `runtime`, `db`, `cloudflare`, `testing` (fixed group → expected
`0.13.1`). Apps need none. Rerun of affected and downstream certification: done (`release:certify`, workerd, libSQL, e2e).

### Acceptance (R02 brief, items 1–62)

1–6 release/identity: see _Release identity_. 7–13 coverage: _Coverage_ tables, `coverage-floors.json`, templates stay on
rendered evidence. 14–19 critical branches and waivers: _Critical behaviour matrix_, one non-waived justified unreachable arm.
20–25 flake: F1/F2 and the run tables. 26–42 performance: _Performance_. 43–45 faults/leakage: those sections. 46–47 commands:
`pnpm test:coverage`, `pnpm test:performance`. 48–52 CI: _CI_. 53–55 no remote action, no speculative optimization, no
test-only API. 56 product fixes with regression + changeset: K1/K2/K4. 57–58 issues classified, no unexplained flake. 59 gates:
_Validation_. 60–62 docs: STATE/ROADMAP/0.12 updated; **R03 not implemented**.

**Remaining:** R03 (authorised staging; verify K3 on remote D1), R04 (guides + dossier), L01. Wall-clock gates can be promoted from
report-only once the CI artifacts show repeatability across several runs.
