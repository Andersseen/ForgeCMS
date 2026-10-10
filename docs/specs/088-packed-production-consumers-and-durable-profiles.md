# 088 — Certify packed production consumers and durable profiles (roadmap 0.12 / R01)

- **Status:** in-progress
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
- [ ] CI: `certify` job; `release` needs it
- [ ] full local certification on a clean committed tree; Outcome; STATE / ROADMAP / 0.12 updated

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

_To be filled when the certification run on the final committed tree is complete._
