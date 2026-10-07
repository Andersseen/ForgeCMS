---
'@forge-cms/s3': minor
'@forge-cms/storage': minor
'@forge-cms/cloudflare': minor
'@forge-cms/testing': minor
---

Add `@forge-cms/s3`: a server-side `S3StorageAdapter` for AWS S3 and S3-compatible services (AWS SDK v3), with explicit bucket/region/endpoint/credentials/`forcePathStyle` configuration and a safe `/api/media` default public URL base. Certified against a real Garage service in CI; Backblaze B2 and Wasabi are configuration examples only.

`getPublicUrl()` of `InMemoryStorageAdapter` and `R2StorageAdapter` now percent-encodes each key segment (keys containing `#`, `?`, `%`, spaces or Unicode previously produced URLs that did not resolve back to the key). The shared `runStorageAdapterContractTests` suite is stronger: binary/empty bytes, every body shape, content type + metadata, idempotent delete, prefix listing and URL-sensitive keys.
