# @forge-cms/s3

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
