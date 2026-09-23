# 061 — Auth-managed collection mutation boundary (generic users CRUD lifecycle protection)

- **Status:** done <!-- approved by the maintainer's task brief, which directs this exact implementation (as for specs 059/060) -->
- **Author:** agent draft (explicit maintainer directive to implement this bounded step)
- **Date:** 2026-09-20
- **Branch:** `feature/spec-061-auth-managed-collection-boundary`
- **Affected packages/apps:** @forge-cms/auth, @forge-cms/runtime, `scripts/verify-release.mjs`
  (packed-consumer check), `apps/tiny-project` (E2E + D1 lifecycle test), docs (roadmap packet H02,
  browser-auth / collections / REST docs)

## Context / Why

Specs 058–060 made the user lifecycle safe **through `UsersCollectionAuthAdapter`**: first-admin
provisioning is one atomic write (060), the last-admin invariant is one guarded write (059), sessions
are re-validated against the row and a password change bumps `_sessionVersion` (058). But the same rows
are also an ordinary Forge collection, and the ordinary content pipeline — `runtime.create/update/delete`
and `POST/PUT/PATCH/DELETE /api/v1/users` — knows nothing about any of that. Every one of those specs
listed this under "known limitations"; it is the last open item of roadmap packet H02.

**Reproduced on `main` (`b559677`) before designing anything**
(`packages/runtime/src/auth-managed-collection.test.ts`, run against the unmodified source: 48 of 57
cases fail, the 9 controls pass):

| Attempt (recommended `defineUsersCollection()` + `UsersCollectionAuthAdapter`)                                                                                                             | Dedicated surface          | Generic surface **before**                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------- |
| Delete the only admin — `runtime.delete` (trusted default), InMemory **and** libSQL                                                                                                        | `UserMutationError`        | **succeeds**, `users` ends with 0 rows            |
| Demote the only admin — `runtime.update({ role: 'viewer' })`                                                                                                                               | `UserMutationError`        | **succeeds**                                      |
| Create a user row — `runtime.create({ email: 'Rogue@Example.COM', role: 'admin', passwordHash: 'x' })`                                                                                     | hashes, normalises, claims | **succeeds**: un-normalised email, raw "hash"     |
| Same over HTTP with an admin Bearer token                                                                                                                                                  | —                          | POST **201**, PUT/PATCH **200**, DELETE **204**   |
| Editor promotes themselves on a hand-rolled `withAuthFields` collection (the shape `apps/www` and the demo use; `role` has no field-level write rule, routes gated only by `allowedRoles`) | `updateUser` is admin-only | **succeeds** — `role` becomes `admin`             |
| Delete a `media` document that a `users.avatar` (`onDelete: 'set-null'`/`'cascade'`) points at                                                                                             | —                          | the cascade/set-null **writes to the users rows** |

Two things it found on the way, both about `_sessionVersion` (an auth-owned column the collection never
declares):

- On **InMemory** every read of a user whose password was changed returns `_sessionVersion`
  (`filterReadableFields` only hides _declared_ fields).
