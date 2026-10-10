# 089 — Measurable reliability and a performance baseline (roadmap 0.12 / R02)

- **Status:** in-progress
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
- [ ] Full CI-equivalent validation, PR

## Test plan

`pnpm test:coverage`, `pnpm test:performance`, `pnpm test:stability`, `pnpm test:scripts` (the gates' own tests), the per-package
suites touched, `pnpm test:cloudflare` / `pnpm test:libsql` (the new offset contract on workerd D1 and real libSQL), the full
CI-equivalent gate list in the Outcome.

## Acceptance criteria

The 62 numbered criteria of the R02 brief; each is mapped to its evidence in the Outcome.

## Open questions

None.

## Outcome

_Filled in at completion — see below._
