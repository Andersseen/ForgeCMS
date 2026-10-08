# 082 — Basic S3-compatible StorageAdapter (roadmap 0.10 / P01)

- **Status:** done (2026-10-07)
- **Author:** agent draft (implementation requested by the maintainer, 2026-10-07 — "spec 082 — roadmap
  0.10 / P01"; per [SDD.md](../SDD.md) an explicit request to implement counts as approval)
- **Date:** 2026-10-07
- **Branch:** feature/spec-082-s3-storage-adapter
- **Affected packages/apps:** new `@forge-cms/s3`; `@forge-cms/testing` (stronger storage contract);
  `@forge-cms/storage` and `@forge-cms/cloudflare` (URL-encoding fix in `getPublicUrl`); scripts
  (`test:s3`, `release:verify`), CI, API baseline, docs

## Context / Why

Roadmap 0.10 requires a durable file path beyond Cloudflare R2. Spec 055 proved portable users/auth/content
on libSQL; files are the remaining hole. P01 is only the adapter packet: one dependable S3-API adapter behind
the unchanged `StorageAdapter` contract. The CMS upload lifecycle on top of it (libSQL + S3) is P02; guides
and backup/restore are P03.

## Goal

A ForgeCMS server application can use `@forge-cms/s3` as its `StorageAdapter`, configure it for AWS S3 or an
S3-compatible endpoint, and get the same put/get/delete/list/public-URL behaviour InMemory and R2 guarantee,
proven against a real S3-compatible service.

## Non-goals

P02/P03 work (libSQL + S3 upload journey, S3 fault injection, tiny-project S3 profile, backup/restore of
objects); presigned/browser-direct/multipart uploads; CDN abstraction; image transforms; provider-specific
adapters; bucket creation/provisioning/policies; replication; lifecycle policies; redesigning
`StorageAdapter`; exposing the AWS client, command classes or SDK types.

## Evidence gathered before design (2026-10-07)

- `main` = `2da1bea`, no open PRs, npm/GitHub fixed family `0.10.2` published.
- `StorageAdapter` (`@forge-cms/storage`) is authoritative and unchanged. InMemory and R2 implement it;
  `handleFile` decodes the route param with `decodeURIComponent` and looks the owner up by `_storageKey`.
- The existing contract was thin (no bytes/metadata/content-type/URL assertions, fixed keys that would collide
  on a persistent bucket). Strengthening it exposed a **real cross-adapter bug**: InMemory and R2
  `getPublicUrl` interpolated the raw key, so `#`, `?`, `%` and (for `%`) malformed escapes produced URLs that
  did not resolve back to the key (4 of the new contract cases failed on both before the fix).
- `@aws-sdk/client-s3` `latest` = `3.1147.0` on the registry (SDK v3; v2 is not used). The repository pins
  runtime dependencies exactly (`@libsql/client` `0.17.3`, `drizzle-orm` `0.45.2`), so the SDK is pinned
  `3.1147.0`.
- **MinIO is no longer obtainable.** The plan named MinIO. The community server is archived: `dl.min.io`
  answers `410 Gone` for every community binary, and `minio/minio` images are withdrawn from Docker Hub and
  quay.io (anonymous pulls denied; last image `RELEASE.2025-09-07T16-13-09Z`, last source tag 2025-10-15).
  The maintainer decided (2026-10-07): use **Garage** as the maintained S3-compatible fixture; no third-party
  MinIO mirror and no building of archived MinIO. Garage `v2.4.1` (Docker Hub `dxflrs/garage`, published
  2026-09-08, current release) is documented as the single-node quick start on garagehq.deuxfleurs.fr.

## Design

### Package placement

`packages/s3` → `@forge-cms/s3`, joined to the fixed public family. Dependencies: `@forge-cms/storage`
(workspace) and `@aws-sdk/client-s3` (`3.1147.0`, exact). Direction: `s3 → storage`, never the inverse;
`runtime`, `angular`, `admin`, `storage`, `cloudflare` gain no AWS dependency (`release:verify` enforces it).

### Public API (exactly three exports)

```ts
export interface S3StorageCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}
export interface S3StorageAdapterOptions {
  bucket: string;
  region: string;
  endpoint?: string;
  credentials?: S3StorageCredentials;
  forcePathStyle?: boolean; // default false
  publicUrlBase?: string; // default '/api/media'
}
export class S3StorageAdapter implements StorageAdapter {
  readonly name = 's3';
  constructor(options: S3StorageAdapterOptions);
  init(env?: unknown): this; // chainable no-op; configuration is complete at construction
  put(options: PutObjectOptions): Promise<StorageObject>;
  get(key: string): Promise<StorageObject | null>;
  delete(key: string): Promise<void>;
  getPublicUrl(key: string): Promise<string>;
  list(prefix?: string): Promise<StorageObject[]>;
}
```

### Configuration

`bucket`/`region` required and non-blank (no invented region); no bucket creation. `endpoint` optional,
absolute `http:`/`https:` only (HTTP allowed for local services, documented as dev/test only); validation
errors never echo the endpoint (it may carry userinfo). `credentials` optional — explicit values go to
`S3Client`; omitted means the SDK's normal server-side provider chain; the adapter reads no environment
variables. Blank explicit credentials are rejected without printing them. `forcePathStyle` is the v3 name.

### Semantics

- **put** — `PutObjectCommand`; every `PutObjectOptions` body shape is normalised to a `Uint8Array`
  (buffered; no multipart). Returns `{ key, size, contentType?, metadata? }` from what is known; no URL.
- **get** — `GetObjectCommand`; bytes returned as `ArrayBuffer` (never an SDK stream) with content type and
  metadata. `null` **only** for `NoSuchKey`/`NotFound`. `NoSuchBucket` (also HTTP 404), 403, credential,
  network and 5xx errors reject with the original SDK error — P02 recovery must tell "missing" from "down".
- **delete** — `DeleteObjectCommand`; S3 deletes are idempotent so a missing key resolves; other failures
  reject (higher-level retry stays in the runtime storage-intent recovery).
- **list** — `ListObjectsV2` following `NextContinuationToken` until `IsTruncated` is false; returns `key` and
  `size` only (no per-object `HeadObject`). A truncated page without a token throws rather than returning a
  silent partial list.
- **getPublicUrl** — `<publicUrlBase>/<key split on "/", each segment encodeURIComponent'd>`; trailing slashes
  of the base are trimmed. Default base `/api/media` keeps Forge's access-checked `handleFile`. A direct
  bucket/CDN base is opt-in and bypasses `handleFile` access checks; the adapter configures no bucket policy.
- Errors: Forge-generated messages contain no credentials; provider errors are not wrapped.

### Shared contract (`@forge-cms/testing/contracts`)

`runStorageAdapterContractTests` keeps its signature. Every test now uses a random key namespace (safe on a
persistent bucket) and covers: name; put/get bytes and size; binary + empty objects; all four body shapes;
content type + metadata round-trip (lowercase keys — S3 normalises them); overwrite; missing get → null;
delete; **delete of a missing key resolves**; public URL; list incl. sizes; prefix list; and URL-sensitive keys
(space, Unicode, `#`, `?`, `%`, `+&=`, a literal `%20`) for put/get/list and a URL whose path decodes back to
the key with no query/hash leakage. Nothing in it is AWS-specific.

### InMemory / R2 fix

Both `getPublicUrl` now encode per segment (same rule as S3). No other change to those adapters.

### Test fixture — Garage

`pnpm test:s3` → `scripts/test-s3.mjs`: requires a Docker daemon (clear error, never a skip); starts
`dxflrs/garage:v2.4.1@sha256:9c96caa2612d3411acc5b0e6701fb238dbfba33e533a6d7d3d811a4b12d0d020` with
`--single-node --default-bucket`, a generated `garage.toml` (random `rpc_secret`/`admin_token`), a random
test-only access key (`GK`+24 hex) and secret, an ephemeral container bound to `127.0.0.1` on a Docker-chosen
port, region `garage`, bucket `forge-s3-test`; runs `@forge-cms/s3` `test:integration` with
`FORGE_S3_TEST_*`; always removes the container and temp config (also on SIGINT/SIGTERM). The integration file
fails hard if the variables are missing.

### Release / versioning

`@forge-cms/s3` is added to `.changeset/config.json`'s fixed group and to `verify-release.mjs` (packed tarball
contents, no workspace protocols, declared imports, AWS confined to s3, a strict TypeScript consumer that
imports and instantiates it as a `StorageAdapter` with no network I/O). `create-github-release.mjs` and
`publish-unpublished.mjs` discover packages dynamically and needed no change. The initial manifest is
`0.10.2` (the family baseline). The changeset is `minor` for `s3`, `storage`, `cloudflare`, `testing` (the
fixed group lifts the whole family): `pnpm changeset status` reports every public package at minor, so the
Version Packages PR moves the family to **`0.11.0`**. The official website's `CURRENT_FORGE_VERSION` is
untouched (it is the _published_ version) and no S3 package card was added; `packages/s3/README.md` ships the
full docs.

