# @forge-cms/db

## 0.12.1

### Patch Changes

- @forge-cms/core@0.12.1

## 0.12.0

### Patch Changes

- @forge-cms/core@0.12.0

## 0.11.0

### Patch Changes

- @forge-cms/core@0.11.0

## 0.10.2

### Patch Changes

- 8e6941f: `LibSqlDatabaseAdapter` now loads `@libsql/client` and `drizzle-orm/libsql` on its first database operation instead of when `@forge-cms/db` is imported (spec 081). Importing the package entry no longer makes Nitro, Vite or wrangler resolve libSQL's platform-specific native package, so an app that only uses `InMemoryDatabaseAdapter` (or D1) builds and serves without any libSQL packaging workaround. The exports and types are unchanged. One observable difference: `init()` no longer opens the database — a bad URL now surfaces as a rejection from the first operation. On Nitro's `node-server` preset, an app that really uses a `file:` libSQL database must keep its dependencies in `node_modules` (`nitro: { externals: { trace: false } }`); see the SSR guide.
  - @forge-cms/core@0.10.2

## 0.10.1

### Patch Changes

- @forge-cms/core@0.10.1

## 0.10.0

### Patch Changes

- @forge-cms/core@0.10.0

## 0.9.3

### Patch Changes

- 5aa0bfe: Schema planning (`syncSchema()` / `planSchema()` on the SQLite adapters, including D1) now reads every
  table's columns and indexes in three queries in total instead of `2 + indexes` per table. On D1 each
  query is a network round trip on every cold start; a ~10-collection site issued ~100 of them, which took
  more than 10 seconds from a Cloudflare colo far from the database. No behavior or API change.
  - @forge-cms/core@0.9.3

## 0.9.2

### Patch Changes

- @forge-cms/core@0.9.2

## 0.9.1

### Patch Changes

