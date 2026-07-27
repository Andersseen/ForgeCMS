---
'@forge-cms/core': minor
'@forge-cms/runtime': minor
'@forge-cms/db': minor
'@forge-cms/storage': minor
'@forge-cms/cloudflare': minor
'@forge-cms/testing': minor
---

Close the core gaps the real-world demo build found (spec 040).

- `depth: 1` now populates `upload` fields, not just `relation` — every image in a populated
  response used to come back as a bare id.
- `defaultValue` and `slug.autoGenerate`/`sourceField` are honoured by the write pipeline. Both
  existed in the field options and were read by nothing.
- Hooks receive `overrideAccess`, so a hook can finally tell trusted server-side code from a request
  off the network — both arrive with `user: null`.
- `D1DatabaseAdapter` and `R2StorageAdapter` take a configurable binding name
  (`new R2StorageAdapter({ binding: 'MEDIA' })`); `R2StorageAdapter` also accepts `publicUrlBase`.
- `InMemoryDatabaseAdapter` stamps `created_at`/`updated_at` like the SQL adapters, and the shared
  contract suite asserts it.
- `contains` is case-insensitive everywhere, matching SQLite's `LIKE`; it was case-sensitive only in
  the in-memory adapter, so a search box behaved differently in development and production.
- New `handleFile` transport handler serves stored bytes, and `InMemoryStorageAdapter.getPublicUrl`
  returns a servable `/api/media/<key>` instead of the fictional `https://forge.test/...`.
- New exports: `slugify` (core), `handleFile`, `applyFieldDefaults`, `applyAutoSlugs` (runtime).
