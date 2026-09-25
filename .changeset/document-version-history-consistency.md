---
'@forge-cms/runtime': minor
'@forge-cms/testing': minor
---

Versioned documents and their history can no longer diverge (spec 062).

- **One atomic write.** On a `versions`-enabled collection, `create()` writes the document and version 1,
  and `update()` / `restoreVersion()` write the document change and its new snapshot, in one
  `DatabaseAdapter.atomicWrite()` batch. If the snapshot cannot be written the document change is rolled
  back too (previously the document could be created or changed with no matching history).
- **Unique version identity.** The internal `_versions_<collection>` table gets a unique
  `(documentId, versionNumber)` index. `syncSchema()` adds it (plus an internal `snapshotFormat` column)
  additively. **Upgrade note:** a database that already holds duplicate version numbers for one document —
  possible only from the old concurrent-update race — cannot get the index; `syncSchema()` then fails with a
  message listing the duplicates and a query to inspect them. Forge never deletes, renumbers or merges
  history for you: decide which rows to keep, fix them (after a backup), restart.
- **Concurrent updates conflict instead of silently overwriting.** Two updates of the same versioned
  document racing from the same state: one commits, the other rejects with the new
  `ConcurrentModificationError` (HTTP `409`, code `CONCURRENT_MODIFICATION`) and writes nothing. Forge does
  not retry it for you (`before*` hooks may already have run) — re-read and resubmit. `afterChange` /
  `afterOperation` only run for a committed write.
- **Full snapshots.** `Version.data` of an automatic snapshot is now the full restorable content — every
  declared field (`null` when unset) plus `_status` on drafts collections — instead of just the update's
  patch. It never contains `id`, `created_at`, `updated_at` or `_storageKey`, and a restore never rewrites
  them. Snapshots written before this release keep their old (patch) shape and restore only the fields
  they contain.
- **Restore** still runs the normal update pipeline, now with only the fields that actually change, so
  field-level write rules apply to what the restore modifies. A full snapshot that predates a
  now-required field fails current validation instead of producing an invalid document.
- Re-creating a document with the id of a deleted document whose history is still retained is refused
  with `UniqueConstraintError` (`fields: ['id']`) instead of adopting that history.
- Manual `createVersion()` retries its version-number allocation (at most 3 attempts) and otherwise
  throws `ConcurrentModificationError`; it still stores `data` verbatim.
- Versioned collections now require a `DatabaseAdapter` implementing `atomicWrite()` (every built-in
  adapter does); `syncSchema()` refuses otherwise.

`@forge-cms/testing/contracts` adds `runVersionHistoryContractTests`, the deterministic two-writer and
fault-injection suite used against InMemory, libSQL and real local D1.
