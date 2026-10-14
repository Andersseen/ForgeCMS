# @forge-cms/s3

## 1.0.0-rc.1

### Patch Changes

- @forge-cms/storage@1.0.0-rc.1

## 1.0.0-rc.0

### Major Changes

- ForgeCMS 1.0 compatibility commitment. This is a version milestone, not a behavioural change: it introduces no new feature relative to the final `0.13.x`
  line. The stable public surface was frozen in `0.13.0` (U03) and the 0.12 certification work (R01–R04) supplies the evidence. From `1.0.0` the semver and
  deprecation rules in `docs/SUPPORT.md` apply.

### Patch Changes

- Updated dependencies
  - @forge-cms/storage@1.0.0-rc.0

## 0.13.4

### Patch Changes

- 47b0f72: Documentation only (roadmap 0.12 / R04, spec 091): the README shipped in every package now describes what the package is, who needs it, its stable entry points, its server/browser boundary and its support status.
  `@forge-cms/api`, `runtime`, `auth`, `storage`, `core` and `testing` no longer say the implemented CRUD runtime, request handling, authentication and storage are future work. No code, export, option or default changed.
- Updated dependencies [47b0f72]
  - @forge-cms/storage@0.13.4

## 0.13.3

### Patch Changes

- @forge-cms/storage@0.13.3

## 0.13.2

### Patch Changes

- @forge-cms/storage@0.13.2

## 0.13.1

### Patch Changes

- @forge-cms/storage@0.13.1

## 0.13.0

### Patch Changes

- @forge-cms/storage@0.13.0

## 0.12.1

### Patch Changes

- @forge-cms/storage@0.12.1

## 0.12.0

### Patch Changes

- @forge-cms/storage@0.12.0

## 0.11.0

### Minor Changes

- 0c1b62c: Add `@forge-cms/s3`: a server-side `S3StorageAdapter` for AWS S3 and S3-compatible services (AWS SDK v3), with explicit bucket/region/endpoint/credentials/`forcePathStyle` configuration and a safe `/api/media` default public URL base. Certified against a real Garage service in CI; Backblaze B2 and Wasabi are configuration examples only.

  `getPublicUrl()` of `InMemoryStorageAdapter` and `R2StorageAdapter` now percent-encodes each key segment (keys containing `#`, `?`, `%`, spaces or Unicode previously produced URLs that did not resolve back to the key). The shared `runStorageAdapterContractTests` suite is stronger: binary/empty bytes, every body shape, content type + metadata, idempotent delete, prefix listing and URL-sensitive keys.

### Patch Changes

- Updated dependencies [0c1b62c]
  - @forge-cms/storage@0.11.0
