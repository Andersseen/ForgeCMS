# @forge-cms/s3

A server-side `StorageAdapter` for ForgeCMS backed by the **S3 API** (AWS SDK for JavaScript v3). One
adapter, configured per service — not a family of provider integrations.

```bash
pnpm add @forge-cms/s3
```

```ts
import { S3StorageAdapter } from '@forge-cms/s3';

const storage = new S3StorageAdapter({
  bucket: env.S3_BUCKET,
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT, // omit for AWS S3
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY
  }
});
```

Pass it to `ForgeCmsRuntime` as `adapters.storage`. The adapter is **server-side only**: it holds
credentials and must never be imported by browser code (`@forge-cms/angular` and `@forge-cms/admin`
do not depend on it). Your application reads its own environment and passes values in explicitly; the
adapter reads no environment variables itself.

## Options

| Option           | Required | Meaning                                                                                                                                                  |
| ---------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bucket`         | yes      | Existing bucket. Forge never creates buckets, policies or IAM.                                                                                           |
| `region`         | yes      | Region / signing region. Never defaulted. S3-compatible services publish the value to use (Garage: its `s3_region`).                                     |
| `endpoint`       | no       | Absolute `http:`/`https:` URL of an S3-compatible service. Omit for AWS S3. Plain `http:` is for local development and tests only — use HTTPS elsewhere. |
| `credentials`    | no       | `{ accessKeyId, secretAccessKey, sessionToken? }`. Omit to use the AWS SDK's normal server-side credential resolution (env, shared config, IAM role…).   |
| `forcePathStyle` | no       | AWS SDK v3 `forcePathStyle`, default `false`. Many self-hosted services need `true`.                                                                     |
| `publicUrlBase`  | no       | Base of `getPublicUrl()`. Default `/api/media`. See [Public URLs](#public-urls-and-access).                                                              |

An empty `bucket`/`region`, a non-`http(s)` `endpoint` or blank explicit credentials throw a clear
configuration error at construction. Error messages never contain credentials or the endpoint string.

## Behaviour

Same contract as the InMemory and R2 adapters (`runStorageAdapterContractTests`):

- `put` keeps exact bytes, content type and custom metadata. Accepts `Blob`, `ArrayBuffer`,
  `Uint8Array` and `ReadableStream`; the object is buffered in memory (upload size limits belong to
  Forge's upload handler). No multipart or presigned uploads.
- `get` returns the bytes as an `ArrayBuffer`, or `null` **only** when the key does not exist
  (`NoSuchKey`/`NotFound`). A missing bucket, `403`, bad credentials, network failure or a service
  error **rejects** — never `null`.
- `delete` is idempotent: a missing key resolves. Other failures reject.
- `list(prefix?)` returns every matching object (`key`, `size`); provider pages are followed
  transparently. Content type and metadata are not populated by `list` (no per-object requests).
- S3 normalises custom metadata keys to **lowercase** and values must be ASCII; use lowercase keys.

## Public URLs and access

`getPublicUrl(key)` percent-encodes each key segment and keeps `/` as the hierarchy separator:
`media/id-my photo #1.png` → `/api/media/media/id-my%20photo%20%231.png`.

- **Default `/api/media` (recommended).** URLs go through Forge's `handleFile`, which finds the owning
  document, applies collection/row access and draft visibility, and sets cache policy (public vs
  authenticated `private, no-store`). The bucket can stay **private**.
- **A direct bucket/CDN base** (`publicUrlBase: 'https://cdn.example.com'`) is opt-in and **bypasses
  `handleFile` and every Forge access check**. Setting it does not make anything public; making the bucket
  or CDN readable is your infrastructure's job, and the adapter configures no bucket policy.

## Provider profiles

Only **Garage** is exercised in CI. The others are configuration examples for services that implement the
S3 API; nothing here claims they are tested.

### AWS S3 — configurable, not CI-certified

```ts
new S3StorageAdapter({
  bucket: 'my-forge-media',
  region: 'eu-west-1'
  // credentials omitted → AWS SDK provider chain (e.g. an IAM role); or pass them explicitly.
  // no endpoint; forcePathStyle stays false
});
```

Forge does not provision the bucket or IAM permissions (needs `s3:GetObject`, `s3:PutObject`,
`s3:DeleteObject`, `s3:ListBucket`).

### Garage — **certified in CI** (spec 082)

```ts
new S3StorageAdapter({
  bucket: 'forge-s3-test',
  region: 'garage', // Garage's `s3_region`
  endpoint: 'http://127.0.0.1:3900', // local HTTP: development and tests only
  forcePathStyle: true,
  credentials: { accessKeyId: 'GK…', secretAccessKey: '…' }
});
```

`pnpm test:s3` (repository root) starts a pinned `dxflrs/garage` container, creates a throwaway key and
bucket, and runs the shared contract plus focused cases. It needs Docker and fails without it.

### Backblaze B2 (S3-compatible API) — configuration example — not part of the P01 CI certification matrix

```ts
new S3StorageAdapter({
  bucket: 'my-bucket',
  region: 'us-west-004', // must match the endpoint's region
  endpoint: 'https://s3.us-west-004.backblazeb2.com',
  credentials: { accessKeyId: env.B2_KEY_ID, secretAccessKey: env.B2_APPLICATION_KEY }
});
```

### Wasabi — configuration example — not part of the P01 CI certification matrix

```ts
new S3StorageAdapter({
  bucket: 'my-bucket',
  region: 'eu-central-1',
  endpoint: 'https://s3.eu-central-1.wasabisys.com',
  credentials: { accessKeyId: env.WASABI_ACCESS_KEY, secretAccessKey: env.WASABI_SECRET_KEY }
});
```

Check your provider's documentation for the exact endpoint and whether it requires path-style addressing.

## Limits (P01)

Basic adapter only. Not included: presigned or browser-direct uploads, multipart uploads, streaming
responses, CDN features, image transforms, bucket creation, lifecycle policies, backup/restore of
objects, and the libSQL + S3 upload lifecycle guide (later 0.10 work).
