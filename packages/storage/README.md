# @forge-cms/storage

The file-storage contract of ForgeCMS: the `StorageAdapter` interface (`init`, `put`, `get`, `delete`, `getPublicUrl`, `list`) and
`InMemoryStorageAdapter`.

**Who needs it:** every project that uses upload-enabled collections, and anyone writing a storage adapter.
**Boundary:** server only.

```sh
pnpm add @forge-cms/storage
```

Durable implementations live elsewhere: `R2StorageAdapter` in [`@forge-cms/cloudflare`](../cloudflare) and
`S3StorageAdapter` in [`@forge-cms/s3`](../s3). `InMemoryStorageAdapter` is for development and tests only — it forgets
everything on restart, and a production build must not fall back to it. A new adapter must pass
`runStorageAdapterContractTests` from `@forge-cms/testing/contracts`.

Uploads reach storage through `POST /api/v1/<upload-collection>` (`multipart/form-data`, part named `file`); files are
served by `handleFile` from `@forge-cms/runtime`, which applies the owning document's access rules. Known limits: no
presigned/direct-to-storage upload, no image processing, no transaction across the database and the object store (storage
intents and `reconcileStorage()` close the gap).

Reference: [docs/REFERENCE.md](../../docs/REFERENCE.md#forge-cmsstorage) · guide: <https://forge-cms.pages.dev/docs/uploads>
