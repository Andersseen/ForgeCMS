# @forge-cms/testing

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

### Patch Changes

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
