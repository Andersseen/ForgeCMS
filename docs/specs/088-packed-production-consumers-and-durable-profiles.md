# 088 — Certify packed production consumers and durable profiles (roadmap 0.12 / R01)

- **Status:** done (2026-10-10)
- **Author:** agent draft (implementation requested by the maintainer, 2026-10-10 — "spec 088 — roadmap 0.12 / R01"; per
  [SDD.md](../SDD.md) an explicit request to implement counts as approval)
- **Date:** 2026-10-10
- **Branch:** feature/spec-088-packed-candidate-certification
- **Affected packages/apps:** `scripts/` (certification tooling, existing verifiers), `.github/workflows/ci.yml`, docs.
  **No `packages/*` change, no changeset, no product feature** (the 1.0 surface is frozen by [spec 087](087-admin-reuse-and-1.0-surface-freeze.md)).

## Context / Why

0.5–0.11 added their own packed gates one by one: `release:verify` (spec 059/076), `release:compat` (077), `release:ssr`
(078/080/081), `test:s3` (082–084) and `test:upgrade` (073). Each runs its own `pnpm pack`, so two gates in one CI run could
in principle certify two different trees, and nothing records _which_ bytes were certified. R01 is the first 0.12 packet: it
does not add product behaviour, it proves that **one exact set of tarballs from one recorded commit** works for clean
external consumers on every supported profile, and leaves reusable evidence for R02–R04 and L01.

## Goal

One exact set of ForgeCMS package tarballs produced from one recorded commit can be installed by clean external consumers
with strict dependency resolution and no workspace/private imports; a server-only consumer, an Angular/Analog admin
consumer, and both durable production profiles build and run using those public artifacts, while package/subpath exports,
peer compatibility, SSR/hydration, auth, CRUD, uploads, restart persistence and recovery evidence remain green.

## Non-goals

No new public feature, field type, admin redesign, database or storage provider; no remote Cloudflare deploy or AWS test; no
R02 coverage thresholds or performance work; no R03 staging; no R04 documentation rewrite; no 1.0 RC; no dependency upgrade
merely because a newer version exists. Not a rewrite of any existing verifier: the lower-level suites stay authoritative.

## Evidence inventory (before changes)

| R01 requirement                                         | Existing evidence                                                                                                                | Gap closed by this spec                                                                                       |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Packed manifests: no `workspace:*`, files, versions     | `release:verify` (`assertNoWorkspaceProtocols`, `assertPackedContents`, aligned versions, S3/angular boundaries)                 | exports targets in tarball, internal dep == family version, no `src/` target — now shared by every consumer   |
| One artifact set, hashes, manifest                      | none — **each of 3 verifiers ran its own `pnpm pack`**                                                                           | `scripts/certification/artifacts.mjs`: pack once, SHA-256, `artifacts.json`, hash-checked reuse (§Design 1)   |
| Runtime/S3/Cloudflare/upgrade/Angular package consumers | `release:verify` (runtime, S3, Cloudflare, upgrade, Angular, typed Angular)                                                      | —                                                                                                             |
| Server-only consumer without Angular/admin              | `release:verify` runtime consumer installs core/db/auth/storage/runtime (but never asserted the _absence_ of frontend packages)  | `release:consumers` server-only: absence asserted, first admin + `overrideAccess:false` + relation + denials  |
| Roots of all 11 packages + 4 retained subpaths          | `check:api` (source `dist/*.d.ts`, **not** the tarballs); compat/SSR import angular/admin/vite subpaths                          | every baseline symbol type-checked from the packed declarations; exports maps resolved; Node-safe entries run |
| Browser/server boundary of packed JS                    | angular `assertTypeOnlyCoreDependency`, S3 boundary                                                                              | angular (minus `/server`) + admin dist import no `node:`/server/private paths; admin embeds no `/api/*`       |
| Strict peer matrix (min/current/latest, Angular 22)     | `release:compat` (also the `/studio` mount, custom bases, `ngc`, linker, one Angular/RxJS/CDK tree)                              | consumes the certified set; clean-consumer scan                                                               |
| Technical SSR / hydration / identity                    | `release:ssr` technical (S01/S02)                                                                                                | consumes the certified set                                                                                    |
| Node + libSQL + S3 / workerd + D1 + R2 browser journeys | `test:s3 profiles` → `release:ssr journey` (S03/P03: bootstrap → publish → SSR → hydrate → upload → restart → delete, `/studio`) | consumes the certified set; browser-bundle scan extended (§Design 4)                                          |
| S3 isolated recovery; historical upgrade                | `test:s3 recovery`, `test:upgrade` (M03/P03)                                                                                     | forced (never a Turbo cache hit) inside the certification                                                     |
| No workspace aliases / private imports in consumers     | portable consumer's import scan only                                                                                             | `assertCleanConsumer` before every generated consumer installs                                                |
| One reproducible entry point; real CI gate              | five separate CI steps in one 25-minute job                                                                                      | `pnpm release:certify` + its own required CI job that `release` needs                                         |

