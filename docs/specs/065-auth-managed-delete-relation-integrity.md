# 065 — Auth-managed delete relation integrity

- **Status:** done <!-- approved by the maintainer's task brief, which directs this exact bounded step -->
- **Author:** agent draft (explicit maintainer directive: close D02's last open cell)
- **Date:** 2026-09-27
- **Branch:** `feature/spec-065-auth-managed-delete-relation-integrity`
- **Affected packages/apps:** @forge-cms/auth, @forge-cms/runtime, @forge-cms/testing,
  @forge-cms/cloudflare (tests only), the three apps' `/api/auth/users/:id` DELETE route comments, docs
  (roadmap 0.6 D02, STATE, ARCHITECTURE, ROADMAP, collections/browser-auth docs)

## Context / Why

Spec 064 made relation lifecycle atomic for content collections and left exactly one matrix cell open
(its §1, "Auth-managed targets (open)"). A collection managed by the auth adapter (spec 061: `users`, or
whatever slug `UsersCollectionAuthAdapter({ collection })` names) is deleted only through
`UsersCollectionAuthAdapter.deleteUser()`. That method runs one `deleteIf(users, id, LAST_ADMIN_GUARD)`
and never consults content, so a reference to the user is left dangling.

**Reproduced on `main` (`309906f`) before changing code:**

1. **Dangling reference (real on-disk libSQL, two independent clients).** Schema: `defineUsersCollection()`
   plus `posts.author → users` (required). Client A creates admin, viewer `u2` and `p1.author = u2`.
   Client B calls `auth.deleteUser(u2)`. Result: `u2 → null`, `p1 → { author: '<u2 id>' }`. The
   delete succeeded and `p1.author` names a missing user. This is the writer-first ordering; with no
   check at all, any interleaving commits both.
2. **The same on InMemory and on real local D1 (workerd).** The new contract (below) was run against the
   unfixed source. Every "referenced user is refused" scenario (single, many, global,
   referenced last admin) got `'ok'`: the delete committed. The two "writer first" race scenarios
   could not even reach their gate, because the old path never builds a batch.
3. **Delete-first ordering was already safe.** `deleteUser(u2)` commits while a
   `create(article.author = u2)` is held. The create then fails `409 CONCURRENT_MODIFICATION` through
   spec 064's target `assertCount`. This passed on InMemory, libSQL and D1 before the fix.

## Goal

A relation write and a user deletion through the canonical auth lifecycle can never both commit into a
dangling reference, in either order, for every supported reference to an auth-managed collection. With
this cell closed, D02 is complete.

## Non-goals

- Making `runtime.delete({ collection: 'users' })` valid again. Spec 061's refusal stays.
- Cascade or set-null of content when a user is deleted, reassignment UI, "delete the user's content".
  Auth-managed targets stay **restrict only** (spec 064 already refuses other `onDelete` values at
  startup).
- Routing relation lifecycle through `createUser`/`updateUser`/`deleteUser`, or giving auth any
  knowledge of the content schema.
- Guarding raw `DatabaseAdapter.delete('users', id)`. Direct database access stays trusted, low-level
  infrastructure below every Forge guarantee (specs 061/063).
- D04, H04, Strata, admin redesign, anything else in the brief's §37.

## Design

### 1. The bridge: runtime hands auth data, auth never imports runtime

`@forge-cms/auth` depends on `core` and `db` only, and that does not change. The runtime is the one
package that knows collections, globals and which fields reference what. So the bridge is an
**optional** `AuthAdapter` method the runtime calls, carrying pure data:

```ts
// @forge-cms/auth
export interface ManagedDeleteGuard {
  /** The database the assertions address (the content database). */
  readonly database: DatabaseAdapter;
  /** Read-only `assertCount` preconditions for deleting `id`; empty = nothing references the collection. */
  assertions(id: string): readonly AtomicWriteOperation[];
}

interface AuthAdapter {
  // …existing members…
  /** Infrastructure wiring (spec 065) — application code does not call it. */
  setManagedDeleteGuard?(collection: string, guard: ManagedDeleteGuard): boolean;
}
```

It returns `true` only when the adapter will enforce the guard for that collection.

- **Not a callback into the runtime.** `assertions(id)` is a pure function. It returns
  `AtomicWriteOperation`s and never performs I/O or runs hooks. The adapter checks that every returned
  operation is an `assertCount`. Anything else makes the delete fail closed, so the guard cannot be
  used to inject writes.
- **No caller-facing surface.** Callers still write `await auth.deleteUser(id)`. There is no
  `deleteUser(id, extraOperations)`.

### 2. Automatic wiring (`ForgeCmsRuntime` constructor)

After spec 064's startup validation, the constructor handles every registered collection `slug` for
which `auth.managesCollection(slug)` is true:

- **Guard:** it builds
  `{ database: adapters.database, assertions: (id) => noReferenceAssertions(this, slug, [id]) }` and
  calls `auth.setManagedDeleteGuard?.(slug, guard)`.
- **Refusal:** if any supported reference to `slug` exists and the adapter did not return `true`, the
  runtime **refuses to start** with an actionable message (§5).

Consumers change no setup code. The wiring happens in the constructor, before `init()`, and survives
`runtime.init()` re-initialising the auth adapter, because `init()` does not touch the guard. A
`UsersCollectionAuthAdapter` used **without** a runtime has no guard and deletes exactly as before.

### 3. One source of truth for "who references X"

`noReferenceAssertions(ctx, target, ids)` in `relation-lifecycle.ts` is now the **only** definition of
the final-state reference guard. It emits one `assertCount(…, equals: 0)` per referring top-level
`relation`/`upload` field of a collection or global. The field is matched with `in` for single
references and `containsValue` for `many`. Spec 064's delete planner builds its final assertions with
it, and so does the auth guard. Nested, localized and unregistered-target shapes are already refused at
startup by spec 064, so there is no second unsupported-shape policy.

### 4. `UsersCollectionAuthAdapter.deleteUser(id)`

The adapter accepts a guard only for its own configured `collection` (the slug, never the literal
`'users'`). Guards **accumulate** rather than replace. Several runtimes may share one adapter (an app
runtime plus a seed script, say), and each of their guards is enforced. So a later runtime whose schema
references nothing cannot lift an earlier one's protection (found in review). Identical assertions from
runtimes with the same schema are committed once.

```text
guards wired and user missing → return                            (idempotent no-op, unchanged)
assertions = union of every guard's assertions(id), de-duplicated
assertions empty → spec 059 path, unchanged: deleteIf(users, id, LAST_ADMIN_GUARD)
otherwise:
  - fail closed unless: every op is assertCount; each contributing guard.database === this adapter's
    userDatabase; assertions.length + 1 ≤ ATOMIC_WRITE_MAX_OPERATIONS
  - preflight: db.count(each assertion) ≠ equals → UserMutationError('referenced')   (message only)
  - atomicWrite([ ...assertions, deleteIf(users, id, LAST_ADMIN_GUARD) ])            (ONE commit)
      AtomicWriteConditionError → UserMutationError('referenced')   (a reference appeared meanwhile)
      deleteIf applied          → done
      deleteIf not applied      → user still there ? 'last-admin' : no-op
```

- **Atomicity.** The relation assertions, the last-admin condition and the delete are one `atomicWrite`:
  one `BEGIN IMMEDIATE` on libSQL, one D1 `batch()`, one staged commit in memory. That covers relation
  integrity and last-admin (spec 059) together. There is no second call and no compensation.
- **Why the classification is exact.** The `deleteIf` is deliberately _not_ `requireApplied`. A
  missing user or a refused last-admin condition gives `applied: false` and the batch still commits,
  though it has written nothing. So the only operation that can raise `AtomicWriteConditionError` in
  this batch is a relation `assertCount`. That error therefore means "a reference existed at commit",
  not a guess. Missing-user idempotency survives because a missing row is `applied: false`, never an
  error.
- **The preflight is not the guarantee.** It exists only for the deterministic "still referenced N
  times" message. A reference written after a clean preflight fails the batch assertion.

### 5. Custom, composite and non-managing adapters

- **`CompositeAuthAdapter.setManagedDeleteGuard`** hands the guard to **every** child whose
  `managesCollection(collection)` is true. Each of them can delete those documents, so each must
  enforce it. It returns `true` only if at least one child manages the collection and every such child
  returned `true`. Two children claiming one collection is therefore not ambiguous: both are guarded,
  or the runtime refuses.
- **Adapters that manage nothing** (`ApiKeyAuthAdapter`, `ExternalAuthAdapter`,
  `SignedTokenAuthAdapter`, `InMemoryAuthAdapter`, most third-party adapters): never called, unaffected.
- **A third-party adapter that manages a collection but lacks `setManagedDeleteGuard`:**
  - _referenced_ collection: **startup refusal**. The runtime cannot claim D02 protection that the
    adapter cannot enforce.
  - _unreferenced_ collection: accepted, since there is nothing to protect.
  - This is the one behavior change for existing custom code. It surfaces at startup, never as data
    loss.

### 6. Error semantics

| Situation                                                              | Result                                                                                                                                                                      | First-party HTTP |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| User referenced (preflight)                                            | `UserMutationError`, `reason: 'referenced'`: "User cannot be deleted: it is still referenced N time(s) by content. Change or remove … first." (counted per referring field) | `409`            |
| Reference appeared after preflight (race)                              | `UserMutationError`, `reason: 'referenced'`: "…a document started referencing it while it was being deleted. Nothing was changed…"                                          | `409`            |
| Last admin, not referenced                                             | `UserMutationError`, `reason: 'last-admin'` (unchanged)                                                                                                                     | `409`            |
| Referenced **and** last admin                                          | `'referenced'`: the preflight reports references first. If the preflight is raced, the batch still refuses as one of the two. Nothing changes either way.                   | `409`            |
| Missing user                                                           | no-op (unchanged)                                                                                                                                                           | `204`            |
| Guards exceed the batch cap / split database / non-`assertCount` guard | plain `Error`, before any write: a configuration problem                                                                                                                    | `500`            |

- **What messages reveal.** Messages give a count only. They never name the referencing documents,
  their titles, their collection or an internal table (`_global_*`).
- **Routes.** The three apps' `/api/auth/users/:id` DELETE routes already map every
  `UserMutationError` to `409` with its message. They inherit the protection with no route logic. CSRF
  and admin authorization are unchanged.
- **Admin UI.** `CmsApiService.toApiError` already surfaces h3's `statusMessage`, so the admin users
  workspace shows the message. No UI change.

### 7. Batch limit

The number of guards is fixed by the schema (one per referring field). A delete needing more than
`ATOMIC_WRITE_MAX_OPERATIONS` (25) operations, i.e. 25 or more referring fields, fails before any read
or write with an actionable error. The delete is never split, no guard is dropped, and the cap is
unchanged. This is checked at delete time, not at startup, so such a schema still boots and only user
deletion is refused.

### 8. Database placement

A guard is only atomic if it runs in the same database as the delete. Spec 064 already requires
relation targets to live in the content database: target validation counts `users` there. The adapter
therefore fails a guarded delete closed when its `userDatabase` is not the runtime's database (object
identity). All three apps pass the same adapter instance to both.

