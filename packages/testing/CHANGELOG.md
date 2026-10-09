# @forge-cms/testing

## 0.12.1

### Patch Changes

- @forge-cms/core@0.12.1

## 0.12.0

### Patch Changes

- @forge-cms/core@0.12.0

## 0.11.0

### Minor Changes

- 0c1b62c: Add `@forge-cms/s3`: a server-side `S3StorageAdapter` for AWS S3 and S3-compatible services (AWS SDK v3), with explicit bucket/region/endpoint/credentials/`forcePathStyle` configuration and a safe `/api/media` default public URL base. Certified against a real Garage service in CI; Backblaze B2 and Wasabi are configuration examples only.

  `getPublicUrl()` of `InMemoryStorageAdapter` and `R2StorageAdapter` now percent-encodes each key segment (keys containing `#`, `?`, `%`, spaces or Unicode previously produced URLs that did not resolve back to the key). The shared `runStorageAdapterContractTests` suite is stronger: binary/empty bytes, every body shape, content type + metadata, idempotent delete, prefix listing and URL-sensitive keys.

### Patch Changes

- @forge-cms/core@0.11.0

## 0.10.2

### Patch Changes

- @forge-cms/core@0.10.2

## 0.10.1

### Patch Changes

- @forge-cms/core@0.10.1

## 0.10.0

### Patch Changes

- @forge-cms/core@0.10.0

## 0.9.3

### Patch Changes

- @forge-cms/core@0.9.3

## 0.9.2

### Patch Changes

- @forge-cms/core@0.9.2

## 0.9.1

### Patch Changes

- Updated dependencies [5dbf847]
  - @forge-cms/core@0.9.1

## 0.9.0

### Patch Changes

- @forge-cms/core@0.9.0

## 0.8.3

### Patch Changes

- @forge-cms/core@0.8.3

## 0.8.2

### Patch Changes

- dc7fd17: Reviewed migrations (spec 072, roadmap 0.7 M02). You can now apply the changes `syncSchema()` refuses
  (renames, backfills, enabling drafts, index replacements) as ordered, reviewed, declarative migrations:

  ```ts
  import { defineMigration } from '@forge-cms/db';

  const migrations = [
    defineMigration({
      id: '20260929_001_posts_headline_to_title',
      description: 'Rename posts.headline to title',
      destructive: true,
      statements: [{ sql: 'ALTER TABLE "posts" RENAME COLUMN "headline" TO "title"' }]
    })
  ];
  const report = await runtime.runMigrations(migrations, { allowDestructive: true });
  ```

  - Each migration commits as **one transaction** together with its entry in the new `_forge_migrations`
    ledger, on libSQL (`client.batch(…, 'write')`) and D1 (`batch()`). A migration that already ran is
    skipped, an edited one fails with `MIGRATION_CHECKSUM_MISMATCH`, and a reordered or removed one fails
    with `MIGRATION_HISTORY_MISMATCH` before anything runs. Two concurrent runners cannot both run the
    same position.
  - Failures are typed (`MigrationError`) and truthful: rolled back and recorded as failed, applied
    (including after a lost response), or outcome unknown. A failed migration runs again only with
    `retryFailed`/`replaceFailed`; destructive ones need `allowDestructive`.
  - `runtime.runMigrations()` reports `planSchema()` before and after, and runs the safe `syncSchema()`
    remainder. A post-flight problem is reported as committed, never as rolled back.
  - `runtime.planMigrations()` and `runtime.readMigrationHistory()` give read-only preflight and history.
  - `resetBaseline` replaces spec 070's manual `DELETE FROM "_forge_schema"` for semantic conversions.
  - New optional `DatabaseAdapter.runMigrations?()`/`readMigrationHistory?()`, implemented by
    `LibSqlDatabaseAdapter` and `D1DatabaseAdapter`. Custom adapters keep compiling; InMemory reports
    `MIGRATION_UNSUPPORTED`.
  - `@forge-cms/testing/contracts` adds `runMigrationContractTests`.

  `syncSchema()` and `init()` are unchanged and never run migrations. There are no down migrations and
  no CLI.
  - @forge-cms/core@0.8.2