## Design

### 1. One artifact set (`scripts/certification/artifacts.mjs`)

- `PUBLIC_PACKAGES` (the eleven), `RETAINED_SUBPATHS` (`@forge-cms/angular/server`, `/vite`, `@forge-cms/admin/vite`,
  `@forge-cms/testing/contracts`).
- `packArtifacts(dir)` runs `pnpm --filter <pkg> pack` once per package, reads the packed `package.json` and file list,
  runs `inspectPackedPackage` (aligned family version, `type: module`, no `workspace:`/`catalog:`/`link:`/`file:` ranges,
  internal `@forge-cms/*` ranges equal the family version, every `exports` target present and not under `src/`, README,
  no `src/`/tsconfig shipped, no `packages/` in resolution-relevant keys) and writes `artifacts.json`: commit, dirty flag,
  version, Node/pnpm/platform/arch, timestamp, and per package name · version · file · SHA-256 · bytes · `exports` ·
  internal deps · peers. Nothing secret and no host path is written.
- `resolveArtifacts` / `resolveTarballs` replace every private `pnpm pack`: with `FORGE_CERT_ARTIFACTS=<dir>` the verifier
  loads that manifest and **re-hashes every tarball on every load** (a changed or missing file throws); without it the
  verifier packs once into its own temp dir through the same code, so every standalone command keeps working.
- Generated tarballs and results live in the gitignored `.certification/`; nothing binary is committed.

### 2. Clean-consumer scan

`assertCleanConsumer(dir)` runs before `pnpm install` in every generated consumer (server-only, entry points, compat
matrix, technical SSR, journey): no `workspace:`/`link:` ranges, `@forge-cms/*` dependencies only as tarballs, no
`tsconfig` `paths` alias for Forge, no `../packages/…`/`packages/*/src` reach-in, and no `@forge-cms/*/…` import other than
the four retained subpaths.

### 3. `pnpm release:consumers` (`scripts/verify-public-consumers.mjs`)

- **Server-only:** installs only core · db · auth · storage · api · runtime (+ TypeScript, `@types/node`), with strict peers.
  Asserts the pnpm store has no `@angular/*`, `@voltui/*`, `lumen-icons`, `rxjs`, `zone.js`, `@forge-cms/angular` or
  `@forge-cms/admin`; compiles with strict `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`; the built Node output
  creates the first admin through `UsersCollectionAuthAdapter`, signs in, performs CRUD with `overrideAccess: false`,
  reads a relation with `depth: 1` (no `passwordHash`/`_sessionVersion`/password in the result), and proves anonymous and
  unprivileged writes/deletes are denied (401/403). In-memory by design — durability is proven by the profiles.
- **Entry points:** installs all eleven tarballs with their real peers (strict, no auto-install). One generated module per
  entry point does `import type { …every name of api-baseline/<entry>.json… }` so each packed declaration exports exactly
  the frozen surface; `import.meta.resolve` proves all fifteen specifiers resolve through the exports maps into
  `node_modules` (never `src/`); the Node-safe entries (nine roots/subpaths + both `vite` plugins) are `import()`ed. The
  packed JavaScript of `@forge-cms/angular` (excluding `server`) and `@forge-cms/admin` may import no `node:`/server/DB/S3
  package; admin embeds no `/api/v1` or `/api/auth` literal (comments excluded).

### 4. Bundle security (journey)

The browser-bundle marker list of the production journey is extended with `passwordHash`, `_sessionVersion`,
`UsersCollectionAuthAdapter`, any `packages/*/src` path, and the _live_ S3 access key id and secret of the running Garage.
Existing markers (`AUTH_SECRET`, `DATABASE_URL`, `@libsql`, `LibSqlDatabaseAdapter`, `D1DatabaseAdapter`, `R2StorageAdapter`,
`S3StorageAdapter`, `@aws-sdk`, `ForgeCmsRuntime`, …) stay.

### 5. `pnpm release:certify` (`scripts/release-certify.mjs`)