## Implementation plan

- [x] Spec; package scaffold (`package.json`, tsconfigs, workspace/tsconfig paths, changeset config)
- [x] `S3StorageAdapter` + unit tests (config, put/get/delete/list/URL, pagination, error classes)
- [x] Strengthen the shared contract; fix InMemory/R2 URL encoding
- [x] `test:s3` Garage runner + integration suite; CI step
- [x] `release:verify` S3 consumer + boundary check; API baseline
- [x] Changeset, README, docs, STATE/ROADMAP/0.10 updates

## Test plan

`@forge-cms/s3` unit tests (38); shared contract against InMemory, R2 (unit mock + real workerd R2 via
`test:cloudflare`) and Garage; Garage focused cases (endpoint + path-style, wrong credentials reject, missing
bucket rejects, unreachable endpoint rejects, binary/empty bytes, metadata, prefix list, URL-sensitive keys
end to end through the same decode `handleFile` performs); `check:api`; `release:verify`; the repository gates.

## Acceptance criteria

1. `@forge-cms/s3` is a standalone public package with exactly the three exports above; `@forge-cms/storage` has no AWS dependency.
2. AWS SDK v3 only; bucket and region explicit; endpoint, explicit credentials, provider-chain credentials and `forcePathStyle` supported.
3. Default public URL base is `/api/media`; a direct base is opt-in and documented as bypassing access checks.
4. Bytes, content type and metadata round-trip; missing → `null`; non-404 failures reject; delete is idempotent; list supports prefix and all pages.
5. URL-sensitive keys yield safe URLs (also InMemory/R2).
6. The shared contract passes on InMemory, R2 (mock and real workerd) and Garage; focused Garage cases pass.
7. No credentials in Forge errors; no AWS dependency in browser-facing packages.
8. API baseline, packed consumer, release tooling and changeset (`0.11.0` line) are in place.
9. Website release truth is unchanged.
10. STATE/ROADMAP/0.10 mark P01 complete and P02/P03 pending.
11. All CI-equivalent gates pass.
12. No P02/P03 functionality.

