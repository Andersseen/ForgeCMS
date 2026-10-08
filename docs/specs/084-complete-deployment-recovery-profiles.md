# 084 — Complete deployment and recovery profiles (roadmap 0.10 / P03)

- **Status:** done (2026-10-08)
- **Author:** agent draft (implementation requested by the maintainer, 2026-10-08 — "spec 084 — roadmap 0.10 / P03";
  per [SDD.md](../SDD.md) an explicit request to implement counts as approval)
- **Date:** 2026-10-08
- **Branch:** feature/spec-084-deployment-recovery-profiles
- **Affected packages/apps:** `apps/tiny-project` (profile policy, R2 selection), `apps/upgrade-rehearsal` (S3
  recovery lane), `apps/www` (release truth, docs), scripts (shared Garage fixture, packed production journey),
  CI, docs. **No `packages/*` change; no changeset.**

## Context / Why

P01 (spec 082) proved `@forge-cms/s3` as a `StorageAdapter`; P02 (spec 083) certified the libSQL + S3 upload
lifecycle. What was still missing for roadmap 0.10 was the _profile_: two honest, reproducible, durable production
setups that go from a clean install to a production build, survive a restart, and can be restored into an
isolated target — and a guarantee that production can never silently run on in-memory adapters.

## Goal

A new consumer using only public ForgeCMS packages can follow one documented Cloudflare D1/R2 profile or one
documented Node/libSQL/S3 profile from clean setup to a production-built application with auth/admin, SSR,
uploads and durable files; each profile survives restart, and its database + required file objects can be
restored into an isolated empty target while preserving users, ids, relations, migration state and file
ownership.

## Non-goals

Remote infrastructure provisioning, Terraform/Pulumi, an AWS-specific adapter, presigned/direct uploads, image
processing, a CDN abstraction, online distributed snapshots, a provider marketplace, an admin redesign, roadmap
0.11 / U01 work, a claim that every S3-compatible provider is certified, and any remote Cloudflare/AWS
deployment (none was created or authorized).

## Evidence gathered before design (2026-10-08)

