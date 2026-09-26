# @forge-cms/auth

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

- 1c22996: Auth-managed collections can no longer be mutated through generic collection CRUD (spec 061). This
  closes the last open part of roadmap H02: the users collection could still be created into, updated and
  deleted through `runtime.create/update/delete` and `POST/PUT/PATCH/DELETE /api/v1/users`, bypassing
  everything `UsersCollectionAuthAdapter` enforces — the last-admin invariant, first-admin provisioning,
  password hashing, email normalisation and session versioning. A trusted `runtime.delete({ collection:
'users', id })` removed the only administrator; a hand-rolled `withAuthFields` users collection let an
  editor promote themselves to admin.

  **Behaviour change (breaking for anyone who wrote users through the generic content API).**
  `AuthAdapter` gains one optional method, `managesCollection?(slug): boolean`. Adapters that keep users
  in a Forge collection declare it: `UsersCollectionAuthAdapter` claims exactly its configured
  `collection` (not the literal `'users'`), and `CompositeAuthAdapter` claims whatever any child claims.
  `@forge-cms/runtime` then refuses every `create`/`update`/`delete` of a claimed collection — Local API
  with `overrideAccess` `true` (the default) or `false`, and HTTP — with the new
  `AuthManagedCollectionError`: HTTP `403`, code `AUTH_MANAGED_COLLECTION`, the same message for every
  caller and for a document that does not exist. The refusal happens before hooks, access checks and any
  read or write, so it has no side effects. `restoreVersion` and relation cascade/set-null are covered too;
  deleting a document that a managed collection references with `onDelete: 'cascade' | 'set-null'` is now
  rejected up front (`400`) instead of writing into it. Reads, other collections and adapters that omit
  `managesCollection` (`ExternalAuthAdapter`, `SignedTokenAuthAdapter`, `ApiKeyAuthAdapter`,
  `InMemoryAuthAdapter`, custom adapters) are unaffected. Use `createUser` / `updateUser` / `deleteUser` /
  `signup` (and the host's `/api/auth/users*` routes) for user lifecycle. Custom non-auth fields on a
  managed collection (`avatar`, `jobTitle`, …) are therefore read-only through Forge's generic surface.
  Direct `DatabaseAdapter` access is trusted low-level infrastructure and remains below this guarantee.

  **Also fixed (found while auditing auth-owned fields).** `updateUser(id, { password })` threw `Unknown
column '_sessionVersion'` on libSQL and D1 — the session-freshness counter was written but never
  declared, so a password change did not work on any SQL backend, and InMemory returned the counter on
  every read. `AUTH_USER_FIELDS` now declares `_sessionVersion` (number, unreadable and unwritable by every
  role) next to `passwordHash`, so `withAuthFields()` / `defineUsersCollection()` create the column, the
  additive `syncSchema` migration adds it to existing tables, and it is hidden from reads. Existing rows
  need no backfill (a missing value means `0`). `withAuthFields()` now lets an explicit declaration win
  per field.

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

- d718fbd: Foundation hardening (spec 058): closes several confirmed access-bypass and concurrency gaps in
  alternate content paths that did not go through the normal Local API pipeline.

  `@forge-cms/runtime`:
  - Version history (`listVersions`/`getVersion`) now enforces the owning document's current read
    access, row-level policy, and draft visibility, and projects field-level hidden values out of
    returned snapshots — an untrusted caller could previously enumerate/read the history of a document
    they could not otherwise read or see hidden fields of.
  - `restoreVersion` now routes through the same `update()` pipeline as a normal write (access,
    field-write checks, validation, hooks, one labeled version) instead of writing through the adapter
    directly, bypassing all of that.
  - `preview()` (Local API and HTTP) now enforces create/update access, field-write access, and
    field-read projection, and forwards caller identity into relation population — previously it read
    the raw stored document and merged caller data with no access enforcement at all. The HTTP
    `handlePreview` handler now delegates to `preview()` instead of duplicating (and independently
    under-enforcing) the same logic; its unused `allowDraftPreview` option is removed.
  - Relation/upload population (`depth: 1`) now enforces the _target_ collection's own read/row/draft
    policy, not just field-level projection — a readable parent no longer grants visibility into an
    unreadable or draft target.
  - Relation integrity (cascade/set-null on delete) now enforces self-relations (previously silently
    skipped for same-collection relations), routes dependent mutations through the real delete/update
    pipeline (hooks, validation, versions, recursive relation integrity) with cycle protection, uses a
    real database query instead of a full-table scan for many-relation lookups, and rejects a
    `set-null` relation on a `required` field before any mutation instead of deep inside a partial
    cascade.
  - Globals now enforce draft visibility on read and support `depth: 1` relation population instead of
    silently ignoring it.

  `@forge-cms/auth` (`UsersCollectionAuthAdapter`):
  - Sessions are re-validated against the current user row on every request: a demoted or renamed
    user's session reflects the change immediately, and a deleted user's session is invalidated. A
    password change invalidates every session issued before it.
  - The first-admin bootstrap race (two concurrent signups both becoming admin) is closed using an
    atomic, unique-index-backed claim, scoped per users-collection.
  - The last-admin removal race is narrowed with a post-write re-verification and best-effort
    compensation; this is an explicitly bounded, non-atomic mitigation, not a full fix — see
    `docs/specs/058-foundation-hardening-runtime-policy-consistency.md` §7b for the documented residual
    gap.

  `@forge-cms/angular`:
  - `ForgeCmsConfig` gains an optional `authBaseUrl` so a host mounted under a custom path can
    configure the auth transport without replacing `CmsApiService` (previously every auth method
    hardcoded `/api/auth/*`, while content methods already honored `baseUrl`).
  - `getCollections()` now preserves the server's Forge error code/message instead of throwing a
    generic `Error`.

- Updated dependencies [31bae06]
- Updated dependencies [664ad5b]
- Updated dependencies [b2c32c3]
  - @forge-cms/db@0.6.0
  - @forge-cms/core@0.6.0

## 0.5.0

### Patch Changes

- @forge-cms/db@0.5.0
- @forge-cms/core@0.5.0

## 0.4.0

### Patch Changes

- 806e76b: feat: Angular/admin auth experience — session, guard, sign-in/up UI, users workspace (spec 054)
  - **`@forge-cms/angular` gains a cookie-first browser session.** Every `CmsApiService` request now
    sends `credentials: 'include'` (additive — same-origin fetch already did this by default; this is
    what makes a cross-origin deployment work once CORS allows it). No browser-session code path writes
    to `localStorage`/`sessionStorage` — the existing `authToken` Bearer path is unaffected, for
    machine/API-key consumers. New `signup()`/`logout()` methods alongside the existing `login()`
    (unchanged shape). `login`/`signup`/`logout` now throw the new `ApiAuthActionError` (`code`,
    `message`, `status`) carrying the server's own curated message instead of a generic string.
  - **New `ForgeAuthSession`** (`providedIn: 'root'`) — signals-based session state: `user`, `status`
    (`'loading' | 'authenticated' | 'anonymous' | 'error'`), `authenticated`, `loading`, `error`,
    `expired`, plus `login()`/`signup()`/`logout()` (none throw — check `authenticated()`/`error()`
    after) and `refresh()`/`ready()`. Bootstraps via exactly one `/api/auth/me` call regardless of how
    many guarded routes mount concurrently. A `401` on any request while authenticated flips the session
    to `anonymous`/`expired` without polling; a `403` never touches it.
  - **New `forgeAuthGuard(options?)`** — a functional `CanActivateFn`. Awaits the session's bootstrap,
    redirects an anonymous visitor to `signInPath` (default `/admin/login`) with a `returnUrl`, and
    — with `roles` — redirects an authenticated-but-unauthorized visitor to `forbiddenPath` (default
    `/admin`). UX only: every check is redundant with, never a substitute for, server-side enforcement.
  - **`@forge-cms/admin` gains `ForgeSignInComponent`/`ForgeSignUpComponent`** — reusable sign-in/sign-up
    pages (Volt UI, signals, accessible show/hide password toggle, `autocomplete`). Sign-up's input has
    no `role` field at all — structurally, not just visually, impossible to smuggle one through. **New
    `forgeAdminAuthRoutes({ signup? })`** mounts `login` (and `signup` only when explicitly enabled,
    matching `handleSignup`'s own opt-in default) with the same zero-assumption convention as
    `forgeAdminContentRoutes()`.
  - **New `ForgeUsersWorkspaceComponent`** — list/create/edit/delete users and reset a password
    (`updateUser(id, { password })`, already policy-checked), ported from `apps/www`'s app-local
    `UsersPage` onto the dedicated `/api/auth/users*` primitives (never the generic collection editor —
    `passwordHash` has no path to reach it). Adds last-admin UX on top: the sole admin's own
    delete/demote controls are disabled with an explanation, mirroring the new server-side invariant
    below.
  - **`ForgeAdminLayoutComponent`** now reads `ForgeAuthSession` instead of a hardcoded
    `localStorage.getItem('forge-auth-token')` check — its "Log out" button previously cleared only that
    local flag without ever calling the server logout endpoint, leaving the session cookie live; it now
    calls `session.logout()` for real. New `ForgeAdminConfig.signInPath` (default `/admin/login`)
    controls where "Log in" and the post-logout redirect go, for a host whose sign-in route predates
    `forgeAdminAuthRoutes()`'s convention.
  - **Last-admin invariant, `@forge-cms/auth`.** `UsersCollectionAuthAdapter.updateUser`/`deleteUser` now
    reject (a new `UserMutationError`, `reason: 'last-admin' | 'weak-password'`) any change that would
    leave the installation with zero admins — the sole admin demoting or deleting themselves, or being
    demoted/deleted by another admin — and reject a password-reset shorter than the configured policy
    (previously unchecked on `updateUser`, only on `createUser`/`signup`). A second admin makes both
    operations succeed normally again.
  - No behavior change to machine auth, the typed Local API, or any HTTP response shape for an existing,
    still-passing request. `apps/demo-aesthetics`'s own hand-rolled login/users UI is untouched — only its
    server `login.post.ts`/`me.get.ts` (previously hand-rolling `auth.login()`/`requireAuth()` directly and
    never setting a session cookie) were brought onto `handleLogin`/`handleMe`, and a new `logout.post.ts`
    added — required for the shared package's cookie-based client to work against that app at all.

- ab38c7b: fix: small-project readiness audit — passwordHash leak through populated relations, field ordering, Vite linker export, sign-up link (spec 055)

  Found and fixed while building a deliberately tiny external-style ForgeCMS consumer
  (`apps/tiny-project`, spec 055) whose whole point is a `post.author -> users` relation on
  `defineUsersCollection()` — exactly the shape that exposed every one of these:
  - **`@forge-cms/runtime`: `depth: 1` relation/upload population leaked every field of the related
    document, including one explicitly marked `access.read: []`** (e.g. `passwordHash` on any
    `defineUsersCollection()`/`withAuthFields()` collection) — `populateRecords`/`populateRecord`
    fetched the related row directly from the database adapter and embedded it as-is, never running it
    through `filterReadableFields`. Both now take an optional 4th `PopulateOptions` argument
    (`{ user?, overrideAccess? }`, new public export); when `overrideAccess: false` the populated
    document is filtered against _its own_ collection's field-level rules before being embedded, the
    same way the top-level document already is. `operations.ts`'s `find`/`findByID`/`findOne` and
    `handlers.ts`'s `handlePreview` now pass this through — every anonymous/restricted read that
    populates a relation is covered. A trusted Local API call (`overrideAccess` default `true`) is
    unaffected, matching every other operation's existing trust model. Both public function signatures
    are backward compatible — the new parameter is optional and defaults to today's behavior.
  - **`@forge-cms/core`: `DocumentMeta`/`CollectionInput` gain an optional `_status?: 'draft' |
'published'`** — the typed Local API previously had no way to type-check setting or reading
    `_status` on a `drafts: true` collection (`defineCollection`'s current signature widens a literal
    `drafts: true` to `boolean`, so a conditional type keyed on it could never narrow), forcing an `as
Record<string, unknown>` cast for the single most basic draft/publish workflow. Additive; no runtime
    change.
  - **`@forge-cms/auth`: `withAuthFields()` no longer puts `passwordHash` first in field order.** It
    used to spread `AUTH_USER_FIELDS` before the caller's own fields, so `passwordHash` was always the
    _first_ declared field on the merged collection — and `@forge-cms/admin`'s
    `ForgeRelationPickerComponent` searches whichever field comes first among `text`/`slug`/`email`
    kinds. A `relation({ collection: 'users' })` field silently searched by password hash instead of
    email. `passwordHash` now lands after every field the caller actually declared (still overridable —
    a caller that declares its own `passwordHash` keeps it, in whatever position they put it).
  - **`@forge-cms/admin`: the Vite linker plugin is now a public export**, `@forge-cms/admin/vite`
    (`import { angularLinker } from '@forge-cms/admin/vite'`) — previously every consuming app had to
    hand-copy `vite-plugins/angular-linker.ts` from `apps/www` or hit a production-only `JIT compiler
unavailable` crash (DEMO-FINDINGS finding 13). `@angular/compiler-cli`, `@babel/core`, and `vite`
    are now optional peer dependencies (only needed if this subpath is actually imported — no warning
    for a consumer that doesn't use it). `apps/www` and `apps/demo-aesthetics` both dropped their local
    copy in favor of this export, proving it in place.
  - **`@forge-cms/admin`: `forgeAdminAuthRoutes({ signup: true })`'s "Sign up" link now actually
    reaches `/signup`.** `ForgeSignInComponent`'s `[routerLink]` resolves relative to its own activated
    route (`login`); the unprefixed `signUpPath: 'signup'` data value appended as _login's own child_
    (`/admin/login/signup`, never a registered route — silently caught by the app's `**` wildcard and
    bounced to `/`) instead of reaching the sibling `signup` route. Now `'../signup'`.

  No behavior change for any existing caller that doesn't pass the new `PopulateOptions` argument or
  set `_status` — every existing test in the repo (914 unit tests across all packages/apps, the full
  Playwright suites for `apps/www` and `apps/demo-aesthetics`, and `pnpm release:verify`'s packed
  consumer checks) passes unmodified. See
  [docs/specs/055-small-project-readiness-audit.md](../docs/specs/055-small-project-readiness-audit.md).

- Updated dependencies [ab38c7b]
  - @forge-cms/core@0.4.0
  - @forge-cms/db@0.4.0

## 0.3.0

### Minor Changes

- 69f7aa9: feat: browser auth foundation — cookie sessions, login/signup/logout/me, CSRF protection (spec 053)
  - **Cookie sessions.** `UsersCollectionAuthAdapter` and `SignedTokenAuthAdapter`'s shared
    `extractToken` now falls back to a `forge_session` HttpOnly cookie (`@forge-cms/auth`'s new
    `cookie.ts`: `SESSION_COOKIE_NAME`, `parseCookieToken`, `buildSessionCookie`, `buildLogoutCookie`)
    when no `Authorization` header is present — a page refresh authenticates from the cookie alone, no
    client JS required. `ApiKeyAuthAdapter` (machine auth) keeps its own independent, Bearer-only
    `extractToken`, unaffected.
  - **`@forge-cms/runtime` gains reusable `handleLogin`/`handleSignup`/`handleLogout`/`handleMe`**
    (`auth-handlers.ts`) — transport-only handlers with the same envelope/error-mapping conventions as
    every other handler. `handleLogin`/`handleSignup` return `{ data: { user, token } }` (unchanged,
    Bearer-compatible) plus a `Set-Cookie`. `handleSignup` is opt-in (`enabled: boolean`) and 404s
    otherwise. `handleLogout` clears the cookie (`204`, idempotent, client-state-only — tokens are
    stateless).
  - **CSRF protection.** New `assertCsrfSafe`/`CsrfError`, wired unconditionally into
    `resolveRequest`/`resolveGlobalRequest` (so every mutating collection/global request is covered —
    including a collection with its own function-based `access`, like `defineUsersCollection()` itself,
    not just routes gated by static roles — and not just the new auth endpoints) and `handlePreview`.
    Rejects a `POST`/`PUT`/`PATCH`/`DELETE` authenticated only by the ambient session cookie (no valid
    `Authorization: Bearer`) whose `Origin`/`Referer` doesn't match the request's own host. A request
    authenticated via `Authorization: Bearer` is never subject to the check. `apps/www`'s and
    `apps/demo-aesthetics`'s admin user-management routes (which call the auth adapter directly, bypassing
    `handlers.ts`) get the same protection via a new/consolidated `requireAdminAuth()` helper.
  - **`UsersCollectionAuthAdapter` hardening:** email lookups/storage are normalized (trim + lowercase);
    a configurable password policy (`passwordPolicy: { minLength }`, default 8) is enforced on
    `createUser`/the new `signup()`; the very first user ever created — via either method — is always
    bootstrapped to `admin`, so a fresh install can never end up with a non-admin as its only user;
    duplicate-email rejection is now race-safe (catches the database's `UniqueConstraintError`, not just
    an in-process pre-check); a `collection` constructor option lets the adapter target a renamed `users`
    collection. **Breaking:** `login()` and `createUser()` now return
    `AuthActionResult` (`{ ok: true, token, user } | { ok: false, reason }`) instead of
    `{ token, user } | null` — `reason` is one of `invalid-credentials` / `invalid-email` /
    `weak-password` / `email-in-use`, which `handleLogin`/`handleSignup` map to distinct HTTP statuses.
    **`SignedTokenAuthAdapter.login()` is also affected** by the same `AuthActionResult` change (forced
    by the new optional `login?` member on `AuthAdapter` itself) — any consumer calling it directly needs
    the same `{ ok: true/false }` handling.
  - **New `signup(input: PublicSignupInput)`** for public self-service signup — `PublicSignupInput` has
    no `role` field at all, so a client cannot smuggle a role through the server API, not just through a
    UI that hides the field.
  - **New `defineUsersCollection()`** (`@forge-cms/auth`) — the recommended `users` collection shape:
    required+unique `email`, a `role` select defaulting to `viewer` (write-restricted to
    `access: { write: ['admin'] }` — without this a self-service `viewer` could write their own `role` to
    `admin` through the generic collection route), `passwordHash` via the existing `withAuthFields()`, and
    sensible default `access` (any authenticated user reads/updates their own record; only an admin
    creates, updates any record, or deletes). Opinionated, not mandatory — `withAuthFields()` still works
    standalone for a hand-rolled `users` collection.
  - **`@forge-cms/auth` package fix:** `@forge-cms/db` moves from `devDependencies` to `dependencies` — a
    real (not type-only) import of it was added for race-safe duplicate-email handling, and a
    `devDependency` is never installed for a published package's real consumers.
  - **`ExternalAuthAdapter` hardening:** `extractToken` now reuses the shared, cookie-aware parser
    instead of its own weaker regex. A network failure or a `5xx` from the validation service now throws
    (surfaces as `500`) instead of silently returning `null` (which would have looked like an ordinary
    `401`) — same "don't mask an outage as unauthenticated" rule spec 049 applied elsewhere. An explicit
    `4xx` still returns `null`.
  - `@forge-cms/cloudflare`: new `test/workers/human-auth.test.ts` proves `defineUsersCollection()` +
    `UsersCollectionAuthAdapter` against a real local D1 binding — the generated `passwordHash` column
    and unique `email` index actually work, not just against a mock.
  - No behavior change to machine auth (`ApiKeyAuthAdapter`), the typed Local API, or any success-response
    envelope shape. `apps/www`'s existing Bearer/`localStorage` client and all its e2e specs are
    unaffected — the cookie is strictly additive. (`apps/www`'s `login.post.ts`/`me.get.ts` error
    responses move from an ad hoc h3 shape to the standard Forge error envelope as a side effect of
    becoming thin wrappers — harmless in practice, since the client only checks `response.status` there.)

### Patch Changes

- @forge-cms/core@0.3.0
- @forge-cms/db@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [7ec5e67]
  - @forge-cms/core@0.2.0

## 0.1.2

### Patch Changes

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

- Updated dependencies [f88372c]
- Updated dependencies [d63d93f]
  - @forge-cms/core@0.1.1

## 0.1.0

### Minor Changes

- 73050f1: feat: add machine auth (API keys) alongside human auth (spec 048)
  - `@forge-cms/auth` gains `ApiKeyAuthAdapter` — a generic, secure machine-credential primitive.
    Secrets are 256-bit random values from Web Crypto (`crypto.getRandomValues`), never persisted;
    only a SHA-256 digest is stored, compared in constant time. The plaintext secret
    (`<prefix>_<id>_<secret>`, prefix configurable, default `'forge'`) is returned exactly once, at
    creation; `listApiKeys`/`getApiKey` never expose the hash or plaintext. Keys support generic
    `scopes: string[]` and consumer-defined `metadata`, plus `expiresAt`/`revokedAt` — an expired or
    revoked key fails authentication the same generic, non-leaking way an unrecognized one does.
    Persists through the configured `DatabaseAdapter` in an internal system collection
    (`_forge_api_keys`) that is never part of a consumer's `config.collections`, so it cannot be
    reached through generic `/api/v1/*` CRUD.
  - `@forge-cms/auth` gains `CompositeAuthAdapter`, so an application can authenticate human sessions
    and machine API keys through one configured `AuthAdapter` (`new CompositeAuthAdapter([userAuth,
apiKeyAuth])`) with no adapter-specific branching anywhere in `@forge-cms/runtime`.
  - `@forge-cms/auth` gains `hasScope`/`hasAnyScope`/`hasAllScopes` — lightweight helpers over
    `user.scopes`, so existing `access` functions can express `hasScope(user, 'articles:read')`
    exactly like a role check. Scopes are opaque consumer strings; there is no scope-name registry and
    no automatic scope-to-CRUD mapping.
  - `AuthUser` (`@forge-cms/auth`) and the structurally-identical `CmsUser` (`@forge-cms/core`) both
    gain an optional `scopes?: string[]`. `AuthAdapter` gains an optional
    `syncSchema?(): Promise<void>` lifecycle hook, now called by `ForgeCmsRuntime.syncSchema()` — this
    is what lets `ApiKeyAuthAdapter` provision its own table with no manual SQL. Both changes are
    additive and backward compatible; every existing adapter keeps working unchanged.
  - No consumer/domain-specific concepts (projects, catalogs, translations, locales) were added — this
    is a fully generic machine-auth foundation, per the standing rule from spec 044.

### Patch Changes

- Updated dependencies [73050f1]
- Updated dependencies [a2c5837]
  - @forge-cms/core@0.1.0

## 0.0.2

### Patch Changes

- Updated dependencies [18f25f8]
  - @forge-cms/core@0.0.2

## 0.2.0

### Minor Changes

- 83f3b66: Normalize all package versions to 0.1.0 before the first npm publish.

## 0.1.0

### Minor Changes

- Add `SignedTokenAuthAdapter`, a real edge-compatible auth adapter (HS256-style signed tokens via Web Crypto only, no new dependency). Supports `login(email, password)` against one hardcoded demo user, `issueToken`, and the standard `AuthAdapter` contract (passes `runAuthAdapterContractTests`).
