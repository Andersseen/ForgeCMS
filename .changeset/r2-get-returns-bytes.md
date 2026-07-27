---
'@forge-cms/cloudflare': patch
---

Fix `R2StorageAdapter.get()` returning no bytes, and hold the adapter to the storage contract.

`get()` called `bucket.head()`, which returns metadata only — so `StorageObject.body` was always
undefined and nothing could serve a stored file: uploads succeeded and then rendered as broken
images. It now uses `bucket.get()` and returns the object's bytes; `head()` is exposed separately
for the metadata-only case.

Two related fixes:

- `runStorageAdapterContractTests` now runs against `R2StorageAdapter`. CONVENTIONS.md has always
  required this of every adapter, but only the in-memory ones did it, which is why a write-only
  `get()` survived. The suite already asserted the body round-trip.
- `getPublicUrl()` defaults to `/api/media/<key>` — the path `handleFile` is meant to be mounted on,
  matching `InMemoryStorageAdapter` — instead of the fictional `https://r2.example.com/<key>`. Pass
  `publicUrlBase` (constructor or setter) for a bucket domain or CDN.
