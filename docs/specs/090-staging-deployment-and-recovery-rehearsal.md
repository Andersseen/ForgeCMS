# 090 — Staging deployment and recovery rehearsal (roadmap 0.12 / R03)

- **Status:** complete — remote staging + isolated restore executed and passed on 2026-10-12 (with the caveats recorded in the Outcome); preparation 2026-10-11
- **Author:** agent draft (implementation requested by the maintainer, 2026-10-11 — "spec 090 — roadmap 0.12 / R03")
- **Date:** 2026-10-11
- **Branch:** feature/spec-090-staging-recovery-rehearsal (preparation, PR #93); feature/spec-090-remote-staging-closeout (remote closeout)
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
2. K3 is reproduced, fixed without a public limit and covered by a failing-before/passing-after regression. ✔ locally and remotely (80/99/100/120/400 → 200 on the real staging D1)
3. Local candidate gates green. ✔ (see Outcome)
4. Authorized remote staging passes health, first-admin, login/cookie/CSRF, content, R2, redeploy persistence, remote K3, logs. ✔ (browser form sign-in not driven; see caveats)
5. Quiesced remote backup restores into separate empty D1/R2 and verifies auth/content/files/ledger/reconciliation/write. ✔
6. Portable libSQL/S3 evidence stays green. ✔ libSQL/upgrade local; S3/certify inherited from main CI (no Docker here) — the closeout PR's CI re-establishes it
7. R03 is marked complete only after 4–5. ✔

## Outcome

**R03 is PREPARED — remote staging gate pending explicit authorization. It is not complete.** Nothing below claims remote success.

### Current-truth note (2026-10-12) — the Candidate section below is historical

Since that Outcome was written: PR #92 merged and published `0.13.1`; PR #93 merged as `f5295a0`; PR #94 (Version Packages) merged as `3eb46aa` and published **`0.13.2`**
(all eleven packages on npm `latest`, GitHub release `v0.13.2`, main CI `38143496339` ✓). The K3 fix is therefore in the published
`@forge-cms/cloudflare@0.13.2`; website `CURRENT_FORGE_VERSION = '0.13.2'`. R03 is **still not complete**: the remote gate has not been authorized or run, and
Wrangler is not logged in on this machine.

### Candidate (historical, as of PR #93)

- Starting main `64322dd` (PR #91, spec 089 merge); main CI `38080646922` ✓ (all required jobs incl. Reliability · Coverage · Performance).
- Published: all eleven packages `0.13.0` on npm and GitHub; website `CURRENT_FORGE_VERSION = '0.13.0'`. PR #92 "Version Packages" (`0.13.1`, the R02
  fixes) is **open**, unmerged by this work. The source candidate contains the R02 fixes and this spec's K3 fix; the pending patch will fold in the
  new changeset `d1-long-in-lists.md`.
- Branch `feature/spec-089`-successor `feature/spec-090-staging-recovery-rehearsal`; the final commit and candidate SHA are recorded by the PR.

### Authorization

The preparation PR (#93) ran without remote access. On 2026-10-12 the maintainer logged Wrangler in locally (OAuth) and instructed the agent to run the
whole rehearsal end to end against the isolated `forge-cms-r03-*` manifest, never touching production. Pre-checks (read-only): the account held **no**
`forge-cms-r03-*` D1/R2/Pages resource beforehand. Authorization scope and the cleanup rule used (manifest lifetimes: staging persistent, restore + copy
Worker disposable) are in the Remote rehearsal section.

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

### Remote rehearsal (2026-10-12) — newly executed, remote

**Candidate:** code commit `c2a124f1af908369a42f4a0f7c77d2e974b8af72` (branch `feature/spec-090-remote-staging-closeout`; `main` `3eb46aa` + the R03 finding
fix below). Published release at the time: `0.13.2` (K3 fix included). **Wrangler 4.91.0**, account in the staging region WEUR.

**Resources (all `forge-cms-r03-*`; nothing else touched):**

| Resource        | Name                                                                | Identity                                                      | End state                         |
| --------------- | ------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------- |
| Pages (source)  | `forge-cms-r03-staging` → `https://forge-cms-r03-staging.pages.dev` | bindings `DB`, `BUCKET`, var `FORGE_SSR_ORIGIN` = that origin | **retained**                      |
| D1 (source)     | `forge-cms-r03-staging-db`                                          | `408c4c0d-9f4f-44fa-8505-c9504fe1a81e`                        | **retained**                      |
| R2 (source)     | `forge-cms-r03-staging-media`                                       | —                                                             | **retained**                      |
| Pages (restore) | `forge-cms-r03-restore` → `…restore.pages.dev`                      | bound only to the restore D1/R2                               | deleted                           |
| D1 (restore)    | `forge-cms-r03-restore-db`                                          | `514960e4-310f-4356-af3c-c0e618f425a2`                        | deleted                           |
| R2 (restore)    | `forge-cms-r03-restore-media`                                       | —                                                             | deleted (2 objects removed first) |
| Worker (copy)   | `forge-cms-r03-r2-copy`                                             | bindings `SOURCE`, `TARGET`, secret `COPY_TOKEN`              | deleted after the copy            |

Pages bindings came from a generated, untracked config (`.staging/…/wrangler.toml`, never the repository's `apps/tiny-project/wrangler.toml`); each app had
its own freshly generated `AUTH_SECRET`, installed from stdin and never printed. Deployments: `352f248a` (pre-fix), `8ad45d3a` (candidate), `09abd85b`
(same-candidate redeploy).

**Health (`pnpm staging verify`, source and restore origin):** collections `200`, public posts `200`, anonymous `/api/account/me` `401`,
`/api/content/does-not-exist` `404`, `/studio/login` `200`, `/` `200` — no `D1_ERROR`, `SQLITE_`, `too many SQL variables`, `passwordHash` or
`_sessionVersion` in any body. Runtime selected D1 + R2 (the build refuses to start without both bindings; there is no in-memory fallback).

**Journey (`scripts/staging/journey.mjs`, over the real HTTPS origin, 37/37 checks on the second full pass; the first pass proved the bootstrap):**
genuinely empty D1 → `POST /api/bootstrap-admin` `400` without credentials (zero users), then `201` + Secure/HttpOnly cookie, a second bootstrap `409`;
login `200`; `/api/account/me` as the admin; cross-origin cookie mutation `403 FORBIDDEN` and cookie mutation with no Origin `403`, same-origin mutation `201`
(protection never disabled); relation target, draft create, anonymous list hides the draft, publish, edit, public read sees the edit, SSR deep link
renders the published title; multipart upload → `media` document with `_storageKey`, `/api/media/…` returns the exact bytes and content type, a public
file is readable anonymously, a private file is hidden from anonymous and readable by staff, delete → `204`, the file then `404` and the document gone;
logout `204`, then anonymous. Redeploying the **same commit** (`09abd85b`) kept D1 and R2: admin id, login, post, relation, published SSR and the object
bytes all verified again (14/14).

**Remote K3** (`GET /api/site/posts?title[in]=…`, anonymous): **80, 99, 100, 120, 400 values → `200` at every size**, no provider text in the body.

**Logs** (`wrangler pages deployment tail`, 12 requests: ok, 404, invalid JSON `400`, wrong credentials `401`, cross-origin `403`, bad query): 0 exceptions,
0 application log lines, and no `AUTH_SECRET`, password, email, `passwordHash`, `_sessionVersion`, SQL, D1 error or token text. Cloudflare's tail event
echoes request headers, so a live session cookie would appear there (only a fake cookie did in this run) — a platform property to keep in mind.

**Quiesce + backup:** all writers stopped at `2026-10-12T12:18:04Z` (no atomic D1+R2 snapshot exists; none is claimed). `wrangler d1 export … --remote` of the
staging D1 only → `.staging/database.sql`, 5.8 KB, **SHA-256 `925bb2456aa7172809c1836a9091129fd9051d522227bb59b168af44d6657169`** (gitignored). Required
object keys were derived from that snapshot with `pnpm staging keys` (**2** `media/…-r03-fixture.bin` keys), never from a bucket listing.

**Metadata-preserving copy:** the disposable Worker copied exactly those keys source → restore bucket; `pnpm staging compare` → **2/2 objects match**
(size 963, SHA-256, content type `application/octet-stream`). The fixture's `customMetadata` is empty, so metadata fidelity is exercised by the unit
tests, not by this data. The Worker answered `403` without the token and does not exist any more (`10007` from the API).

**Isolated restore:** the restore D1 had 0 tables and the restore bucket was new before the import; `wrangler d1 execute … --file` loaded the snapshot (6
tables). The restore Pages app was bound only to the restore D1/R2 with its own secret and real origin, and passed: health; login with the same
credentials; same admin id; same post id, relation, draft/published state; same `_storageKey`; `/api/media` exact bytes and type; a new write and delete
(`201`/`204`). SQL-level comparison source vs restore: same 6 tables, identical schema hash (`48ac459a47e392ff`) and **identical rows in every table**
(including the `_forge_schema` ledger). An ephemeral `wrangler dev --remote` Worker running the tiny-project runtime against the restore resources reported
`planSchema()` → **0 changes**, `reconcileStorage()` → empty report **twice** (second run a no-op), migration history `[]`.

**Finding fixed — R03-F1 (`@forge-cms/runtime`, patch `hide-internal-fields-from-metadata`):** `GET /api/content/collections` (anonymous) listed the users
collection's internal `passwordHash` and `_sessionVersion` fields (`access: { read: [], write: [] }`). Names only, never values — but the verifier flagged
it and an anonymous schema endpoint should not advertise credentials storage. `describeFields` now omits fields no role can read or write. Test added;
admin forms are unaffected (nobody could edit those fields).

**Tooling findings fixed in the repository:** (a) the copy Worker accepted `Bearer undefined` in the window between `wrangler deploy` and
`wrangler secret put` — now refuses unless `COPY_TOKEN` is set (≥16 chars), with tests; (b) `scripts/staging/journey.mjs` added (the journey above, also run
against the restore); (c) the runbook now records the real procedure and the pitfalls below.

**Incident (disclosed):** my first `wrangler pages deploy` was run through `pnpm --dir ../..`, which switched the working directory to the repository root,
so Wrangler used the **root `wrangler.toml`** (the production website's config) and uploaded `apps/www/dist/analog/public` to
`forge-cms-r03-staging` (deployment `780ee840`). Only the staging Pages project was a deploy target — the production project `forge-cms` was not deployed
to — but that config also declares the production D1 `forge-cms` as `DB`, so that one deployment may have been bound to it. The only requests it received
were my health probes (`/api/content/…`, `/api/account/…`, `/api/bootstrap-admin` (empty body), none of which the website implements — it answered with its
static page), so no D1 access is expected, but it is not proven. It was superseded minutes later by the correct deployment (Pages replaces the bindings on
each deploy). Lesson recorded in the runbook: run Wrangler for Pages from the generated directory with the absolute binary, never through `pnpm --dir`.

**Caveats (not hidden):** (1) the `/studio/login` **form** was not driven in a browser — signing in with a typed password on a remote origin is outside
what the agent may do; sign-in, the Secure/HttpOnly cookie, session use and logout were proven through the same HTTP API the form calls, and `/studio/login`
renders. (2) `apps/tiny-project` defines no migrations, so "rerun known migrations → already-applied" is not applicable remotely (covered locally by
`test:upgrade`); the ledger compared is `_forge_schema`. (3) `test:s3` / `release:certify` cannot run here (no Docker): the final candidate's portable
evidence is the CI of the closeout PR; main CI `38143496339` is the inherited evidence for `3eb46aa`. (4) F5 did not recur (all five CI runs after spec 090
and the stability runs of this session were clean).

**Cleanup:** deleted exactly the restore Pages/D1/R2 and the copy Worker (the user gave no instruction beyond "complete it"; manifest lifetimes were
followed). **Retained for RC/R04:** the staging Pages project, D1 and R2 bucket (one admin, one published post, two public media rows). Nothing outside
`forge-cms-r03-*` was created, changed or deleted.

### Limits

No atomic D1 + R2 snapshot, no maintenance mode (quiescence is operational), staging is not production traffic, local workerd evidence never
substitutes for the remote gate, only Garage v2.4.1 is a certified S3 service.
