---
'@forge-cms/db': minor
'@forge-cms/cloudflare': minor
'@forge-cms/auth': minor
'@forge-cms/testing': minor
---

Conditional writes (spec 059): the last-admin invariant is now decided by the database inside one
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
