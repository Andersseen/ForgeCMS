---
'@forge-cms/db': minor
'@forge-cms/cloudflare': minor
'@forge-cms/auth': minor
'@forge-cms/testing': minor
---

Atomic write batches (spec 060): an ordered list of database writes that all commit or none do — and
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