- 5dbf847: Honest schema-to-wire types for the Angular client (spec 076, roadmap 0.8 C02). Patch level on purpose: the fixed group already moves to `0.9.0` through C01's pending minor changeset.
  - `@forge-cms/angular`: share the content model's **type** with the browser (`type SiteSchema = ForgeSchema<typeof collections, [typeof siteSettings]>`, from `import type`, so no server code is bundled) and call `injectForgeClient<SiteSchema>()`. Slugs, `where`/`sort` fields, create/update payloads and results are checked against what the HTTP API sends: ISO date strings, `depth: 1` targets that may be `null` (many: readable targets only), access-controlled fields optional, `access.read: []` fields absent, localized fields a per-locale map without `locale` and a string with it, write results that may be only `{ id }`. New types: `ForgeSchema`, `ForgeDocument`, `ForgeCreateInput`, `ForgeUpdateInput`, `ForgeWriteResult`, `ForgeGlobalDocument`, `ForgeGlobalInput`, `ForgeWhere`, `ForgeSort`, `ForgeQueryOptions`, `UntypedDocument` and friends. `@forge-cms/core` is now a (type-only) dependency.
  - **Migration:** `CmsApiService` is `CmsApiService<S = UntypedForgeSchema>`; `inject(CmsApiService)` is the untyped client (results `UntypedDocument`). The per-method response generic is removed — `getDocument<Post>(…)` no longer compiles: use the typed client, or treat results as untyped. `collectionResource<Post>(…)` becomes `collectionResource<SiteSchema, 'posts'>(…)` (or no type argument). Typed create/update results are `document | { id }`.
  - **Dates (demo finding 24):** a date is an ISO-8601 `toISOString()` string at rest, on Local API reads and on the wire. `@forge-cms/runtime` canonicalizes every valid date on write (top-level and nested; before, in-memory echoed the caller's text and a numeric timestamp read back as `null` on libSQL/D1). `@forge-cms/db`'s `fromDbValue` returns the canonical string instead of a `Date`. `@forge-cms/core`: `DateField` reads as `string`; the typed Local API input takes `Date | string` (`FieldInputValue`, `InferInputFields`). **Local API reads of dates on libSQL/D1 are now strings** — use `new Date(value)` where a `Date` is needed.
  - `@forge-cms/core`: `defineField.*` keep their options as literal types (`required`, `access`, `localized`, relation target and `many`, select options); `defineCollection`/`defineGlobal` keep a literal `drafts: true` (`DraftsFlag`); `FieldDefinition`'s options parameter is no longer constrained. A `required` localized field now rejects an empty per-locale map `{}`.
  - `@forge-cms/auth`: `defineUsersCollection()` keeps a literal slug (`'users'` by default) instead of `string`, so registries containing it keep typed slugs.
  - `@forge-cms/admin`: uses the untyped client (no behaviour change).

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

### Patch Changes

- Updated dependencies [2f25944]
- Updated dependencies [b2c32c3]
  - @forge-cms/core@0.6.0

## 0.5.0

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

- 8a31e33: fix: real-Cloudflare-runtime integration testing surfaces and fixes two production-parity bugs (spec 051)
  - **`@forge-cms/cloudflare`** gains a real-local-Cloudflare-Workers-runtime integration suite
    (`pnpm test:cloudflare`, `@cloudflare/vitest-plugin` — Miniflare/workerd, real D1 + R2 bindings, no
    account/credentials/remote resources), kept separate from the existing fast mock-based `pnpm test`.
    It proves — against real bindings, not only the hand-rolled mock — D1 schema sync (incl. idempotent
    repeat calls and the spec-049 shared-`ApiKeyAuthAdapter`-instance coexistence guarantee), compound
    unique indexes, the full nested `and`/`or`/multi-sort/`containsValue` query contract (reusing the
    existing shared contract suites, not duplicating them), the spec-050 empty-OR access-constraint
    deny-all fix, JSON/relation/API-key-scope round-tripping, `ApiKeyAuthAdapter`'s full lifecycle,
    `CompositeAuthAdapter` correctly propagating a real D1 failure instead of downgrading it to a 401,
    one full real-Worker-runtime HTTP request/response path, additive schema evolution, and
    binding-validation error messages against a real Miniflare `env` shape — plus the `StorageAdapter`
    contract and specifics against a real local R2 binding.
  - **Bug fix (`@forge-cms/db`):** real D1's raw unique-constraint error message carries a trailing
    diagnostic suffix (`table.col1, table.col2: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)`)
    that the D1 test mock never reproduced. `parseSqliteUniqueConstraintMessage` naively split on `.`/`,`
    without stripping it, corrupting the last column's name in a compound-unique conflict — which would
    have leaked that diagnostic text into `UniqueConstraintError.fields` and the public HTTP error
    response's `details`. Fixed, with a new dedicated unit test file, and fed back into the D1 mock so
    this bug class is now caught by the fast unit suite too.
  - **Bug fix (`@forge-cms/runtime`):** deleting an upload-enabled document's underlying storage object
    used to happen only in `handlers.ts` (the HTTP layer) — a direct Local API caller (server code, a
    hook, a seed script) orphaned the object. Moved into `operations.ts`'s `deleteDocument` itself
    (storage deleted only after the database delete succeeds, never on a denied/failed delete,
    best-effort/log-only on cleanup failure); `handlers.ts`'s `handleDelete` dropped its now-duplicate
    copy.
  - **Packaging fix (`@forge-cms/cloudflare`):** `@forge-cms/storage` was missing from `dependencies`
    even though `r2.adapter.ts` imports its types (it only worked via pnpm hoisting) — added. Removed the
    unused `drizzle-orm` devDependency (the adapter hand-builds SQL).
  - @forge-cms/core@0.1.2

## 0.1.1

### Patch Changes

- f88372c: fix: harden auth error semantics, API-key lifecycle, and DB-adapter schema sync (spec 049)
  - **Fixed a severe schema-sync bug**: `InMemoryDatabaseAdapter`, `LibSqlDatabaseAdapter`, and
    `D1DatabaseAdapter` all cleared their internal collection registry on every `syncSchema()` call. When
    `ApiKeyAuthAdapter` shares a `DatabaseAdapter` instance with the main runtime (the documented/tested
    wiring), `ForgeCmsRuntime.syncSchema()` calling `auth.syncSchema?.()` after registering consumer
    collections would wipe them out — breaking every subsequent D1/libSQL operation and silently
    disabling InMemory's unique-constraint enforcement. `syncSchema()` now upserts by slug instead.
  - `CompositeAuthAdapter.requireAuth()` no longer swallows every exception from a child adapter — only
    an expected `ForgeAuthError` falls through to the next strategy; an unexpected error (a DB outage, a
    misconfiguration) propagates instead of becoming a misleading `401`.
  - `@forge-cms/runtime`'s HTTP handlers (`authorize`/`resolveOptionalUser`/`handlePreview`) apply the
    same rule at the boundary that matters most: a non-`ForgeAuthError` from `auth.requireAuth()` now
    surfaces as `500`, not `401` or a silently-anonymous `200`.
  - `AuthAdapter` gains an optional `canHandleToken?(token: string): boolean` — `CompositeAuthAdapter`
    consults it to skip a strategy that obviously doesn't own a token (no DB round-trip, no HMAC verify
    wasted); `ApiKeyAuthAdapter` and the signed-token-based adapters implement it. Fully backward
    compatible — adapters without it are always attempted, exactly as before.
  - `ApiKeyAuthAdapter.createApiKey` now validates input (non-empty `name`, a parseable/future
    `expiresAt`) and normalizes `scopes` (trim, drop empty, dedupe, preserve order). `revokeApiKey` is
    idempotent (preserves the original `revokedAt` rather than sliding it forward). `lastUsedAt` writes
    are throttled (5 min default, `lastUsedAtThrottleMs` option) instead of firing on every request.
  - `_forge_*` is now a reserved collection/global-slug prefix: `defineCollection`/`defineGlobal` reject
    a consumer definition that collides with a Forge-internal system collection like `_forge_api_keys`.
  - No behavior change to human auth, the typed Local API, or any existing adapter contract beyond the
    fixes above.

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

## 0.0.1

### Patch Changes

- 44956ef: Fix `generateCreateTableSql` to emit single-line SQL. Cloudflare D1's real `exec()` splits its input on `\n` to detect multiple statements, so the previous pretty-printed multi-line `CREATE TABLE` broke with `SQLITE_ERROR: incomplete input` against a real D1 binding — invisible in unit tests since they only exercise a mocked D1 adapter, not real SQLite. Caught by verifying spec 005 against a real local D1 binding.
