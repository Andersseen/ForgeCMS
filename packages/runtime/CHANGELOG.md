# @forge-cms/runtime

## 0.6.0

### Minor Changes

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

- e5151aa: **Security:** callers can no longer write Forge-owned document metadata (spec 063).
  - **`_storageKey` belongs to the upload pipeline.** Before, anyone with update + delete access on one
    upload document could `PATCH { "_storageKey": "<another object's key>" }` and then delete the
    document, which deleted the **other** object from storage. Now `create`, `update`, `preview`,
    `restoreVersion`, `updateGlobalDocument` and every HTTP handler refuse `_storageKey`, whether or not
    `overrideAccess` is set. Only the multipart upload flow records it, through an internal path that is
    not exported.
  - **Deletion only uses `_storageKey`.** Spec 051's fallback that derived the object key from `url` is
    removed, because `url` is an editable field and could point at another document's file. **Upgrade
    note:** deleting an upload document that has no `_storageKey` (created from JSON, or recorded before
    storage keys existed) no longer deletes any object; Forge logs a warning and the object must be
    removed by hand.
  - **`id`, `created_at` and `updated_at`.**
    - A create containing `created_at`, `updated_at` or `_storageKey` returns
      `400 INVALID_INPUT` ("Field '<key>' is managed by Forge and cannot be written"), and nothing is
      written.
    - An update or preview may contain these keys only with their stored values. Those echoes are
      dropped (a `null` counts as not set), so clients that send back the whole document they read keep
      working, and the adapter now
      stamps a new `updated_at`. On libSQL/D1, a stale `updated_at` sent back this way used to overwrite
      the new stamp.
    - A caller-chosen `id` on create is refused over HTTP and with `overrideAccess: false`. Trusted Local
      API code can still pass a non-empty string `id` for seeds and imports.
  - **Hooks.** `beforeValidate`/`beforeChange` hooks (collections and globals) may change content and
    `_status`, not these keys. A hook that changes one fails the operation with an internal error (500).
    Hooks no longer see a trusted create's explicit `id` or the upload key in `data`; both appear on the
    returned `doc`.
  - `_status` stays writable on `drafts` collections and globals.
  - `runtime.adapters.database` remains the raw layer outside every CMS check.
  - No new exports.

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
- Updated dependencies [1c22996]
- Updated dependencies [664ad5b]
- Updated dependencies [d718fbd]
- Updated dependencies [b2c32c3]
  - @forge-cms/db@0.6.0
  - @forge-cms/auth@0.6.0
  - @forge-cms/core@0.6.0
  - @forge-cms/storage@0.6.0
  - @forge-cms/api@0.6.0

## 0.5.0

### Patch Changes

- @forge-cms/auth@0.5.0
- @forge-cms/db@0.5.0
- @forge-cms/storage@0.5.0
- @forge-cms/core@0.5.0
- @forge-cms/api@0.5.0

## 0.4.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [806e76b]
- Updated dependencies [ab38c7b]
  - @forge-cms/auth@0.4.0
  - @forge-cms/core@0.4.0
  - @forge-cms/api@0.4.0
  - @forge-cms/db@0.4.0
  - @forge-cms/storage@0.4.0

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

- Updated dependencies [69f7aa9]
  - @forge-cms/auth@0.3.0
  - @forge-cms/core@0.3.0
  - @forge-cms/db@0.3.0
  - @forge-cms/storage@0.3.0
  - @forge-cms/api@0.3.0

## 0.2.0

### Minor Changes

