# 083 — Portable upload lifecycle and access (roadmap 0.10 / P02)

- **Status:** done (2026-10-08)
- **Author:** agent draft (implementation requested by the maintainer, 2026-10-08 — "spec 083 — roadmap 0.10 / P02";
  per [SDD.md](../SDD.md) an explicit request to implement counts as approval)
- **Date:** 2026-10-08
- **Branch:** feature/spec-083-portable-upload-lifecycle
- **Affected packages/apps:** `apps/tiny-project` (media collection, S3 storage selection, `/api/media` route,
  tests); scripts (`test:s3` stages, packed consumer, SSR journey packing); docs. **No `packages/*` change.**

## Context / Why

P01 (spec 082) proved `@forge-cms/s3` as a `StorageAdapter`. It did not prove that ForgeCMS _uses_ it correctly:
the multipart upload pipeline, access-checked serving, storage intents and reconciliation had only been certified
on D1/R2 (specs 051, 067). P02 certifies that complete lifecycle on the portable profile.

## Goal

A consumer using only public ForgeCMS packages can run a durable portable profile with an on-disk libSQL database
and S3-compatible object storage, upload files through the normal Forge multipart handler, serve them through
Forge's access-controlled file handler, restart the process without losing database references or file bytes,
delete them safely, and recover deterministic partial failures through the existing storage-intent mechanism.

## Non-goals

Redefining `StorageAdapter`; another S3 adapter; backup/restore or deployment guides and profiles (P03); a
"never silently use in-memory in production" policy (P03); a media UI or admin changes; presigned uploads; any
distributed-transaction, queue or background-worker mechanism; S3-specific branches in the generic runtime.

## Evidence gathered before design (2026-10-08)