## Supported matrix (final D02 state)

"Supported" means atomic and race-safe on InMemory, libSQL and D1. "Refused" means refused explicitly at
startup, never silently ignored.

| Reference shape → target                                   | restrict                            | cascade                           | set-null                          |
| ---------------------------------------------------------- | ----------------------------------- | --------------------------------- | --------------------------------- |
| single relation (content → content)                        | supported (064)                     | supported (064)                   | supported (064)                   |
| many relation (content → content)                          | supported (064)                     | supported (064)                   | supported (064)                   |
| self / cycle / diamond                                     | supported (064)                     | supported (064)                   | supported (064)                   |
| localized relation/upload                                  | refused (064)                       | refused (064)                     | refused (064)                     |
| relation/upload in group / array / blocks                  | refused (064)                       | refused (064)                     | refused (064)                     |
| upload field                                               | supported, always restrict (064)    | n/a: no option                    | n/a: no option                    |
| global's relation/upload                                   | supported, always restrict (064)    | refused (064)                     | refused (064)                     |
| versioned dependent                                        | supported (064)                     | supported, history retained (064) | supported, one snapshot (064)     |
| auth-managed **dependent** (users row referencing content) | supported (064)                     | refused before mutation (061/064) | refused before mutation (061/064) |
| **auth-managed target**, deleted via content CRUD          | refused (061)                       | refused (064)                     | refused (064)                     |
| **auth-managed target**, deleted via `deleteUser`          | **supported (this spec)**           | refused (064)                     | refused (064)                     |
| auth-managed target, custom adapter without the guard      | **refused at startup (this spec)**  | refused (064)                     | refused (064)                     |
| raw `DatabaseAdapter` writes                               | outside every guarantee (by design) | outside                           | outside                           |

