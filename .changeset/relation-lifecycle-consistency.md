---
'@forge-cms/db': minor
'@forge-cms/cloudflare': minor
'@forge-cms/runtime': minor
'@forge-cms/testing': minor
---

Relation lifecycle is now atomic and race-safe (spec 064).

- **`atomicWrite` gains `assertCount`** (`@forge-cms/db`, InMemory, libSQL, D1): a read-only
  precondition `{ type: 'assertCount', collection, where?, equals }` that fails the whole batch with
  `AtomicWriteConditionError` unless exactly `equals` rows match at that point of the batch. It is the
  cross-collection guard spec 060 left open. `equals` must be a non-negative integer (`RangeError`).
- **Deletes commit their whole relation graph in one batch.** `runtime.delete()` plans every cascade,
  set-null and restrict consequence with reads only. It then runs all before-hooks and validation, and
  commits the set-null updates, the cascaded deletes, the root delete and "no reference remains"
  assertions in one `atomicWrite`. A late hook, validation or database failure no longer leaves earlier
  cascade steps committed. A reference created concurrently makes the delete fail with `409
CONCURRENT_MODIFICATION`, and so does a dependent edited since it was planned. Restrict is judged
  against the final state: a referrer deleted in the same plan does not block. A plan needing more than
  25 operations is refused before any hook or write; it is never chunked.
- **Writes validate relation targets.** `create`/`update`/`updateGlobal` refuse a relation or upload
  value naming a missing document (`400 INVALID_INPUT`, one `count` per target collection). They also
  carry an `assertCount` in the same batch as the write, and as the version snapshot on a versioned
  collection. A target deleted concurrently is a `409`. Updates validate only the relation values they
  change.
- **Upload fields restrict**, and **a global's relation/upload fields restrict**, deletion of their
  target.
- **Breaking — unsupported reference shapes are refused at startup.** The `ForgeCmsRuntime` constructor
  throws for any of these:
  - a `relation`/`upload` inside `group`/`array`/`blocks`;
  - a localized `relation`/`upload` (which could never be written);
  - a relation to an unregistered collection;
  - a global relation with `onDelete` other than `restrict`;
  - `cascade`/`set-null` onto an auth-managed collection.
    Migration: lift the reference to a top-level field, or keep the id in a `text`/`json` field as an
    explicit unchecked reference. Persisted data is never touched.
- `ConcurrentModificationError` accepts an optional `message`. `validateRelationSchema` is exported.
  `handleCascadeDelete`/`handleSetNullOnDelete`/`checkDeleteRestrictions` are deprecated (not atomic;
  no longer used by `runtime.delete()`). `findOrphanedDocuments` also reports `upload` fields.
- `@forge-cms/testing/contracts`: new `assertCount` cases in the atomic-write contract (it now also
  uses an `atomic_refs` table) and a new `runRelationLifecycleContractTests` two-writer suite
  (`createBatchHold`, `relationLifecycleCollections`).
