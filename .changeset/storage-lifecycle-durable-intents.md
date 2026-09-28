---
'@forge-cms/runtime': minor
'@forge-cms/testing': minor
---

Upload storage lifecycle is durable, and file reads respect access (spec 067, roadmap D04 part 2).

- **Durable storage intents.** Forge records, in the database, every step where an object could end
  up owned by no document:
  - **Upload:** an intent is written before the object is stored, and removed in the same batch that
    creates the document.
  - **Delete:** an intent is written in the same batch that deletes the document, and removed once
    the object is deleted.

  Before, a crash or a failed cleanup at either step left an orphaned object with only a log line. New
  `runtime.reconcileStorage(options)` / `reconcileStorage(runtime, options)` works the intents off. It
  never deletes an owned object, gives in-flight uploads a grace period (`DEFAULT_UPLOAD_GRACE_MS`,
  1 hour), and is safe to run concurrently. `runtime.syncSchema()` creates the
  `_forge_storage_intents` table when any collection is upload-enabled.

- **`handleFile` applies read access.** A key is served only as the file of the upload document that
  records it as `_storageKey`, and only if the caller may read that document (collection and row
  access, drafts). Before, anyone could fetch any key in storage, including the files of private and
  draft documents and objects Forge does not own. Keys with no owning document, including uploads
  recorded before `_storageKey` existed, now return `404`. Authenticated hits are
  `cache-control: private, no-store`, and a storage error no longer echoes its message to the client.
- **Upload deletes count their storage intents** against the 25-operation atomic batch limit.
- **Locale edits of a collection document** merge under a compare-and-set, as spec 066 did for
  globals. Two simultaneous edits of different locales can no longer both succeed while one is lost;
  the second gets `409`.
- Cleanup failures are logged with the key and error message only, never the error object.
- `@forge-cms/testing/contracts`: `runLocaleMergeContractTests` and `localeMergeCollections`.
