# 090 — Staging deployment and recovery rehearsal (roadmap 0.12 / R03)

- **Status:** in-progress — repository preparation complete; **remote staging gate pending explicit authorization** (2026-10-11)
- **Author:** agent draft (implementation requested by the maintainer, 2026-10-11 — "spec 090 — roadmap 0.12 / R03")
- **Date:** 2026-10-11
- **Branch:** feature/spec-090-staging-recovery-rehearsal
- **Affected packages/apps:** `scripts/staging/` (new, private tooling), `docs/STAGING-REHEARSAL.md`, `.gitignore`, docs; and — because
  R02's open finding K3 reproduced — `@forge-cms/cloudflare` and `@forge-cms/testing` (**patch**, one changeset, no public API change).

## Context / Why

R01 ([088](088-packed-production-consumers-and-durable-profiles.md)) certified the exact packed bytes and R02
([089](089-measurable-reliability-and-performance-baseline.md)) measured them; both ran against _local_ workerd and Garage. Neither proved that a
real Cloudflare account, real secret injection, a served HTTPS origin and real D1/R2 behave the same, or that a backup restores into resources
that are not the source. R02 also handed over finding **K3** (a long `in` filter exceeding D1's bound-parameter ceiling) for verification on
remote D1.

## Goal

One exact ForgeCMS candidate commit can be deployed to an authorized, isolated remote Cloudflare staging environment using D1 + R2 + a real
secret and served origin; auth, CSRF, SSR, content, uploads and persistence work over that origin; a quiesced remote backup can be restored into
separate empty remote D1/R2 targets and verified without touching production. The equivalent portable libSQL/S3 persistence/recovery procedure
remains reproducible.

## Non-goals

No production deployment or data access; no destructive test of existing data; no remote AWS; no new storage/database provider or migration
framework; no automatic startup migration; no Terraform/Pulumi; no R04 documentation rewrite; no RC; no new public API; no maintenance mode.

## Design

- **App:** `apps/tiny-project` (first admin from zero rows, `/studio`, uploads, fail-closed D1+R2 profile). `apps/www` and `apps/demo-aesthetics`
  are production projects and are never the target.
- **Isolation:** every resource is named `forge-cms-r03-*` ([manifest](../STAGING-REHEARSAL.md#names-all-start-with-forge-cms-r03-)).
  `scripts/staging/staging-lib.mjs` refuses production identifiers (`forge-cms`, `forge-cms-demo`, `forge-cms-demo-media`,
  `forge-cms-tiny-project`, the production D1 id), empty names, unprefixed names, source == target, non-https origins and production hosts.
- **Entry point:** `pnpm staging manifest|plan|run|verify|keys|compare`. `plan` and `verify` are read-only; `run … --apply` mutates and is a dry run
  without `--apply`. The AUTH_SECRET is generated per run, piped on stdin, never printed. Evidence goes to the gitignored `.staging/`.
- **R2 backup with metadata:** Wrangler 4.91 `r2 object get/put` carries content type but has no custom-metadata flag, so
  `scripts/staging/r2-copy-worker.mjs` (disposable Worker, `SOURCE`/`TARGET` R2 bindings, bearer token) copies bytes + `httpMetadata` +
  `customMetadata` and reports sha256/size per key. Keys come from the D1 snapshot (`keysFromSnapshotSql`), never from listing the bucket.
- **K3:** reproduced (below); fixed generically in the D1 adapter.

## Implementation plan

- [x] Verify release/main state; branch
- [x] Staging tooling + guards + unit tests; runbook
- [x] Reproduce K3 on local workerd D1; fix; contract + negative-control evidence; changeset
- [x] Local candidate gates
- [ ] **Remote gate (authorization required):** provision, deploy, journey, redeploy persistence, remote K3, backup, isolated restore, cleanup
- [ ] Mark R03 complete in STATE/ROADMAP/0.12 (only after the remote gate)

## Test plan

`node --test scripts/staging.test.mjs` (guards, manifest, key derivation from a snapshot, object comparison, R2 copy fidelity, origin verification
incl. leak detection); the shared query contract's long-`in` case on workerd D1 (`pnpm test:cloudflare`) and on InMemory/libSQL (`pnpm test`);
local profile fail-closed tests (`apps/tiny-project/src/tests/storage-selection.test.ts`); remote journey per the runbook.

## Acceptance criteria

1. Staging tooling refuses every production identifier and any source == target. ✔ (unit tests)
2. K3 is reproduced, fixed without a public limit and covered by a failing-before/passing-after regression. ✔ locally; remote confirmation pending
3. Local candidate gates green. ✔ (see Outcome)
4. Authorized remote staging passes health, first-admin, login/cookie/CSRF, content, R2, redeploy persistence, remote K3, logs. ⏳ pending
5. Quiesced remote backup restores into separate empty D1/R2 and verifies auth/content/files/ledger/reconciliation/write. ⏳ pending
6. Portable libSQL/S3 evidence stays green. ✔/⏳ see Outcome
7. R03 is marked complete only after 4–5. ⏳

## Outcome

**R03 is PREPARED — remote staging gate pending explicit authorization. It is not complete.** Nothing below claims remote success.

### Candidate

- Starting main `64322dd` (PR #91, spec 089 merge); main CI `38080646922` ✓ (all required jobs incl. Reliability · Coverage · Performance).
- Published: all eleven packages `0.13.0` on npm and GitHub; website `CURRENT_FORGE_VERSION = '0.13.0'`. PR #92 "Version Packages" (`0.13.1`, the R02
  fixes) is **open**, unmerged by this work. The source candidate contains the R02 fixes and this spec's K3 fix; the pending patch will fold in the
  new changeset `d1-long-in-lists.md`.
- Branch `feature/spec-089`-successor `feature/spec-090-staging-recovery-rehearsal`; the final commit and candidate SHA are recorded by the PR.

### Authorization

No remote staging authorization has been given in this session and Wrangler is not logged in (`wrangler whoami` fails to fetch a token). No remote
resource was created, read or modified.

### K3 (R02 finding) — reproduced, fixed

Local workerd D1 (the same bound-parameter ceiling): `GET /api/content/posts?title[in]=1,…,N` by an anonymous caller returned `200` for N = 80, 95, 99
and **`500 INTERNAL_ERROR` for N = 100, 120, 400** (the first hard failure is at 100 values, not ~95). This is a valid public query, so it is a
supported-profile defect. Fix (`@forge-cms/cloudflare`, patch): an `in` list of more than 50 values is sent as one JSON parameter —
`"col" IN (SELECT value FROM json_each(?))` — with unchanged set semantics, no truncation, no public limit, no extra statements; shorter lists are bound
exactly as before. Regression: the shared query contract gained "filters with a very long in list" (300 values, alone and combined with another
predicate); on workerd D1 it **fails without the fix** (`D1_ERROR: too many SQL variables`) and passes with it; InMemory and libSQL pass it too.
Remote D1 sizes (80/99/100/120/400) must still be run on the authorized staging database. No raw D1 text reaches clients (the runtime already returns
the generic `INTERNAL_ERROR`).

### Tooling evidence (local)

`scripts/staging.test.mjs`: 9 tests ✔ — production names refused, manifest/command confinement, no secret in argv, source ≠ target, snapshot key
derivation, object comparison, R2-copy fidelity (bytes/type/custom metadata/missing key), origin verification (https only, production hosts refused,
startup 500 and leaked internals detected). The `verify` checks were calibrated against a locally served production build of `apps/tiny-project`
(workerd D1 + R2): collections `200`, public posts `200`, anonymous `/api/account/me` `401`, unknown collection `404`, `/studio/login` and `/` `200`; and a
missing `AUTH_SECRET` fails every API route (fail-closed).

### Local gates on the branch (newly executed 2026-10-11 unless stated)

`pnpm format:check`, `lint`, `typecheck`, `test`, `build` (after `pnpm install`; `apps/performance-baseline` needed its dependencies), `check:api`,
`test:scripts`, `test:cloudflare` (workerd D1 + R2, incl. the new long-`in` case), `test:libsql`, `test:upgrade`, `test:coverage` (every package meets its
class floor), `test:performance` (budgets hold), `release:verify`, `release:compat`, `release:ssr`, `release:consumers`, `e2e:www:prod`: all ✔.
`test:stability` (retries off): www-e2e 3 runs, tiny-project 5, demo-aesthetics 3, packed SSR 3, cloudflare-local 3, libsql 3, theme 1 (100 reps) —
all clean except **durable-profiles-s3** (Docker is not running here → 2 first-attempt failures, environment) and **one www-e2e first-attempt failure**
(below). **Not runnable here:** `pnpm test:s3` and `pnpm release:certify` (both need Docker/Garage), so the R01 certification of this exact candidate and the
portable-profile evidence are **not re-established on this tree** — they remain inherited from main CI `38080646922` until CI or a Docker-enabled run
covers this branch. `e2e:www`, `e2e:tiny-project`, `e2e:demo` were executed inside the stability runner.

### Flakiness found (F5)

`apps/www/e2e/auth.spec.ts` "an anonymous visit to a protected route redirects to sign-in…": in one of three full-suite runs the page stayed on
`/admin/collections/posts` for the 5 s `toHaveURL` timeout. That stability run was ~2.5× slower than later runs (50–63 s vs 20–25 s per suite), i.e. the dev
server was under load. **Not reproduced:** 25/25 isolated repeats and 4/4 further full-suite runs with retries off passed. Status: **unexplained single
occurrence, suspected dev-server load; no change made** (no retry, no longer timeout). It is a dev-server test of the www admin guard, not a package
behaviour; it must be watched in CI and, if it recurs, root-caused before R03 is accepted.

### Remaining (blocked on authorization)

Everything under acceptance criteria 4–5: Pages project, D1, R2, secret, deploy, real-origin journey, redeploy persistence, remote K3 sizes, remote logs,
quiesced export, metadata-preserving R2 copy, isolated restore and verification, cleanup decision.

### Limits

No atomic D1 + R2 snapshot, no maintenance mode (quiescence is operational), staging is not production traffic, local workerd evidence never
substitutes for the remote gate, only Garage v2.4.1 is a certified S3 service.