No cell is still unsafe or open.

**Known limitation (liveness, not integrity).** A user that references itself or another user through
a relation on the auth-managed collection (e.g. `users.manager → users`) cannot be deleted while that
reference exists. The assertions are evaluated before the `deleteIf`, so the row's own reference still
counts. Such values can only be written through raw database access today (spec 061 refuses generic
users CRUD, and `updateUser` does not carry custom fields). Clear the reference first. Spec 064's
self/cycle support applies to content targets only.

## Implementation plan

- [x] Reproduce: probe on libSQL (two clients); new contract run against unfixed source on InMemory,
      libSQL, D1.
- [x] `@forge-cms/auth`: `ManagedDeleteGuard`, optional `AuthAdapter.setManagedDeleteGuard`, reason
      `'referenced'`; `UsersCollectionAuthAdapter` guard + one-batch `deleteUser`; composite forwarding.
- [x] `@forge-cms/runtime`: extract `noReferenceAssertions` (planner reuses it); constructor wiring and
      startup refusal.
- [x] `@forge-cms/testing/contracts`: `runAuthManagedDeleteContractTests`, `authManagedDeleteSchema`.
- [x] Harnesses: InMemory + on-disk libSQL (`packages/runtime/src/auth-managed-delete.test.ts`), local D1
      (`packages/cloudflare/test/workers/relation-lifecycle.test.ts`).