## Open questions

None.

## Outcome

Shipped on `feature/spec-082-s3-storage-adapter` (2026-10-07).

- **Public API / placement:** `@forge-cms/s3` exports exactly `S3StorageAdapter`, `S3StorageAdapterOptions`, `S3StorageCredentials` (baseline `api-baseline/_forge-cms_s3.json`). Depends on `@forge-cms/storage` and `@aws-sdk/client-s3` `3.1147.0` (AWS SDK v3, registry `latest` at the time); `storage` has no AWS dependency, and `release:verify` fails if any other public package depends on `@aws-sdk/*` or `@forge-cms/s3`.
- **Divergence — MinIO → Garage:** MinIO community binaries (`dl.min.io` 410) and images (Docker Hub/quay anonymous pulls denied) are no longer published, so by maintainer decision Garage is the certified service: `dxflrs/garage:v2.4.1@sha256:9c96caa2612d3411acc5b0e6701fb238dbfba33e533a6d7d3d811a4b12d0d020`, run `--single-node --default-bucket`, region `garage`, bucket `forge-s3-test`, `forcePathStyle: true`, plain HTTP on `127.0.0.1` with a Docker-assigned port, random test-only `GK…` key/secret and `rpc_secret`/`admin_token`, container removed on every exit path.
- **Evidence:** unit suite 38 tests (config validation, no-leak, put/get/delete/list, error classes, 3-page pagination `1000+1000+5` with token assertions, truncated-without-token). Shared contract (19 cases) passes on InMemory, R2 mock (`cloudflare` unit 123→ now green) and **real workerd R2** (`test:cloudflare`: 291 tests), and on **real Garage** with 12 focused cases (31 tests in total): endpoint+path-style, wrong credentials reject, missing bucket reject, unreachable endpoint reject, binary/empty bytes, metadata (S3 lowercases keys), prefix list, many-object list, and four URL-sensitive keys end to end through the `handleFile` decode. Real multi-page listing against Garage was not exercised (the adapter exposes no page-size knob); pagination is pinned by the unit test only.
- **URL encoding:** `getPublicUrl` encodes each segment and keeps `/` (`media/id-my photo #1.png` → `/api/media/media/id-my%20photo%20%231.png`).
- **Defects found by the stronger contract, fixed in the same PR:** InMemory and R2 `getPublicUrl` did not encode keys (`#`, `?`, `%` broke URLs); real R2 rejected a `ReadableStream` body of unknown length (`R2StorageAdapter.put` now buffers streams). Both would have been hidden by the old thin contract.
- **Release:** `verifyS3Consumer` in `release:verify` (strict TS consumer instantiating the packed adapter as a `StorageAdapter`, no network) plus `assertS3Boundary`. `create-github-release`/`publish-unpublished` discover packages dynamically (unchanged). `.changeset/s3-storage-adapter.md` is `minor` for s3/storage/cloudflare/testing; `pnpm changeset status` shows the whole fixed family at minor → Version Packages PR should produce `0.11.0` (manifests still `0.10.2`). Published `latest` remains `0.10.2`; `apps/www` untouched.
- **CI:** one new step `pnpm test:s3` in the `checks` job (which `release` needs; no path filter). Local `test:s3` takes ~4 s warm; the image pull is the only cold cost, so the 25-minute timeout was left unchanged pending a measured CI run.
- **Provider matrix:** certified = Garage v2.4.1. Configurable, not CI-certified = AWS S3, Backblaze B2, Wasabi (README examples, labelled).
- **Known limits / for P02–P03:** raw SDK errors (e.g. `SignatureDoesNotMatch`) may carry `AWSAccessKeyId`/request fields on the error object (messages are clean) — do not log whole error objects; `put` buffers the object; `list` returns key+size only; blank `sessionToken` is not rejected. P02 (libSQL+S3 upload lifecycle, fault injection) and P03 (deployment guides, backup/restore of objects) are untouched. `pnpm-lock.yaml` also shows a small re-resolution of the `@vitest/coverage-v8` peer snapshot caused by `pnpm install`.