preflight (Node ≥ 22; the tree must be clean unless `--allow-dirty`, which makes the result `not-certifying`; Docker is
required) → forced `turbo build` → pack once → stages `consumers · release · compat · ssr · s3 · upgrade`, each given
`FORGE_CERT_ARTIFACTS` → seal (hashes + git identity unchanged) → `certification-result.json`. `--stages` runs a subset and
exits 2 (`incomplete`). The result records commit/dirty, aligned version, toolchain, every tarball hash, stage outcomes and
durations. It states that the artifacts are local candidates, not the registry packages of the same version.

### 6. CI

A new required job `certify` runs `pnpm release:certify` (build, Chromium, Docker are all present on `ubuntu-latest`);
`release` now `needs: [checks, certify]`. The steps it subsumes (`release:verify`, `release:compat`, `release:ssr`,
`test:upgrade`, `test:s3`) leave `checks`, which keeps the fast/repository gates and the app e2e suites. No path filter:
it runs on every PR and push.

## Implementation plan

- [x] `scripts/certification/artifacts.mjs` + unit tests (`scripts/certification.test.mjs`)
- [x] route `release:verify`, `release:compat` and the SSR/portable verifiers through `resolveArtifacts`/`resolveTarballs`
- [x] `assertCleanConsumer` in every generated consumer
- [x] `scripts/verify-public-consumers.mjs` (`pnpm release:consumers`)
- [x] extend the journey browser-bundle markers
- [x] `scripts/release-certify.mjs` (`pnpm release:certify`)
- [x] CI: `certify` job; `release` needs it
- [x] full local certification on a clean committed tree; Outcome; STATE / ROADMAP / 0.12 updated

## Test plan

- Unit (`pnpm test:scripts`): `inspectPackedPackage` accepts a good manifest and rejects each defect class; `scanConsumerFile`;
  a certified set is hash-checked and never repacked; unknown/tampered artifacts throw.
- Integration: `pnpm release:consumers`, `pnpm release:verify`, `pnpm release:compat`, `pnpm release:ssr`, `pnpm test:s3`,
  `pnpm test:upgrade`, and all of them together through `pnpm release:certify`.
- Repository gates: format, lint, typecheck, test, build, `check:api`, `test:cloudflare`, `test:libsql`, the four e2e suites.

## Acceptance criteria

1. All eleven public packages are packed once from one tree; `artifacts.json` records commit, dirty flag, versions and SHA-256.
2. Versions are aligned, no unresolved protocol survives, and internal dependencies equal the family version.
3. Every root and retained subpath resolves from the tarballs; every frozen baseline symbol type-checks from them.
4. The server-only consumer installs without Angular/admin/VoltUI/lumen/CDK, compiles strictly and runs.
5. The strict Angular matrix, the `/studio` + custom-bases consumer and the SSR/hydration consumer pass on the same set.
6. Node + on-disk libSQL + Garage S3 and workerd + local D1 + local R2 profiles pass with restart persistence and upload/read/delete.
7. The historical upgrade rehearsal and the S3 isolated-recovery rehearsal pass.
8. No generated consumer uses a workspace/private shortcut; the browser bundle contains no server code or secret.
9. `pnpm release:certify` is one reproducible command, and CI requires it before `release`.
10. No `packages/*` change, no changeset, no remote resource, no coverage/performance scope.

## Open questions

None.

## Outcome

**Shipped (2026-10-10):** `pnpm release:certify` — one forced build, the eleven public packages packed **once**, hashed and
inspected (`artifacts.json`), the exact set handed to every packed verifier through `FORGE_CERT_ARTIFACTS`, then sealed.
Scripts, tests, CI and docs only: **no `packages/*` change, no public API change, no changeset.**

**Release truth.** Start: main `5714ab8` (PR #88); its post-merge CI `37940209740` ✓ success (the earlier push run
`37940034664` was cancelled by the concurrency group). Published/npm `latest`/GitHub `v0.12.1`. Version Packages PR
**#89** (U03 admin minor → expected `0.13.0`) is **open and unmerged** (its CI run was `action_required`), and the
`.changeset/admin-custom-mount-surface-freeze.md` changeset is still pending. Manifest versions are therefore `0.12.1`
**while the tree contains U03 code**: a local `0.12.1` tarball is _not_ the published npm `0.12.1`. Website
`CURRENT_FORGE_VERSION` stays `0.12.1` (published truth); `0.13.0` is not published. End: unchanged.

