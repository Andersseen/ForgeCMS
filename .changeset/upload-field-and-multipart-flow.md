---
'@forge-cms/core': minor
'@forge-cms/db': minor
'@forge-cms/runtime': minor
---

Added an `upload` field kind and a real multipart upload flow (spec 016).

- `@forge-cms/core`: `defineField.upload({ collection })` — a string id referencing a document in the
  named upload-enabled collection, validated/stored exactly like a single `relation`. `CollectionDefinition`
  gains `upload?: boolean`, marking a collection as upload-enabled.
- `@forge-cms/db`: `'upload'` maps to the `TEXT` SQL type.
- `@forge-cms/runtime`: `handleCreate` now also accepts a `multipart/form-data` body on `upload: true`
  collections — it uploads the `file` part through the configured `StorageAdapter`, then builds the create
  body from whichever of `filename`/`url`/`contentType`/`filesize` (plus any other multipart field) the
  collection actually declares as fields, before continuing through the existing field-access/hooks/
  validation pipeline unchanged. The JSON-body create path is unaffected on every collection, upload-enabled
  or not.
