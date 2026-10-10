# @forge-cms/storage

## 0.13.0

## 0.12.1

## 0.12.0

## 0.11.0

### Minor Changes

- 0c1b62c: Add `@forge-cms/s3`: a server-side `S3StorageAdapter` for AWS S3 and S3-compatible services (AWS SDK v3), with explicit bucket/region/endpoint/credentials/`forcePathStyle` configuration and a safe `/api/media` default public URL base. Certified against a real Garage service in CI; Backblaze B2 and Wasabi are configuration examples only.

  `getPublicUrl()` of `InMemoryStorageAdapter` and `R2StorageAdapter` now percent-encodes each key segment (keys containing `#`, `?`, `%`, spaces or Unicode previously produced URLs that did not resolve back to the key). The shared `runStorageAdapterContractTests` suite is stronger: binary/empty bytes, every body shape, content type + metadata, idempotent delete, prefix listing and URL-sensitive keys.

## 0.10.2

## 0.10.1

## 0.10.0

## 0.9.3

## 0.9.2

## 0.9.1

## 0.9.0

## 0.8.3

## 0.8.2

## 0.8.1

## 0.8.0

## 0.7.0

## 0.6.0

## 0.5.0

## 0.4.0

## 0.3.0

## 0.2.0

## 0.1.2

## 0.1.1

## 0.1.0

## 0.0.2

## 0.1.0

### Minor Changes

- 83f3b66: Normalize all package versions to 0.1.0 before the first npm publish.