- 7ec5e67: feat: embeddable content-admin orchestration — collections index, workspace, document editor (spec 052)
  - **`@forge-cms/admin`** gains a content-CRUD orchestration layer on top of the existing
    presentational components: `ForgeCollectionsIndexComponent` (every visible collection with a real
    document count and a link into its workspace), `ForgeCollectionWorkspaceComponent` (owns search,
    sort, status filter, and pagination query state, driving the existing `ForgeCollectionListComponent`
    via `collectionResource()`), `ForgeDocumentEditorComponent` (create/edit via `documentResource()`,
    validation-error mapping, and an unsaved-changes guard exposed as
    `canDeactivateForgeDocumentEditor`), `ForgeConfirmDialogComponent` (a reusable "are you sure?"
    overlay for delete), and `forgeAdminContentRoutes()` (the `collections`/`collections/:collection`
    route subtree, with the create/edit editor rendered as an overlay through the workspace's own
    `<router-outlet>`). `ForgeCollectionFormComponent` gained a `dirtyChange` output.
    `ForgeCollectionListComponent` now shows a title column (driven by a collection's `useAsTitle`)
    instead of always leading with a raw id, and its edit/delete icon buttons gained accessible names.
    None of the existing low-level components changed their own public signatures.
  - **`@forge-cms/core`**: `CollectionDefinition` gains an optional, purely additive
    `admin?: { label?, description?, useAsTitle?, defaultColumns? }` — presentational hints only, never
    validated against document data, never affecting the generated DB schema.
  - **`@forge-cms/runtime`**: `describeCollection` passes `admin.*` through to the client-facing
    `CollectionDescription` (preferring it over the existing slug-humanizing fallback).
  - **`@forge-cms/angular`**: `CollectionMeta` gains `useAsTitle`/`defaultColumns`; `CmsApiService`
    gains `setDocumentStatus()`, a thin convenience wrapper over `updateDocument` for a `drafts: true`
    document's `_status`.

  `apps/www` dogfoods the new layer (`collections.page.ts`/`collection-detail.page.ts` deleted in
  favor of `forgeAdminContentRoutes()`); `apps/demo-aesthetics` is unaffected (all changes are
  additive) and was not migrated. See
  [docs/specs/052-embeddable-content-admin.md](../docs/specs/052-embeddable-content-admin.md).

### Patch Changes

- Updated dependencies [7ec5e67]
  - @forge-cms/core@0.2.0
  - @forge-cms/api@0.2.0
  - @forge-cms/auth@0.2.0
  - @forge-cms/db@0.2.0
  - @forge-cms/storage@0.2.0

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

- Updated dependencies [8a31e33]
  - @forge-cms/db@0.1.2
  - @forge-cms/auth@0.1.2
  - @forge-cms/core@0.1.2
  - @forge-cms/storage@0.1.2
  - @forge-cms/api@0.1.2

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
  - @forge-cms/db@0.1.1
  - @forge-cms/auth@0.1.1
  - @forge-cms/api@0.1.1
  - @forge-cms/storage@0.1.1

## 0.1.0

### Minor Changes

- a2c5837: feat: add typed collection Local API (spec 047)
  - `ForgeCmsRuntime` now takes a second, defaulted type parameter that preserves the registered
    collection schemas: `find`/`findByID`/`count`/`create`/`update`/`delete`/`preview` infer typed
    collection slugs (autocomplete + compile-time rejection of unknown slugs), typed write payloads
    (unknown fields/wrong value types are compile errors), and typed returned documents (declared
    fields plus `id`/`created_at`/`updated_at`) — with **zero runtime behavior change**.
  - `@forge-cms/core` gains the small reusable type utilities this relies on: `CollectionRegistry`,
    `CollectionSlug`, `CollectionBySlug`, `CollectionDocument`, `CollectionInput`, `DocumentMeta`,
    reusing `CollectionData`/`InferFields`/`FieldValue` rather than a parallel type system.
  - `defineField.json<TValue>()` is now generic — a compile-time-only annotation that carries a
    consumer-provided type through `CollectionData`/`CollectionDocument` (`defineField.json()` still
    infers `unknown`, exactly as before; no runtime JSON-shape validation is added).
  - `sort` and `where` keys on `find`/`count` are constrained to the collection's declared fields plus
    standard document metadata, so `sort: 'doesNotExist'` is a compile error.
  - Fully backward compatible: a broad/untyped `CollectionDefinition[]` registry, or
    `new ForgeCmsRuntime<TEnv>(...)` given only an environment type, still compiles and still accepts
    any collection string, returning a loosely-typed (not `any`) document — the same shape the Local
    API always returned. Adapters (`DatabaseAdapter`/`D1DatabaseAdapter`/`LibSqlDatabaseAdapter`/
    `InMemoryDatabaseAdapter`) and HTTP handlers required no generic redesign — the handler-facing
    runtime type is pinned to accept any collection registry, since request-time collection slugs are
    plain strings that can never be statically narrowed.

### Patch Changes

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

- Updated dependencies [73050f1]
- Updated dependencies [a2c5837]
  - @forge-cms/auth@0.1.0
  - @forge-cms/core@0.1.0
  - @forge-cms/api@0.1.0
  - @forge-cms/db@0.1.0
  - @forge-cms/storage@0.1.0

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
  - @forge-cms/db@0.0.2
  - @forge-cms/api@0.0.2
  - @forge-cms/auth@0.0.2
  - @forge-cms/storage@0.0.2

## 0.1.0

### Minor Changes

- 83f3b66: Normalize all package versions to 0.1.0 before the first npm publish.

### Patch Changes

- a759660: Fix `handleUpdate` partial validation so that required fields already present on the stored record are not required to be resent in a PUT body.
- Updated dependencies [2b5d6da]
- Updated dependencies [83f3b66]
  - @forge-cms/db@0.1.0
  - @forge-cms/core@0.1.0
  - @forge-cms/api@0.1.0
  - @forge-cms/storage@0.1.0
  - @forge-cms/auth@0.2.0

## 0.0.1

### Patch Changes

- 3029071: Coerce list-filter query params to the field's declared type (number/boolean) in `handleList`, so `?price=99` and `?published=true` match against real numeric/boolean values instead of comparing strings. Invalid values (e.g. `?price=abc`) now return a 400 with a clear error message.
- Updated dependencies [44956ef]
- Updated dependencies
  - @forge-cms/db@0.0.1
  - @forge-cms/auth@0.1.0
