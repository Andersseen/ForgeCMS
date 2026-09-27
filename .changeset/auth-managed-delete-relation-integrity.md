---
'@forge-cms/auth': minor
'@forge-cms/runtime': minor
'@forge-cms/testing': minor
---

Deleting a user through the auth adapter now respects content references (spec 065).

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