- On **libSQL and D1** the dedicated `auth.updateUser(id, { password })` **throws
  `Unknown column '_sessionVersion'`** — the SQL adapters reject writes to undeclared columns
  (`assertValidColumn`), so password change / password reset through the canonical surface does not work
  on either SQL backend today (spec 058's `_sessionVersion` test only ever ran on InMemory). Making the
  dedicated surface the _only_ mutation path (this spec) is pointless if that path cannot change a
  password, so this is fixed here (§6) rather than left as a note.

## Goal

A collection whose lifecycle an auth adapter owns cannot be created, updated or deleted through Forge's
generic content API — Local API (`overrideAccess` true **or** false) and HTTP alike — while reads, other
collections and custom auth adapters are unaffected.

## Non-goals

- **No field classification / partial writes.** Not "auth-sensitive fields are rejected, content-like
  ones stay editable". Every generic `create`/`update`/`delete` of a managed collection is rejected. A
  broad, predictable rule cannot drift from what the auth adapter actually guards. (Consequence, stated
  in §7: custom non-auth fields on the users collection — `avatar`, `jobTitle`, … — can no longer be
  written through Forge's public surface; extending the auth adapter's own update input is the follow-up
  if that is wanted, not a second write path.)
- **No duplicated lifecycle logic.** Nothing from `UsersCollectionAuthAdapter` (last-admin, bootstrap,
  password policy, email normalisation, session versioning) is copied into the runtime.
- **The raw `DatabaseAdapter` is not blocked.** `runtime.adapters.database.update(...)` is trusted
  low-level infrastructure below every runtime/auth guarantee — like raw SQL under an ORM. Documented,
  not pretended away.
- No policy/plugin framework, no per-operation or per-field policy object, no new `AuthAdapter` required
  members, no redesign of `CompositeAuthAdapter`, no slug conventions (`'users'` is not special).
- No `managed` flag in `describeCollections()` / no admin UI change (a hidden "New" button for the users
  collection in the generic content admin is a possible follow-up). No new admin feature.
- No D02 (relation atomicity), D03 (document + version), H03/H04, schema migrations tooling, SSR, S3.
- Specs 058–060 are not rewritten; this spec cross-references them.

## Verified starting point (`main` at `b559677`)

- `AuthAdapter` (`packages/auth/src/index.ts`) has no notion of a collection it owns. The runtime knows
  the auth adapter only through `ctx.adapters.auth` (`OperationContext`).
- Every persisted mutation of a collection document in the runtime funnels through **three** functions
  in `packages/runtime/src/operations.ts`: `create`, `update`, `deleteDocumentInternal`. `restoreVersion`
  calls `update`; relation cascade / set-null call `deleteDocumentInternal` / `update` through the
  `RelationMutator`; `handleCreate/Update/Delete` call `runtime.create/update/delete`. `preview` is
  non-persistent (no write, no hook, no version). `globals.ts` mutates globals, not collections;
  `createVersion` writes the `_versions_<slug>` table, not the collection.
- `UsersCollectionAuthAdapter` already knows its collection (`this.collection`, default `'users'`,
  constructor option). `ApiKeyAuthAdapter`'s `_forge_api_keys` and the `_forge_bootstrap` claim table are
  never registered as consumer collections, so generic CRUD cannot reach them (`getCollection` → 404).
- No admin/app code calls generic users mutation: `ForgeUsersWorkspaceComponent` and `CmsApiService`
  use `/api/auth/users*`; `demo-aesthetics` seeds through `auth.createUser`. The only in-repo users of
  the generic path are tests (`browser-auth-integration.test.ts`, `d1-lifecycle.test.ts`), reworked here.
- HTTP error mapping already turns any `ForgeError` into `{ error: { code, message } }` + its status
  (`toApiErrorBody`); `CmsApiService` reads `error.message`, and a `403` never triggers its
  session-dropped (`401`) path.

## Design

### 1. The contract: one optional method on `AuthAdapter` (`@forge-cms/auth`)

```ts
export interface AuthAdapter<TUser extends AuthUser = AuthUser> {
  // …existing members unchanged…

  /**
   * Optional (spec 061). Does this adapter own the identity and lifecycle of the documents in the
   * collection `slug`? When it returns `true`, `@forge-cms/runtime` refuses every generic content
   * `create`/`update`/`delete` of that collection — Local API and HTTP, trusted or not — because
   * those bypass the adapter's own invariants (first-admin provisioning, last-admin, password
   * hashing, email normalisation, session versioning). Reads are unaffected. Adapters that keep no
   * users in a Forge collection (`ExternalAuthAdapter`, `SignedTokenAuthAdapter`, `ApiKeyAuthAdapter`,
   * `InMemoryAuthAdapter`, any third-party adapter) simply omit it: absent means `false`.
   */
  managesCollection?(slug: string): boolean;
}
```

Why a predicate method and not a list or a policy object: it is the smallest thing that answers the only
question the runtime has ("may I let generic CRUD touch this slug?"); it composes by `some()`; it needs
no shared array and can be evaluated per call so a wrapper adapter cannot go stale.

- `UsersCollectionAuthAdapter.managesCollection(slug) → slug === this.collection`. Follows the
  constructor's `collection` option, so `'members'` / `'accounts'` / `'custom-auth-collection'` work and
  a collection that merely happens to be called `users` is **not** protected when the adapter manages
  `members`.
- `CompositeAuthAdapter.managesCollection(slug) → this.adapters.some((a) => a.managesCollection?.(slug) === true)`.
  Always present on the composite; `false` when no child manages anything, so a composite of API-key +
  external adapters restricts nothing.
- No other adapter changes.

### 2. The runtime guard (`@forge-cms/runtime`)

```ts
// errors.ts
export type ForgeErrorCode /* …existing… */ = 'AUTH_MANAGED_COLLECTION';

export class AuthManagedCollectionError extends ForgeError {
  readonly collection: string;
  constructor(collection: string) {
    super(
      `Collection '${collection}' is managed by the configured auth adapter and cannot be mutated ` +
        `through generic collection CRUD. Use the auth adapter's user-management operations instead.`,
      403,
      'AUTH_MANAGED_COLLECTION'
    );
    this.collection = collection;
  }
}
```

A new `auth-managed.ts` holds two small helpers (`isAuthManagedCollection`, `assertNotAuthManaged`);
`operations.ts` gains four call sites:

```ts
function assertNotAuthManaged(ctx: OperationContext, slug: string): void {
  if (ctx.adapters.auth.managesCollection?.(slug) === true) {
    throw new AuthManagedCollectionError(slug);
  }
}
```

No `create`/`update`/`delete` discriminant on the error: the message does not depend on which operation
was attempted (the fix is the same regardless — use the auth adapter's own operations), so carrying one
as public API with nothing reading it would be dead surface. (Caught in review — an earlier draft of this
implementation had it; removed before commit.)

called as the **first statement after `getCollectionOrThrow`** in `create`, `update`,
`deleteDocumentInternal` and `restoreVersion` (which would reach `update`'s guard anyway, but this way the
refusal never depends on whether the version id exists) — before `beforeOperation` hooks, access checks, the existence lookup and any
read or write. Consequences, all deliberate:

- **Independent of `overrideAccess`.** `overrideAccess: true` means "the caller may bypass
  _authorization_"; it never meant "may bypass the auth subsystem's data-integrity invariants". Trusted
  code has explicit APIs for intentional lifecycle work (`createUser`/`updateUser`/`deleteUser`/`signup`).
- **Independent of the caller and the document.** Same error for admin, viewer and anonymous callers, and
  for a document that does not exist (no existence oracle; nothing to learn from probing).
- **No side effects on refusal**: no hook fired, no version, no write, no bootstrap claim touched.
- `restoreVersion` and cascade/set-null updates/deletes are covered because they call these functions.
- `preview` is deliberately **not** guarded: it never persists.

**Two more call sites, both found in review, not in the original draft:**

- `relation-integrity.ts`'s `defaultMutator` — the raw-adapter fallback `handleCascadeDelete`/
  `handleSetNullOnDelete` use when called **without** a `mutator` (their documented low-level/pre-058
  mode). `operations.ts`'s own `deleteDocumentInternal` always supplies a real mutator, so this only
  matters for a caller invoking those two `@forge-cms/runtime` exports directly — but they are runtime
  exports, not the raw-`DatabaseAdapter` escape hatch, so they get the guard too.
- `handlers.ts`'s `handleCreate` — checked **before** multipart parsing, not only inside `runtime.create`.
  Without this, a `POST` with a file body to a managed, `upload: true` collection would upload the file to
  storage, then have `runtime.create` refuse and (already-existing logic) compensate by deleting it — a
  real write on the happy path, and an orphaned object if the compensating delete itself failed, both of
  which contradict "no side effects on refusal" above. This one line duplicates nothing: it calls the same
  `assertNotAuthManaged`, just before the multipart branch instead of only after it.

HTTP: otherwise no handler change (the `handleCreate` line above is the one exception, transport-level
only — it does not add or change any business rule, it just avoids one specific wasted/leaky I/O before a
refusal that was already guaranteed). `AuthManagedCollectionError` is a `ForgeError`, so `toErrorResponse`
produces `403 { "error": { "code": "AUTH_MANAGED_COLLECTION", "message": "…" } }` — the standard envelope,
no `details`, no adapter class names or SQL. (An anonymous caller on a collection with function-based
`access` reaches the operation as `user === null` and gets this `403`, not `401`: the answer does not
depend on who asks.) Local API and HTTP therefore share one implementation and one message.

Status `403`, not `405`/`409`: RFC 9110 §15.5.4 — the server understood the request and refuses to
fulfil it, reason in the body; `405` would require an `Allow` header for a resource that is otherwise a
normal collection. A distinct `code` is what clients branch on; `CmsApiService`/the admin show the
server's message.

### 3. Relation cascade / set-null into a managed collection: refuse up front

`users.avatar → media (onDelete: 'set-null' | 'cascade')` makes deleting a `media` document mutate user
rows through the relation mutator — a generic write into the managed collection. It is blocked by §2, but
by then earlier dependents may already have been processed and the caller would see
"Collection 'users' is managed…" in answer to deleting a media file. So `checkDeleteRestrictions`
(already the place that rejects `restrict` and required-`set-null` **before any mutation**) also treats a
`cascade`/`set-null` relation whose dependent collection is auth-managed **and has referencing rows** as
restricted:

```
Cannot delete document '<id>' from 'media': N document(s) in 'users' reference it with
onDelete '<cascade|set-null>', but 'users' is managed by the configured auth adapter, so a relation
cascade cannot change it. Clearing the reference on those document(s) is not possible through generic
collection CRUD or the auth adapter's user-management operations; it requires direct database access,
which is outside runtime guarantees.
```

The message deliberately does **not** say "remove those references first": there is no supported way to
do that. `updateUser` only accepts `email`/`name`/`role`/`password`, not an arbitrary custom field, and
generic `update` of the managed collection is exactly what §2 refuses. So a custom relation field on a
managed collection with `onDelete: 'cascade' | 'set-null'` pointing at another collection makes a
referenced document of that other collection **permanently undeletable through the supported surface**
once referenced — the only way past it is the raw `DatabaseAdapter` escape hatch (§15 of the task brief,
"outside runtime guarantees"). This is a real, if narrow, usability dead end (found in review); the
honest fix here is to say so rather than promise a remedy that does not exist. Widening `updateUser` to
accept arbitrary custom fields would resolve it but is exactly the "field classification" this spec's
Non-goals rule out for a first pass — left as a documented limitation, not implemented here.

`InvalidInputError` (400), like the other restrict rejections. Documents with no referencing user rows
delete as before. A multi-level chain that reaches a managed collection deeper down is still discovered
when the recursion gets there — pre-existing non-atomicity that is D02's, not this spec's.

### 4. What stays allowed

`find`, `findOne`, `findByID`, `count`, `?depth=1` population from other collections, `preview`, and every
operation on every non-managed collection — with unchanged read access, field read access
(`passwordHash` stays hidden), draft visibility and population visibility.

### 5. Trusted server code: the canonical surface

`createUser`, `updateUser` (email, name, role, password), `deleteUser`, `signup`, `listUsers`,
`login` — unchanged — and the host routes over them (`/api/auth/users*`, `/api/auth/signup`). Nothing in
`UsersCollectionAuthAdapter`'s behaviour changes except the `_sessionVersion` fix in §6.

### 6. `_sessionVersion` becomes a declared, auth-owned field (`@forge-cms/auth`)

`AUTH_USER_FIELDS` gains

```ts
_sessionVersion: defineField.number({ access: { read: [], write: [] } });
```

next to `passwordHash`. This is exactly what `AUTH_USER_FIELDS` documents itself as ("the fields
`UsersCollectionAuthAdapter` writes to but that a hand-written `users` collection has no reason to
declare"): schema generation now creates the column (and the additive `syncSchema` migration adds it to
existing tables), the SQL adapters stop rejecting the password-change write, and `filterReadableFields`
hides it on reads. `withAuthFields` keeps "explicit fields win" **per field** (it checked only
`passwordHash` before). `sessionVersionOf` already treats a missing/`null` value as `0`, so existing rows
need no backfill. Field-level `write: []` is defence in depth only — §2 is the boundary.

### 7. Consequences and documented limits

- Custom (non-auth) fields on a managed collection are read-only through Forge's generic surface.
  Trusted code that needs to set one can use the raw adapter (below the boundary, at its own risk) or
  extend the auth adapter; neither is provided or blessed here.
- **Consequence of the above, found in review**: a custom relation field on a managed collection with
  `onDelete: 'cascade' | 'set-null'` (e.g. `users.avatar → media`) makes a referenced document
  permanently undeletable through the supported surface once referenced — §3's rejection is honest about
  there being no in-band way to clear the reference. No collection in this repo has such a field today.
- The generic content admin (`ForgeCollectionsIndex` etc.) will show the users collection with edit
  actions that now fail with the message above; users management belongs to `ForgeUsersWorkspaceComponent`.
  Surfacing `managed` in `describeCollections()` so the admin hides them is left for a follow-up.
- Breaking for anyone relying on generic users mutation → `minor` (0.x), called out in the changeset.

## Implementation plan

- [x] `packages/auth/src/index.ts`: `managesCollection?` on `AuthAdapter` (+ doc).
- [x] `packages/auth/src/users-collection.adapter.ts`: `managesCollection`. `composite.adapter.ts`: `some()`.
- [x] `packages/auth/src/user-fields.ts`: `_sessionVersion` in `AUTH_USER_FIELDS`, per-field "explicit wins".
- [x] `packages/runtime/src/errors.ts`: `AuthManagedCollectionError`, code; export from `index.ts`.
- [x] `packages/runtime/src/operations.ts`: guard in `create`/`update`/`deleteDocumentInternal`/`restoreVersion`.
- [x] `packages/runtime/src/relation-integrity.ts`: `defaultMutator` (the low-level, no-`mutator` fallback
      `handleCascadeDelete`/`handleSetNullOnDelete` use) also guarded — found in review; it is a second
      public-export write path into a dependent collection that never goes through `operations.ts`.
- [x] `packages/runtime/src/handlers.ts`: `handleCreate` checks before multipart parsing, not just inside
      `runtime.create` — found in review; the guard alone left a real (if compensated) storage write on the
      happy path for a managed, upload-enabled collection.
- [x] `packages/runtime/src/relation-integrity.ts`: managed dependents rejected in `checkDeleteRestrictions`.
- [x] Tests (below): runtime suite, auth unit + parity, rework the two existing generic-users tests.
- [x] `apps/tiny-project`: E2E + D1 lifecycle assertions; `scripts/verify-release.mjs` packed check.
- [x] `pnpm check:api:update`, changeset, docs, `docs/STATE.md`, spec close-out.

## Test plan

- `packages/runtime/src/auth-managed-collection.test.ts` (new, 57 cases): Local API trusted / admin /
  viewer / anonymous × create/update/delete on InMemory **and** libSQL; last-admin delete + demotion;
  first-admin bootstrap untouched by a rejected create; auth-owned field table (`role`, `email`,
  `passwordHash`, `_sessionVersion`, `name`); HTTP POST/PUT/PATCH/DELETE (Bearer, same-origin cookie,
  anonymous) with envelope assertions; reads (`find`/`findOne`/`findByID`/`count`/`depth:1`, hidden
  fields); custom slug `members` protected while a plain `users` collection is not; composite /
  no-op composite / custom adapter without the method; `restoreVersion`; cascade / set-null / restrict;
  raw-adapter boundary pinned; the dedicated surface end to end incl. password-change invalidation.
- `packages/auth`: `managesCollection` unit tests (exact slug, custom slug, composite `some`, adapters
  that omit it); `user-fields` tests for `_sessionVersion` (declared, hidden, explicit-wins); parity test
  on InMemory + libSQL: password change works, invalidates the old session, `_sessionVersion` not
  returned by `listUsers`.
- Reworked: `browser-auth-integration.test.ts` (CSRF coverage moved to a non-managed collection with
  function-based access — same code path, still covered — and role-escalation cases now assert the
  boundary), `d1-lifecycle.test.ts`.
- Real D1: `apps/tiny-project/test/workers/d1-lifecycle.test.ts` — generic mutation refused, dedicated
  password change works on D1. Real libSQL: `portable-libsql.integration.test.ts`.
- E2E: `apps/tiny-project` — same-origin generic `DELETE`/`PUT` of the sole admin is `403`, the users
  workspace still works. `e2e:www`, `e2e:demo` regression.
- `scripts/verify-release.mjs`: from the packed tarballs, generic delete of the managed collection
  rejects `AUTH_MANAGED_COLLECTION` and the adapter advertises `managesCollection`.

## Acceptance criteria

1. `runtime.create/update/delete` on a collection the configured auth adapter manages rejects with
   `AuthManagedCollectionError` (`403`, `AUTH_MANAGED_COLLECTION`) for `overrideAccess` omitted, `true`
   and `false`, for admin/viewer/anonymous callers, on InMemory and libSQL; nothing is written and no
   hook runs.
2. `POST/PUT/PATCH/DELETE /api/v1/<managed>[/:id]` return `403 { error: { code, message } }` (no
   `details`, never `500`); the only administrator survives a generic `DELETE`/demotion.
3. The guard follows `UsersCollectionAuthAdapter({ collection })`: `members` is protected, an unrelated
   collection called `users` is not; `CompositeAuthAdapter` surfaces its children's answer; an adapter
   without `managesCollection` (incl. a hand-written one) restricts nothing.
4. `find`/`findOne`/`findByID`/`count`/population on the managed collection behave as before;
   `passwordHash` and `_sessionVersion` are never returned.
5. `createUser`/`updateUser`/`deleteUser`/`signup` still work; last-admin, first-admin, concurrent
   contract suites (`runLastAdminConcurrencyContractTests`, `runFirstAdminBootstrapContractTests`) still
   pass on InMemory, libSQL and D1.
6. `auth.updateUser(id, { password })` works on libSQL and D1 and invalidates earlier sessions.
7. Deleting a document referenced by a managed collection through `cascade`/`set-null` is rejected
   before any write; `restrict` and unreferenced deletes are unchanged.
8. Non-managed collections are byte-for-byte unaffected (existing runtime suite unchanged, other than the
   two reworked files).
9. `pnpm format:check`, `lint`, `typecheck`, `test`, `build`, `test:cloudflare`, `test:libsql`,
   `check:api`, `release:verify`, `e2e:www`, `e2e:tiny-project`, `e2e:demo` green.

## Open questions

_None — the maintainer's brief fixes the boundary (reject, broad, slug-agnostic, raw adapter documented)._

## Outcome

H02 is complete. `AuthAdapter.managesCollection?` + a runtime guard make a collection an auth adapter
manages refuse generic `create`/`update`/`delete` for every caller (Local API trusted or not, HTTP), with
`AuthManagedCollectionError` (`403`, `AUTH_MANAGED_COLLECTION`); reads, other collections and custom
adapters are untouched. Divergences from the plan as first drafted: (1) `restoreVersion` got its own
guard (determinism, §2) — found by mutation check, pinned by a test; (2) the `_sessionVersion` fix (§6) was
promoted from "found on the way" to a required part of the change after reproducing that password change
threw `Unknown column '_sessionVersion'` on libSQL (and, by the same `assertValidColumn`, D1); (3) two
existing tests encoded the old behaviour and were reworked, not deleted (§Test plan).

**Reviewed** by the `forge-rules-reviewer` and `spec-reviewer` agents (auth-sensitive work; both run on
the full working diff, not just the new files). `forge-rules-reviewer`: no hard-rule violations, three
observations. `spec-reviewer` (run after the first two were fixed): all nine acceptance criteria
independently verified MET — including re-running the suites itself and reproducing the mutation-check
percentages — no non-goal violations, design matches the spec exactly, close-out ritual complete; six
further findings, all minor/nit. Every finding from both passes was addressed, none dismissed:

- **Fixed, both real gaps in the boundary's completeness** (spec §2 updated to name both):
  (F1) `relation-integrity.ts`'s `defaultMutator` — the raw-adapter fallback `handleCascadeDelete`/
  `handleSetNullOnDelete` use when called **without** a `mutator` — was a second, un-guarded generic-write
  path into a dependent collection, reachable without ever going through `operations.ts`. Now guarded;
  regression tests call both functions directly and assert the managed row is untouched.
  (F2) `handleCreate` refused an auth-managed, `upload: true` collection only _after_ `runtime.create`
  ran — by then a real file had already been uploaded to storage (and compensated by the existing
  cleanup), contradicting "no side effects on refusal". Now checked before multipart parsing; regression
  test spies on `storage.put` directly (asserting the empty end-state alone would not have caught this —
  the pre-existing cleanup already emptied it).
- **Fixed, correctness/API-hygiene** (already applied before `spec-reviewer` ran, so it re-verified the
  fixed version, not the original): `AuthManagedCollectionError` no longer carries an `operation` field
  that nothing read (dropped, not folded into the message — the message doesn't need to distinguish
  create/update/delete); the relation-cascade pre-flight message no longer promises "remove those
  references first" when nothing on the supported surface can — it says clearing the reference requires
  direct database access, outside runtime guarantees, and §7/STATE.md now state the resulting dead end
  (a custom relation field on a managed collection with `onDelete: 'cascade'`/`'set-null'` makes a
  referenced document permanently undeletable through the supported surface) as an explicit, not hidden,
  limitation.
- **Pinned by new tests, not previously asserted** (`spec-reviewer`'s F3/F4): the honest relation-cascade
  message is now asserted by content, not just status/code; a `beforeOperation` hook spy proves a refusal
  really does fire before any hook, not just by code inspection. Both mutation-checked against a
  deliberately reordered/reverted source to confirm they actually catch regression.
- **Left as documented limitations, not implemented** (`spec-reviewer`'s F5/F6, both cosmetic): the
  implementation-plan checklist item naming only `create`/`update`/`deleteDocumentInternal` (now expanded
  in place); `_sessionVersion` appearing in `describeCollections()` the same way `passwordHash` already
  did (`describe.ts` doesn't filter by field `access` — pre-existing pattern, noted in STATE.md).

**Verification (2026-09-23, all uncached unless stated):** `pnpm format:check` clean; one forced
`turbo run lint typecheck test build --force` — 56/56 tasks, 0 cached (unit tests: 76 core, 297 db, 252
auth, **381** runtime, 110 cloudflare, 75 angular, 58 admin, 36 demo, 14 www, 6 tiny-project; `pnpm lint`
still reports the 4 pre-existing `libsql.adapter.ts` warnings, identical on `main`); `pnpm test:cloudflare`
forced, 12/12 tasks, 0 cached — 175 real-workerd tests + the tiny-project D1 lifecycle test (real local
D1); `pnpm test:libsql` 4/4; `pnpm check:api` (baseline +1 name: `AuthManagedCollectionError` in
`@forge-cms/runtime`); `pnpm release:verify` passed; `e2e:www` 19/19, `e2e:tiny-project` 9/9,
`e2e:demo` 9/9 (all three re-run after the `handlers.ts` fix). **Mutation-checked** (61-case suite):
removing the guard from `create` fails 16, from `update` 33, from `delete` 23, from `restoreVersion` 1;
removing the relation pre-flight fails 2; reverting its message to the dishonest wording fails 2; removing
the F1 `defaultMutator` guard fails 2; removing the F2 early `handleCreate` check fails 1 (only when
asserted by spy, not by end-state); reordering a guard after its function's first hook call fails 1;
hard-coding `managesCollection` to `'users'` fails 1 runtime + 2 auth cases; a composite that claims
nothing fails 1 + 1; not declaring `_sessionVersion` fails 2 runtime, 5 auth and 1 tiny-project libSQL case.
The reproduction itself ran against unmodified `main` (48/57 failed) before any fix, independently
corroborated by `spec-reviewer`'s own stubbed-guard run (46/57, arithmetically consistent with the
`_sessionVersion` finding). **Not run:** any remote Cloudflare/Turso deployment; real D1 evidence is
same-isolate against local D1. Nothing published, no version bumped, nothing committed (branch
`feature/spec-061-auth-managed-collection-boundary`).