- `main` = `17dca7f` (PR #79). Its main CI run (`CI`, push) **succeeded** before P02 started. Version Packages PR
  #80 was open; npm `latest` still `0.10.2`, so P01's pending minor (`0.11.0`) is unpublished.
- The runtime lifecycle is already provider-neutral (`operations.uploadFile`, `storage-intents.ts`,
  `files.handleFile`); the R2 reference suite is `packages/cloudflare/test/workers/storage-lifecycle.test.ts`.

## Design

Nothing in `packages/*` changes; P02 is fixtures, scripts and docs.

### tiny-project (still a small external-style consumer)

- `media` collection: `upload: true`; `filename`, `url`, `contentType`, `filesize`, `alt`, `visibility`
  (`public` | `private`, default `public`). Read: staff (admin/editor) all rows, everyone else only
  `visibility = public`; create/update: staff; delete: admin.
- `src/server/api/storage.ts`: `parseS3Config(env)` / `selectStorage(env)`. No `S3_*` setting → in-memory (as
  before). Any `S3_*` setting → `S3StorageAdapter`; `S3_BUCKET`+`S3_REGION` required together, credentials only as a
  pair (a session token needs the pair), `S3_FORCE_PATH_STYLE` strictly `true`/`false`, endpoint optional,
  public URL base default `/api/media`. Errors name variables, never values. `@forge-cms/s3` is imported
  dynamically in server code only.
- `GET /api/media/[...key]`: a thin `handleFile` route.

### One Garage, three stages (`scripts/test-s3.mjs`)

`pnpm test:s3` still starts one pinned Garage container (`v2.4.1`, unchanged tag + digest) and now runs, in order:
`adapter` (P01 suite), `lifecycle` (`pnpm --filter @forge-cms/tiny-project test:portable-storage`), `consumer`
(`scripts/verify-portable-storage-consumer.mjs`). Stage names can be passed to run a subset.

### Lifecycle suite

`apps/tiny-project/src/tests/portable-storage.integration.test.ts`: on-disk libSQL file in a temp dir, real
`S3StorageAdapter`, real `ForgeCmsRuntime`, `UsersCollectionAuthAdapter`, `handleCreate` (multipart),
`handleFile`, `handleDelete`. Faults only at two seams: `database.atomicWrite` (fail the media create batch) and a
delegating storage whose `delete` can fail.

### Packed consumer

Packs `core, db, auth, storage, s3, api, runtime`, installs them into a clean project (strict peers,
overrides to the tarballs), compiles strict TypeScript (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`),
checks every Forge import is a bare entry point, and runs **two separate Node processes** on the same libSQL file
and bucket (A uploads and verifies; B serves, reconciles, deletes). Output is scanned for the S3 secret. The
consumer has no browser bundle (S3 configuration is server-side by construction). `scripts/ssr-consumer/`
also packs `@forge-cms/s3` (tiny-project's source now references it) and its browser-bundle check forbids
`S3StorageAdapter`, `@aws-sdk` and `S3_SECRET_ACCESS_KEY`.

## Implementation plan

- [x] media collection, S3 storage selection + unit tests, `/api/media` route
- [x] `test:s3` stages; lifecycle suite; packed two-process consumer
- [x] SSR journey packs `@forge-cms/s3`; browser forbidden markers
- [x] docs (uploads guide, tiny-project README, ROADMAP, 0.10 doc, STATE); CI-equivalent gates

## Test plan

See the Outcome; every item of the lifecycle list is a named case in the suite above.

## Outcome

**Result:** roadmap 0.10 / P02 complete. The whole portable upload lifecycle works unchanged on the existing
generic runtime — **no runtime, db, storage or s3 defect was found, and no `packages/*` file changed** (so no
Changeset; P01's pending minor Changeset is the release vehicle).

- **Fixture architecture:** one Garage `v2.4.1` container (`dxflrs/garage:v2.4.1@sha256:9c96caa2…d020`, the P01 pin,
  unchanged), region `garage`, single bucket, random test-only credentials; stages share it. Database: a real file
  `file:<tmpdir>/forge.db` (libSQL, not `:memory:`), reopened by new instances.
- **Collection/access model:** `media` as above; the suite uses an admin and an editor created by the real auth
  adapter and Bearer tokens.
- **Successful upload:** multipart `handleCreate` → object bytes + content type exact in S3, document persisted with
  `filename/url/contentType/filesize/alt/visibility`, Forge-recorded `_storageKey` `media/<uuid>-<name>`, URL
  `/api/media/<encoded key>`, zero storage intents after commit.
- **Access:** anonymous public → 200, exact bytes/type, `public, max-age=60`; authenticated → `private, no-store`;
  private file → 404 anonymously (`no-store`), 200 for staff; a stray object in the bucket → 404 for everyone;
  anonymous upload → 401 with nothing stored.
- **Validation parity:** wrong MIME, over `maxFileSize`, and a non-file `file` part → 400 before any `put` (bucket
  listing unchanged, no intent); an invalid field value after `put` → 400, object removed, no intent, no row.
- **DB failure after put:** healthy storage → object removed, no row, no intent. Plus a failed object delete → no
  row, orphan object remains, exactly one durable `delete` intent in `_forge_storage_intents` (inspected in libSQL),
  `reconcileStorage()` deletes the object and the intent.
- **Object-delete failure after document delete:** document gone, object remains, durable `delete` intent;
  `reconcileStorage()` → `{deleted:[key]}`, object and intent gone; a second run is an empty report.
- **Reconciliation safety:** stale intent on an owned object → object kept, intent dropped; young `upload` intent →
  `pending`, later (injected `now`) removed; failed delete → intent kept with the message only.
- **Missing vs outage:** owned document + missing object → 404; unreachable endpoint (`127.0.0.1:1`) and rejected
  credentials → 500 `{"error":"Failed to read file"}` with none of the secret, bucket, endpoint or key in the body;
  a reconcile during the outage reports a message string only (no SDK error object, no secret) and keeps the
  intent. Limitation inherited from P01: raw SDK Error _objects_ can carry request metadata, so nothing here logs
  or serializes one; the runtime logs `err.message` only.
- **Restart:** a brand-new database client, auth adapter, S3 client and runtime on the same file/bucket finds the
  document, serves exact bytes, keeps the private file protected, accepts the pre-restart session token, and
  deletes object + document with no intents. **Packed consumer:** process A uploads/verifies, exits; a separate
  process B (same file/bucket) logs in, serves persisted bytes, reconciles (nothing to remove, owned object kept),
  deletes through `handleDelete`, and verifies object, document and intents are gone.
- **R2:** `packages/cloudflare/test/workers/storage-lifecycle.test.ts` is untouched and green under
  `pnpm test:cloudflare`; the S3 scenarios mirror its upload/delete/access cases.
- **Public API / release:** none changed. `check:api` unchanged. No new Changeset; Version Packages PR #80 remains
  the `0.11.0` vehicle for P01. Never edited a manifest version.
- **Not done (P03):** deployment and recovery guides, S3 backup/restore, the production policy against silently
  using in-memory adapters, remote/AWS validation. Garage remains the only certified S3 service.