**Candidate identity.** Certified commit `cd0dcd705163a0232660f1719a12aa6447a2c6a0` (clean tree, `dirty: false`), manifest version `0.12.1`,
sealed `true`, outcome `certified`, 235 s on the maintainer machine
(macOS arm64, Colima). Tarballs (SHA-256, from `.certification/artifacts.json`, never committed):

| Package                 | Version | SHA-256                                                            |
| ----------------------- | ------- | ------------------------------------------------------------------ |
| `@forge-cms/core`       | 0.12.1  | `e61c91a379a610aeff9230a93301439d50d89c69de3a0afff07a015f3f4a8f88` |
| `@forge-cms/db`         | 0.12.1  | `172c654ff89ecda7c818c0f20438129f32f96109366499e16bed28b01272a805` |
| `@forge-cms/auth`       | 0.12.1  | `a2863de7d9ad4aa919422767e6d8aaeb0fe6aa8478a7f9f724d2462a8210fac6` |
| `@forge-cms/storage`    | 0.12.1  | `e292ed6c1921fb1218f9cdb83ad99b43212a4b8454d5c9207c72896c2e54f36f` |
| `@forge-cms/s3`         | 0.12.1  | `0c1a23e9907ea07f7df040b47282347d969a54e2f56915ef1af9506ae774e1ca` |
| `@forge-cms/api`        | 0.12.1  | `b2e036c222e3a26044aa1b43867f5120848233a91deb4b682a5cf4460d3a410c` |
| `@forge-cms/runtime`    | 0.12.1  | `90f21c7762dedd5e74b62ba87e2af62e2adbcb4424394f1c8674c1235e4ab41f` |
| `@forge-cms/cloudflare` | 0.12.1  | `706bb4a032294d7d47c7c92378bee121f57c23ed24accb1a5404f33d02fa62ef` |
| `@forge-cms/angular`    | 0.12.1  | `3fab9ea65e836f85d840de433bb6eccd8e526ce919265b054449d1df83486e27` |
| `@forge-cms/admin`      | 0.12.1  | `43d9de1b4947d29e528048a5fe5487efe62881c1ae2830c6e47915af59ca0726` |
| `@forge-cms/testing`    | 0.12.1  | `833e78d74969756f44e703a74b9abf61ccbeea149d259cff714380bfc5b76765` |

> **Pending gate:** the _identity_ gate for the `0.13.0` artifacts. U03 code is in this set but under the
> `0.12.1` name; once Version Packages #89 is merged by the maintainer, `pnpm release:certify` must be re-run on the
> versioned `0.13.0` tree (it is one command) and its hashes recorded for R02–R04/L01. This spec does not merge #89 or
> edit versions.

**Stages (one sealed set, local):** `consumers` 7 s · `release` 26 s · `compat` 56 s · `ssr` 16 s · `s3` 82 s · `upgrade` 19 s.

- **Manifests/exports:** all 11 packed manifests aligned at one version, no `workspace:`/`catalog:`/`link:`/`file:` range,
  internal deps equal the family version, every `exports` target in the tarball and none under `src/`.
- **Entry points:** 15 specifiers (11 roots + `@forge-cms/angular/server`, `/vite`, `@forge-cms/admin/vite`,
  `@forge-cms/testing/contracts`) resolve through the exports maps into `node_modules`; every symbol of `api-baseline/*.json`
  type-checks from the packed declarations; the 12 Node-safe entries import. Angular (minus `/server`) and admin dist import
  no `node:`/DB/S3/runtime package; admin embeds no `/api/v1`/`/api/auth` literal.
- **Server-only consumer:** core/db/auth/storage/api/runtime only; the pnpm store has no Angular/VoltUI/lumen/RxJS/zone/admin;
  strict `tsc`; built Node output creates the first admin, signs in, does CRUD with `overrideAccess:false`, reads a relation
  (no credential material), and anonymous + viewer writes/deletes are denied.
- **Strict peers (`release:compat`, unchanged matrix):** strict-peer-dependencies, no auto-install, one Angular/RxJS/CDK tree,
  tsc + ngc strict templates + linked production Vite build, `/studio` mount and custom bases compiled; Angular-only 22 case
  green. Versions exercised: Angular `21.2.10` (current), the min/latest combinations resolved at run time and printed by
  the verifier, TypeScript `5.9.2`, RxJS `7.8.2`, CDK `21.2.10`, VoltUI
  `1.0.1`, lumen-icons `0.2.0`, Vite `7.1.4`, Analog `2.5.2`.