## 0.8.1

### Patch Changes

- @forge-cms/core@0.8.1

## 0.8.0

### Minor Changes

- c1537c1: Detect schema drift and plan safe upgrades (spec 070, roadmap 0.7 M01).

  **Behaviour change:** on libSQL and D1, `syncSchema()` no longer reports success for a database it
  did not bring in line. It plans first. Fresh tables and safe additive changes run as one
  transaction. Anything that needs a reviewed migration throws `SchemaDriftError` with **nothing
  executed**, in any table. Examples: a removed field, a type change, `localized` or relation `many`
  toggled, a new required field on a non-empty table, `drafts`/`upload` enabled on a non-empty table,
  `unique` ⇄ `index` on the same field, a stale unique index, or a new unique index over duplicate rows.
  Renames are never guessed. Check a deployed database with `runtime.planSchema()` before upgrading; see
  `docs/SCHEMA-UPGRADES.md`.
  - `@forge-cms/db`:
    - `SchemaPlan`, `SchemaChange`, `SchemaChangeKind`, `SchemaChangeClassification`,
      `SchemaDriftError`, `isSchemaDriftError`, `formatSchemaPlan`, `mergeSchemaPlans` and
      `SCHEMA_BASELINE_TABLE`;
    - optional `DatabaseAdapter.planSchema(collections)`;
    - `planSqliteSchema`/`syncSqliteSchema` over a `SqliteSchemaExecutor`;
    - `desiredTableSchema` (the one model DDL and planning share).
    - `LibSqlDatabaseAdapter` and `InMemoryDatabaseAdapter` implement `planSchema` (InMemory's plan is
      always empty).
    - A new internal table, `_forge_schema`, records each table's semantic baseline (kind, localized,
      cardinality, target, required, default).
    - `generateAddColumnSql` is deprecated.
  - `@forge-cms/cloudflare`: `D1DatabaseAdapter` implements `planSchema` and plans before `syncSchema`.
  - `@forge-cms/auth`: optional `AuthAdapter.planSchema()`, implemented by
    `UsersCollectionAuthAdapter` (`_forge_bootstrap`), `ApiKeyAuthAdapter` (`_forge_api_keys`) and
    `CompositeAuthAdapter`.
  - `@forge-cms/runtime`: `ForgeCmsRuntime.planSchema()` covers collections, globals, versions,
    storage intents and the auth adapter's tables. `syncSchema()` refuses before touching any table.
    Spec 062's duplicate-version diagnostic is unchanged.
  - `@forge-cms/testing`: `runSchemaDriftContractTests` (from `@forge-cms/testing/contracts`).

### Patch Changes

- @forge-cms/core@0.8.0

## 0.7.0

### Patch Changes

- @forge-cms/core@0.7.0

## 0.6.0

### Minor Changes