- `main` = `f3cb006` (PR #82, an unrelated harness chore, on top of PR #81 = `fe26922`). The post-merge `CI` run of
  PR #81 **succeeded** (17m21s); PR #82's run was in progress and touches no code this spec uses. No open PRs.
- npm and GitHub: the whole fixed group, including `@forge-cms/s3`, is `0.11.0`. `.changeset/` holds only the empty
  P02 changeset. The website still said `0.10.2` and listed ten packages.
- The S03 packed journey (spec 081) built tiny-project twice (Node + libSQL, Cloudflare Pages + D1) with **no file
  storage in the Cloudflare half and in-memory storage in the Node half**; tiny-project fell back to
  `InMemoryDatabaseAdapter`/`InMemoryStorageAdapter` whenever a setting was missing.
- M03's backup helper (`requiredStorageKeys`/`writeBackup`/`verifyBackup`/`restoreObjects`) is provider-neutral;
  its libSQL lane used `InMemoryStorageAdapter`.
- Cloudflare syntax re-checked against current Cloudflare Pages docs (bindings, Pages Wrangler configuration):
  `pages_build_output_dir`, `name` and an explicit `compatibility_date` are required; `d1_databases`/`r2_buckets`
  are declared as in Workers; local `wrangler pages dev` accepts `--d1`/`--r2` and persists local D1/R2 by default.

## Design

### Profile policy lives in the consumer (`apps/tiny-project/src/server/api/profile.ts`)

`resolveProfile(env, { development })` is a pure function; the generic runtime knows nothing of it.

| Mode                              | Rule                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| development (`import.meta.dev`)   | any durable setting present is honoured; otherwise in-memory is allowed (no durability claim)            |
| production, Cloudflare            | `DB` **and** `BUCKET` → `D1DatabaseAdapter` + `R2StorageAdapter`                                         |
| production, portable              | `DATABASE_URL` **and** `S3_BUCKET` + `S3_REGION` → `LibSqlDatabaseAdapter` + `S3StorageAdapter`          |
| production, none / partial / both | startup error naming the missing/conflicting **names** (never values): no profile, incomplete, ambiguous |

A mixed Cloudflare + portable configuration is rejected (no invented precedence). `getServerRuntime` calls it
before building any adapter; tests that deliberately run in memory opt in with
`resetServerRuntimeForTests({ development: true })`. `storage.ts` keeps `parseS3Config` and builds the S3 adapter
(`createS3Storage`); R2 uses the existing public `R2StorageAdapter` on the `BUCKET` binding — no custom upload
code, the normal `handleCreate → StorageAdapter → _storageKey → handleFile` path, default URL base `/api/media`.

### Packed production journeys (`scripts/ssr-consumer/`)

The S03 journey now runs two **complete** profiles: Node (`node-server`, `externals.trace: false`, on-disk libSQL,
real S3 adapter against Garage) and Cloudflare Pages under local workerd with local D1 **and local R2** (the
generated `wrangler.toml` gains `[[r2_buckets]] BUCKET`). All S03 assertions are unchanged. New in this spec:
`files.mjs`, a minimal durable-file journey on each profile — multipart upload through the signed-in admin page
(`POST /api/v1/media`, no fake route), `_storageKey` read from the database, object bytes read straight from the
durable store (Garage `GetObject`; Miniflare's persisted R2 index + blob), anonymous browser fetch of the public
file (exact bytes, content type, public cache policy), protected file 404 anonymously / 200 + `private, no-store`
for staff, unowned keys 404, **server restart**, same bytes again, canonical delete, document + object + storage
intent gone. The Node half also boots the built server with no profile, with libSQL but no S3, and with S3 but no
database and requires a 500 that names the missing variables and prints no secret. The browser-bundle scan gained
`R2StorageAdapter`, `S3_ACCESS_KEY_ID`, `AUTH_SECRET` and `resolveProfile`.

Stage ownership: `pnpm release:ssr` = the Docker-free technical consumer; `pnpm test:s3 profiles` = the journey
(it needs Garage; the script hard-fails without it).

### Shared Garage fixture (`scripts/s3-fixture.mjs`)

Extracted from `test-s3.mjs` and repository-private: pinned image + digest, random credentials, readiness, extra
buckets created through the Garage CLI (`bucket create` / `bucket allow`), cleanup. `S3StorageAdapter` still never
creates buckets. `pnpm test:s3` starts **one** container for stages `adapter · lifecycle · consumer · recovery ·
profiles` and provisions 24 recovery buckets + one profile bucket.

### S3 recovery lane (`apps/upgrade-rehearsal/test/s3/backup-libsql-s3.test.ts`)

For each committed fixture (`0.4.0`, `0.6.0`, `0.8.0`): historical database file + its objects in a fresh source
bucket → current code → `planSchema` + reviewed migrations → post-upgrade writes → one pending storage intent →
quiesce → cold libSQL snapshot → **required keys derived from the snapshot** (the orphan in the bucket listing is
not required) → `writeBackup` copies exactly those objects → manifest checks (no credentials) → delete the source
database and **empty the source bucket** → restore to a new path and into a different, verified-empty bucket →
open a new runtime configured only with the target → the spec 073 verification helpers plus a write and an
idempotent `reconcileStorage`. The generic helper is unchanged; the private manifest `profile` gained `'libsql-s3'`
(format stays 1). Real-S3 controls: missing referenced object fails the backup with no manifest; a target that
already holds a required key refuses without overwriting; a corrupt or missing backup file is rejected before the
target is touched; tampered bytes, content type and metadata are each reported by restore verification; an
awkward key keeps a hashed backup file name. The D1/R2 lane (`pnpm test:upgrade`) is untouched and remains
release evidence.

## Implementation plan

- [x] spec, profile policy + R2 + tests (`profile.ts`, `runtime.ts`, `storage.ts`, `storage-selection.test.ts`)
- [x] Garage fixture extraction; `test:s3` stages `recovery`, `profiles`
- [x] packed journeys: R2 binding, Garage env, durable-file journey, fail-closed boot check
- [x] S3 recovery lane + failure controls
- [x] CI reorder (Garage step after Playwright), docs, release truth, roadmap bookkeeping

## Test plan

`storage-selection.test.ts` (profile selection incl. dev/prod, partial, mixed, no secrets); `pnpm test:s3`
(all five stages); `pnpm test:upgrade` (unchanged D1/R2 + libSQL/InMemory lanes); the full CI-equivalent suite.

## Acceptance criteria

1. Production `tiny-project` refuses to start without a complete profile; development may still use InMemory.
2. The Cloudflare production profile requires and uses D1 + R2; the portable one libSQL + S3.
3. Both packed production builds keep every S03 SSR/hydration/privacy assertion and pass the durable-file journey
   including a restart and a delete that removes the physical object.
4. Browser bundles contain no S3/AWS/R2/profile server code or secrets.
5. A libSQL + S3 installation backs up from its snapshot and restores into an isolated empty bucket with identity,
   relations, auth, migration state, drafts/locales/globals/history, file ownership and bytes intact; real-S3
   failure controls pass; the D1/R2 lane stays green.
6. Docs, release truth (`0.11.0`, `s3` listed) and roadmap are current; CI runs everything; no `packages/*` change.

## Open questions

None.

## Outcome

Delivered as specified; **no `packages/*` change, no changeset** (the fixed family stays `0.11.0`).

- **Truth used:** `main` `f3cb006` (PR #81 post-merge CI green; PR #82 chore on top), npm/GitHub `0.11.0` for all
  eleven packages, no open PRs. Website: `CURRENT_FORGE_VERSION = '0.11.0'`, `s3` added (test updated to eleven).
- **Selection / fail-closed:** as in Design; unit-tested (development, no profile, DB-without-storage,
  storage-without-DB, both complete profiles, mixed, no secret in messages) and proven on the _built_ Node server.
- **Cloudflare evidence:** `wrangler pages dev` of the Pages build, **local workerd + local D1 + local R2**
  (not remote): SSR journey + file journey + restart + delete, all green.
- **Node evidence:** `node-server` + on-disk libSQL + `S3StorageAdapter` against Garage `v2.4.1` (digest
  `sha256:9c96caa2612d3411acc5b0e6701fb238dbfba33e533a6d7d3d811a4b12d0d020`): same journeys, green.
- **S3 recovery:** 3 historical versions × (upgrade + backup + isolated restore) + 7 failure controls, all green;
  source bucket emptied and database deleted before restore; target verified empty first; runtime opened with the
  target only. Garage's metadata round trip matched byte-for-byte; no helper change was needed.
- **Public API impact:** none. **CI:** the Garage step moved after the Playwright install and now also runs
  `recovery` and `profiles`; the S03 journey moved from `release:ssr` into it (not duplicated).
- **Limitations (unchanged claims):** only Garage is CI-certified; AWS S3, B2 and Wasabi are configurable, not
  tested; Cloudflare evidence is local; there is no atomic database + object-store snapshot (quiesce required) and
  no point-in-time recovery; no remote resource was created.