- **Technical SSR (S01/S02):** 45 concurrent anonymous/A/B renders isolated; one public transfer entry; 0 browser reads on
  the transferred resource; reload still fresh; failures not serialised; no `SERVER_ORIGIN_REQUIRED`.
- **Node + on-disk libSQL + S3 (Garage `v2.4.1@sha256:9c96caa2612d3411acc5b0e6701fb238dbfba33e533a6d7d3d811a4b12d0d020`):** packed, production-built tiny-project mounted at `/studio`
  (APIs `/api/content`, `/api/account`); bootstrap → draft → publish → no-JS SSR → hydrate (1 SSR read, 0 browser reads) →
  edit → restart (content, SSR, exact object bytes persist) → multipart upload → access-checked read → delete (document + object,
  no intents left). `@libsql/client` 0.17.3, Playwright 1.60.0.
- **Cloudflare (LOCAL workerd + local D1 + local R2 — not remote staging):** the same journey on the Pages output under
  `wrangler pages dev` (Wrangler 4.91.0); restart persists D1 rows and R2 bytes; delete works.
- **Recovery:** `test:upgrade` (historical fixtures → migrations → backup → isolated restore) and the `test:s3` recovery stage
  (cold libSQL backup → isolated empty bucket) pass, both forced, not Turbo cache hits.
- **Browser bundle/security:** the production journey bundles contain none of `AUTH_SECRET`, `DATABASE_URL`, the live S3
  key/secret, `@libsql`, adapter classes, `@aws-sdk`, `passwordHash`, `_sessionVersion`, `UsersCollectionAuthAdapter`,
  `packages/*/src`; fully linked (0 unlinked declarations).
- **Private-import scan:** `assertCleanConsumer` ran before every generated consumer (server-only, entry points, each compat
  combination, technical SSR, journey) — no workspace link, alias, `packages/` reach-in or non-retained deep import.
- **Packing:** exactly 11 `pnpm pack` invocations per certification (previously 3 verifiers × 3–10 packs); any later
  change to a tarball fails the load-time hash check and the final seal.

**Defects found.** None in `packages/*`. One tooling defect: `scripts/s3-fixture.mjs` bind-mounted its Garage config from the OS
temp dir, which Colima (and other VM-backed Docker setups) do not share, so the container exited and no port was published.
Fixed generically with `docker create` + `docker cp` + `docker start`; the adapter, lifecycle, consumer, recovery and
profiles stages all pass with it.

**Pre-existing flake (handed to R02, not fixed here).** `pnpm e2e:www` (`apps/www/e2e/theme.spec.ts`, "light theme is consistent
across Home, Demo and Docs and survives reload") failed intermittently on this machine — 2 failures in 4 runs, the other
2 runs 41/41 — reading an empty computed `.forge-header` background right after navigation. This branch changes nothing
under `apps/` or `packages/`, so it is not caused by R01; R02 owns flakiness classification.

**Repository gates (newly executed, `--force`, no Turbo cache hits):** lint + typecheck (43 tasks) ✓ · `turbo test` ✓ ·
`test:scripts` ✓ · `check:api` ✓ · `test:cloudflare` ✓ · `test:libsql` ✓ · `e2e:www:prod` ✓ · `e2e:tiny-project` ✓ ·
`e2e:demo` ✓ · `e2e:www` ✓ on rerun (see flake above) · `format:check` clean for every repository file.

**Public API / changeset.** None / no changeset (no published package changed). The 1.0 surface of spec 087 is intact
(`pnpm check:api` ✓).

**CI.** New required job `certify` (`pnpm release:certify`, 30-minute timeout, uploads `artifacts.json` +
`certification-result.json`); `release` needs `[checks, certify]`; the verifiers it subsumes left `checks`, so the two run in
parallel. The first CI wall-clock of both jobs is recorded in STATE.md after the PR run. Docker is required, never skipped.

**Evidence classes.** _Newly executed this session:_ `release:certify` (all six stages, forced), the repository gates listed in
STATE.md. _Cached:_ none counted. _Inherited:_ none. _Not runnable here:_ the `0.13.0` identity gate (pending #89), remote
Cloudflare/AWS (out of scope, R03).

**Remaining.** R02 (coverage floors, flakiness, fixed performance fixture/budgets), R03 (authorised remote staging, deployment
runbook), R04 (consumer docs + dossier), L01 (RC preparation); re-certify on the `0.13.0` tree. Certified: Garage `v2.4.1` only
(AWS/B2/Wasabi configurable, not certified); Node ≥ 22 engine, concrete tested Node `v22.23.1` locally and `.nvmrc` in CI.