- 31bae06: Atomic write batches (spec 060): an ordered list of database writes that all commit or none do — and
  first-admin provisioning now uses it, so a failed first-user creation can no longer burn the bootstrap
  claim.

  **Breaking for custom `DatabaseAdapter` implementations.** `DatabaseAdapter` gains one required member,
  `atomicWrite(operations)`, plus the exported types `AtomicWriteOperation` and `AtomicWriteResult`, the
  error `AtomicWriteConditionError` (`isAtomicWriteConditionError`), and the constant
  `ATOMIC_WRITE_MAX_OPERATIONS` (25). A batch is declarative, data-only and database-only — not a callback
  transaction, and never spanning object storage. Operations mirror the existing methods one to one:
  `{ type: 'create' | 'update' | 'delete' | 'updateIf' | 'deleteIf', collection, … }`. They run in order
  (later ones see earlier ones), results come back in the same order, and any failure rolls everything
  back: a unique violation rejects with `UniqueConstraintError` (its `collection` names the conflicting
  table), a plain `update` of a missing row rejects with `AtomicWriteConditionError`, and `updateIf` /
  `deleteIf` (which reuse spec 059's `WriteCondition` unchanged) report `applied: false` — a valid result —
  unless `requireApplied: true`, which fails the whole batch. Invalid input (too many operations, a
  malformed operation, on SQL adapters an unknown column or unregistered collection) rejects before
  anything is written. `InMemoryDatabaseAdapter` stages the batch and publishes it in one synchronous turn;
  `LibSqlDatabaseAdapter` runs one `client.batch(statements, 'write')`; `D1DatabaseAdapter` runs one D1
  `batch()`. Retry: `UniqueConstraintError`/`AtomicWriteConditionError` mean "known rolled back"; a network
  failure after the request left the process is outcome-unknown, so don't blindly retry — supply your own
  unique keys (on the SQL adapters, ids too) so a retry is recognisable. There is no exactly-once promise.

  If you implement `DatabaseAdapter` yourself, add `atomicWrite` (it must be genuinely atomic; a loop of
  independent writes is not an implementation — `UsersCollectionAuthAdapter` refuses an adapter without it),
  reuse the exported `assertValidAtomicWrite`, `toAtomicWriteError`, `atomicWriteMustApply` (which
  operations must be followed by the guard statement) and `ATOMIC_WRITE_REQUIRE_APPLIED_SQL` helpers if you
  are SQLite-based, and run the new `runDatabaseAdapterAtomicWriteContractTests` from
  `@forge-cms/testing/contracts`. Also fixed: `InMemoryDatabaseAdapter.update()` no longer rewrites a row's
  primary key when `data` contains an `id` (the SQL adapters always ignored it).

  `@forge-cms/auth`: `UsersCollectionAuthAdapter` provisions the first administrator with **one**
  `atomicWrite` — the `_forge_bootstrap` claim and the admin user commit together or not at all. Before,
  the claim committed first and the user second, so a failure of the second write (a database error, or
  two simultaneous submissions of the same first signup) left the claim consumed with no administrator, and
  every later signup became `viewer`. Concurrent first signups still yield exactly one admin. `init()` now
  also requires `userDatabase.atomicWrite` and throws an explicit error without it. The claim row is
  unchanged, so existing databases work as-is. **A database whose claim was already burned this way**
  (claim present, no admin) is deliberately not auto-repaired — public signup stays `viewer`, because
  "claim present, no admin" is indistinguishable from an intentionally emptied admin set. Recover from
  trusted server code with `auth.createUser({ email, password, role: 'admin' })` or
  `auth.updateUser(existingUserId, { role: 'admin' })`; neither touches the claim. Not covered: the generic
  content CRUD routes on the users collection do not go through `UsersCollectionAuthAdapter`.

  `@forge-cms/testing`: adds `runDatabaseAdapterAtomicWriteContractTests` and
  `runFirstAdminBootstrapContractTests` (barrier-held concurrent first signups on independent adapters, the
  failed-first-creation regression with fault injection, and the burned-claim compatibility cases);
  `createWriteGate` now also holds `create` and `atomicWrite`.

- 55bea49: Deleting a user through the auth adapter now respects content references (spec 065).
  - **`UsersCollectionAuthAdapter.deleteUser()` refuses a referenced user.** Before, it deleted the row
    directly, so a `posts.author → users` relation (or a many relation, or a global's relation) could be
    left pointing at a missing user. It now throws `UserMutationError` with the new reason
    **`'referenced'`** while any supported relation/upload field of a collection or global still names the
    user. This is restrict only: references are never cleared or cascaded. Change or remove them, then
    retry. The first-party `/api/auth/users/:id` routes already map `UserMutationError` to `409`.
  - **One atomic batch.** The relation guards (`assertCount … equals 0`, the same ones a content delete
    uses) and the spec-059 last-admin `deleteIf` commit in a single `atomicWrite`. A reference written by
    another client while the delete is in flight makes the delete fail, never both commit. A read-only
    preflight only produces the "still referenced N times" message. Deleting a missing user stays a
    no-op.
  - **Automatic wiring.** `ForgeCmsRuntime` hands the guard to the auth adapter at construction through
    the new optional `AuthAdapter.setManagedDeleteGuard(collection, guard)` (type `ManagedDeleteGuard`).
    This is infrastructure wiring; application code does not call it and needs no setup change.
    `CompositeAuthAdapter` forwards it to every child that manages the collection. Adapters that manage
    no collection are unaffected.
  - **Breaking for one configuration:** a custom `AuthAdapter` whose `managesCollection()` claims a
    collection that relation/upload fields reference, but which does not implement
    `setManagedDeleteGuard`, now makes the runtime refuse to start. Such an adapter cannot protect those
    references when it deletes.
  - A user collection whose referrers need more than 24 assertions, or an auth adapter whose
    `userDatabase` is not the content database, fails the delete closed with an explicit error.
  - `@forge-cms/testing/contracts`: `runAuthManagedDeleteContractTests` and `authManagedDeleteSchema`, a
    two-writer contract (run on InMemory, on-disk libSQL and local D1).

- 664ad5b: Conditional writes (spec 059): the last-admin invariant is now decided by the database inside one
  write, closing the concurrency gap spec 058 could only mitigate.

  **Breaking for custom `DatabaseAdapter` implementations.** `DatabaseAdapter` gains two required
  members, `updateIf(collection, id, data, condition)` and `deleteIf(collection, id, condition)`, plus the
  exported types `WriteCondition`, `ConditionalUpdateResult` and `ConditionalDeleteResult`. Each applies a
  write only if `condition` holds, with the check and the write as one atomic step against every other
  writer; a missing row or an unmet condition returns `{ applied: false }` (not an error), and failures
  reject — they are never reported as "not applied". `WriteCondition` has two optional clauses:
  `targetMatches` (per-row compare-and-set) and `keepAtLeast: { where, others }` (the target may leave the
  set matching `where` only while at least `others` other rows stay in it). If you implement
  `DatabaseAdapter` yourself, add both methods (a single SQL statement such as
  `UPDATE … WHERE id = ? AND <condition> RETURNING *` is what the built-in SQL adapters use; see
  `@forge-cms/db`'s `LibSqlDatabaseAdapter`) and run the new
  `runDatabaseAdapterConditionalWriteContractTests` from `@forge-cms/testing/contracts`.
  `InMemoryDatabaseAdapter`, `LibSqlDatabaseAdapter` and `D1DatabaseAdapter` implement it; the two SQL
  adapters use one guarded statement, so it holds across independent Workers/processes. `InMemory` is
  atomic within one adapter instance only.

  `@forge-cms/auth`: `UsersCollectionAuthAdapter.updateUser`/`deleteUser` no longer read an admin count,
  write, re-check and compensate. Demoting or deleting an admin is one guarded conditional write, so two
  concurrent last-admin mutations can no longer leave a users collection with zero admins; exactly one of
  two conflicting mutations succeeds and the other is refused with `UserMutationError` (`'last-admin'`).
  The guard is scoped to the configured users collection. An update that cannot remove admin privilege is
  still an ordinary update. `init()` now throws an explicit error if `userDatabase` does not implement
  `updateIf`/`deleteIf`, rather than failing at the first demotion. Unchanged: first-admin bootstrap,
  sessions, `_sessionVersion`, API keys and logout. Not covered: the generic content CRUD routes on the
  users collection do not go through `UsersCollectionAuthAdapter` and are not protected by this guard.

  `@forge-cms/testing`: adds `runDatabaseAdapterConditionalWriteContractTests`,
  `runLastAdminConcurrencyContractTests` and `createWriteGate` — a barrier that holds every party's write
  until all have reached it, so a check-then-write race is forced open deterministically instead of hoped
  for.

- b2c32c3: Versioned documents and their history can no longer diverge (spec 062).
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

- 2f25944: Globals and localization now behave as documented (spec 066, roadmap D04 part 1).
  - **Global access queries are enforced.** An `access.read`/`access.update` rule that returns a query
    (e.g. `{ region: 'eu' }`) used to be treated as "allowed". Now a read of a row the query does not
    match returns `null` (HTTP `404`, as for an unconfigured global). An update needs the stored row to
    match (`403`), and such a rule can no longer authorize the first write, because there is no row to
    match yet.
  - **Global writes after the first are partial**, like a collection `update()`:
    - omitted fields keep their stored values;
    - `defaultValue`s and the draft status apply only to the first write (before, a write without
      `_status` put a published global back to draft, and defaulted fields were reset);
    - validation runs on the merged document, so a required field no longer has to be re-sent;
    - `beforeValidate` hooks receive `previousData`;
    - `slug` fields with `autoGenerate` are generated.
  - **Simultaneous first writes to a global:** exactly one commits. The other gets `409
CONCURRENT_MODIFICATION` instead of an internal unique-constraint error that named the
    `_global_<slug>` table.
  - **Localized globals.** `defineGlobal({ locales: [...] })`, plus `locale` on
    `getGlobalDocument`/`updateGlobalDocument` and `?locale=` on the global HTTP routes. Writing one
    locale keeps the others. Two simultaneous per-locale edits (each written with `locale`) cannot silently drop one: the
    second gets a `409`. An undeclared locale is a `400`.
  - **Localization works on libSQL and D1.** A `localized` field's per-locale map was bound as a plain
    column value, so every write failed on SQL adapters. It is now stored as JSON in a TEXT column (new
    `encodeFieldValue`/`decodeFieldValue` in `@forge-cms/db`, used by both SQL adapters).
  - **Refused at startup** instead of accepted and broken:
    - a localized field with no `locales` declared;
    - a localized field of a kind other than `text`/`textarea`;
    - a localized field nested in `group`/`array`/`blocks`;
    - `access.create`/`access.delete` or delete hooks on a global.
  - `InMemoryDatabaseAdapter` (and the D1 unit-test mock) now reject a second row with an existing `id`
    as a unique conflict, as libSQL and D1 always did.
  - `@forge-cms/testing/contracts`: `runGlobalLifecycleContractTests` and `globalLifecycleGlobals`, a
    two-writer contract (run on InMemory, on-disk libSQL and local D1). The DatabaseAdapter contract adds
    a localized round-trip and a duplicate-id case.

- 3703fb7: Relation lifecycle is now atomic and race-safe (spec 064).
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

- 8dcdba8: Upload storage lifecycle is durable, and file reads respect access (spec 067, roadmap D04 part 2).
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

- c3aa6a8: Writes honour access consistently (spec 068).
  - **Write responses respect read access.** A create, update or delete run with
    `overrideAccess: false` returns only `{ id }` when the caller may not read the result: the read rule
    denies it, its query does not match, or it is a draft they cannot see. Before, the full document came
    back.
    - An access-checked `delete()` returned the raw stored row, including read-denied fields.
    - A global update returned a global its read rule hid.
    - Readable results are unchanged: they go through the normal read preparation, so read-denied
      fields are removed. Trusted calls and the HTTP envelope (`{ data }`) are unchanged.
  - **Update/delete access queries hold at the write.** A query-returning `update`/`delete` rule (and a
    global's `update` rule) is now also part of the write's own condition (`updateIf`/`deleteIf`
    `targetMatches`), for plain, versioned and cascading writes. A document moved out of the caller's
    scope between the access check and the write is a `409 CONCURRENT_MODIFICATION`, with nothing
    written. Before, the write applied.
  - `@forge-cms/testing/contracts`: `runWriteAccessContractTests`, `writeAccessSchema` and
    `createWriteHold` (hold one database's next write, whatever primitive it uses).

### Patch Changes

- Updated dependencies [2f25944]
- Updated dependencies [b2c32c3]
  - @forge-cms/core@0.6.0

## 0.5.0

### Minor Changes

- 23dac05: Add Forge Analytics (spec 057): an experimental, opt-in Cloudflare Analytics Engine integration.
  `@forge-cms/cloudflare` gains `AnalyticsEngineWriter`/`NoopAnalyticsWriter` for writing pageviews and
  `AnalyticsEngineQueryClient` for reading aggregated summaries via the Analytics Engine SQL API,
  `@forge-cms/angular` gains a first-party pageview tracker (`provideForgeAnalytics`) and a query client
  for the admin UI, `@forge-cms/admin` gains a reusable `ForgeAnalyticsDashboardComponent` and
  `forgeAdminAnalyticsRoutes()`, and `@forge-cms/testing` gains `runAnalyticsWriterContractTests`.
  Nothing is added to `DEFAULT_ADMIN_NAV` — every piece is opt-in and wired up only where an app chooses
  to use it (see `apps/demo-aesthetics`).

### Patch Changes

- @forge-cms/core@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [ab38c7b]
  - @forge-cms/core@0.4.0

## 0.3.0

### Patch Changes

- @forge-cms/core@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [7ec5e67]
  - @forge-cms/core@0.2.0

## 0.1.2

### Patch Changes

- @forge-cms/core@0.1.2

## 0.1.1

### Patch Changes

- d63d93f: feat: nested and/or queries, multi-field sort, findOne, and relation-array membership (spec 050)
  - **Nested boolean queries.** `DatabaseWhere` (`@forge-cms/db`) gains `{ and: [...] }` / `{ or: [...] }`
    groups that nest to arbitrary depth and compose with the existing field operators
    (`eq`/`ne`/`gt`/`gte`/`lt`/`lte`/`in`/`contains`). Existing flat queries (`{ status: 'published' }`)
    are unchanged and remain valid — `and`/`or` are additive, reserved top-level keys.
    `InMemoryDatabaseAdapter` (new `matchesWhere`), `LibSqlDatabaseAdapter` (drizzle `and`/`or`), and
    `D1DatabaseAdapter` (parenthesized parameterized SQL) all implement the same semantics, proven by a
    new shared cross-adapter query contract suite (`runDatabaseAdapterQueryContractTests`,
    `@forge-cms/testing/contracts`).
  - **`findOne()`** on the Local API (`ForgeCmsRuntime`/`operations.ts`, typed and untyped) returns the
    first matching document or `null` instead of throwing — the same access/hooks/drafts/populate
    pipeline as `find()`, with a real database-side `LIMIT 1` (no `count()` call, no fetch-then-slice).
  - **Multi-field sort.** `sort` accepts a field name (unchanged) or `{ field, order }[]` across
    `find`/`findOne` and all three adapters; stable tie-break (first field decides, ties fall through).
  - **Relation-array membership**: a new `containsValue` where-operator, valid only on `relation` fields,
    tests exact-element membership against a `relation({ many: true })` JSON array column —
    `Array.includes` in-process, `EXISTS (SELECT 1 FROM json_each(...) WHERE value = ?)` on libSQL/D1.
  - **Access-rule security, two fixes**: `mergeWhere` (`@forge-cms/runtime/access.ts`) now nests a
    consumer's `where` under the access constraint as `{ and: [accessConstraint, requestedWhere] }`
    instead of a shallow key-overwrite, so a consumer-supplied `or` can never escape row-level access
    control. Separately — and more seriously, caught by review before merge — an access constraint that
    legitimately resolves to `{ or: [] }` (a natural multi-tenant pattern: "this user belongs to zero
    tenants, so no branch of the read rule can ever be true") used to compile to _no SQL condition at all_
    on `LibSqlDatabaseAdapter`/`D1DatabaseAdapter`, returning every row instead of none — a real
    production auth-bypass on the only shipped SQL adapters, invisible on `InMemoryDatabaseAdapter` (which
    already got it right). Both are covered by regression tests, the second one run against a real libSQL
    database, not just InMemory.
  - **Validation, hardened after review**: `find`/`count`/`findOne` share one `validateWhere`/
    `validateSort` gate (`query-validation.ts`) that rejects unknown fields, a genuinely unknown operator
    name (including a typo mixed with a valid operator, e.g. `{ eq: 'a', contians: 'x' }`) while still
    allowing a fully non-operator-shaped object through as a bare equality value (matching a `json` field
    against a literal object — pre-existing, intentional behavior), `containsValue` on a non-relation
    field, and empty `and: []`/`or: []` groups, all as stable `ForgeError`s (400) — no adapter internals
    leak through, and a malformed sort entry (`?sort=[null]`) 400s instead of crashing into a 500.
    `_status` is now a valid sort/filter field on `drafts: true` collections. A `where` object mixing a
    flat key with `and`/`or` at the same level (`{ status: 'x', or: [...] }`) now correctly ANDs both
    instead of the flat key being silently dropped — this affects `matchesWhere` and both SQL builders too,
    not just validation.
  - **HTTP transport**: `?where=<url-encoded JSON>` carries a nested query (size-capped, strictly
    validated, 400 on malformed/oversized/non-object input); `sort=<url-encoded JSON array>` carries a
    multi-field sort. Existing flat `field=value`/`field[op]=value`/`sort=field&order=asc` query strings
    are unchanged.
  - **`@forge-cms/angular`**: `QueryOptions.where`/`sort` accept the same nested/multi-field shapes,
    serialized through the existing shared `buildQueryString` helper (existing flat-query URLs are
    byte-identical); `CmsApiService.findOne()` calls the list endpoint with `limit: 1`, no new server
    route.
  - **Typed Local API**: `TypedWhere` recurses through `and`/`or` keeping field-name narrowing at every
    level; `sort` accepts a typed multi-field list; `findOne` is fully typed.
  - `@forge-cms/core`'s `validateCollectionIdentifiers` now also rejects a field literally named `and`/
    `or` (reserved query keywords), the same way system field names are reserved.

- Updated dependencies [f88372c]
- Updated dependencies [d63d93f]
  - @forge-cms/core@0.1.1

## 0.1.0

### Patch Changes

- Updated dependencies [73050f1]
- Updated dependencies [a2c5837]
  - @forge-cms/core@0.1.0

## 0.0.2

### Patch Changes

- 18f25f8: feat: add collection-level compound indexes and unique constraints (spec 046)
  - `CollectionDefinition` gains `indexes?: { fields: string[]; unique?: boolean }[]` for constraints
    spanning more than one field (field order is the generated column order). Single-field
    `unique`/`index` on a field keep working unchanged.
  - `defineCollection` validates index definitions (empty `fields`, unknown field, duplicated field,
    duplicate equivalent indexes) and rejects them with a clear message.
  - `@forge-cms/db`'s `resolveCollectionIndexes`/`generateIndexSql` centralize deterministic SQL index
    generation (`idx_<collection>_<field...>`), shared by `D1DatabaseAdapter` and `LibSqlDatabaseAdapter`
    so the two SQLite-backed adapters cannot diverge.
  - `InMemoryDatabaseAdapter` now registers collections on `syncSchema` and enforces the same
    single-field and compound unique-index semantics as D1/libSQL (including SQLite's "NULL is never
    equal to NULL" exemption), closing a real dev/test-vs-production gap.
  - A unique conflict from any adapter surfaces as the same typed error: `@forge-cms/db`'s
    `UniqueConstraintError` at the adapter boundary, translated by `@forge-cms/runtime`'s operations
    layer into its own `UniqueConstraintError` (`ForgeError`, `409`, code `UNIQUE_CONSTRAINT`, carrying
    `collection`/`fields`) — the same HTTP handlers that already map every other `ForgeError` need no
    changes to return `409` for it.
  - `@forge-cms/testing/contracts` gains `runDatabaseAdapterConstraintContractTests`, run from all three
    adapters' test suites (InMemory, real libSQL, and a D1 mock that now enforces unique indexes for
    real) to prove identical behavior across adapters.

- Updated dependencies [18f25f8]
  - @forge-cms/core@0.0.2

## 0.1.0

### Minor Changes

- 2b5d6da: Add `count(collection)` to the `DatabaseAdapter` contract so callers can get record counts without fetching every row.
- 83f3b66: Normalize all package versions to 0.1.0 before the first npm publish.

### Patch Changes

- Updated dependencies [83f3b66]
  - @forge-cms/core@0.1.0