- [x] Spec-064 test stubs that manage a _referenced_ collection opt into the guard.
- [x] API baseline, changeset, docs.

## Test plan

- **Contract (`runAuthManagedDeleteContractTests`, 9 scenarios, independent writers via
  `createBatchHold`).** Runs on InMemory, on-disk libSQL (separate clients per contender) and local D1
  (separate `D1DatabaseAdapter`s). The managed collection is `<prefix>_members`, not `users`.
  Scenarios:
  - an unreferenced user is deleted;
  - single reference refused;
  - many reference refused;
  - global reference refused, then allowed once cleared;
  - referenced last admin refused; after adding a second admin it is still refused (reference); after
    re-pointing the article it is deleted;
  - missing user is a no-op;
  - writer first, new document: the deleter is held after its preflight, the writer commits
    `article.author = u`, then the deleter is released → `'referenced'`;
  - writer first, existing document moved onto the user → `'referenced'`;
  - delete first → the writer's create gets `CONCURRENT_MODIFICATION`.

  Every scenario reads committed state back and checks that no dangling reference exists.

- **Runtime unit tests (`auth-managed-delete.test.ts`):**
  - message contents and no leak;
  - `findOrphanedDocuments` finds nothing;
  - exact batch shape (`assertCount`, then `deleteIf` + `LAST_ADMIN_GUARD`);
  - renamed `members` with an unmanaged content collection literally named `users` (ordinary
    restrict);
  - composite reaching its managing child next to an `ApiKeyAuthAdapter`;
  - composite forwarding and return value;
  - third-party startup refusal, plus acceptance when nothing references the collection;
  - oversized guard set refused with zero batches;
  - split database fails closed;
  - spec 061 generic delete still refused.
- Existing last-admin, first-admin, relation-lifecycle, atomic-write and version-history contracts stay
  green.

## Acceptance criteria

1. `deleteUser` cannot leave a supported content/global reference dangling (single, many, global).
2. Relation guards + last-admin guard + delete are one `atomicWrite`.
3. Relation write vs user delete never both commit, either order; libSQL and D1 evidence.
4. A referenced non-admin and a referenced last admin are refused; last-admin is not weakened.
5. A renamed managed collection gets the same protection; an unmanaged `users` collection gets none.
6. `CompositeAuthAdapter` wires the managing child; non-managing adapters are untouched; a managing
   adapter without the capability is refused at startup when referenced.
7. Missing-user deletion stays a no-op; an oversized guard set fails before any write.
8. First-party routes inherit protection with no relation logic of their own.
9. `format:check`, `lint`, `typecheck`, `test`, `build`, `test:libsql`, `test:cloudflare`, `check:api`,
   `release:verify` and the three E2Es are green.

## Open questions

None.

## Outcome

Shipped as designed. D02 is complete: every cell of the matrix above is supported or refused explicitly.
Remote production D1 / Turso were not exercised (local workerd D1 and on-disk libSQL only). Verification
results are recorded in [STATE.md](../STATE.md).
