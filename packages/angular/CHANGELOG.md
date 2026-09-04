# @forge-cms/angular

## 0.4.1

## 0.4.0

### Minor Changes

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

## 0.3.0

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

## 0.1.2

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

## 0.1.0

## 0.0.2

## 0.2.0

### Minor Changes

- 1a9dec6: Refactor collection metadata: remove redundant `CollectionMeta.fields` and add `relation` metadata to `FieldMeta`. The admin form now renders `relation` fields and uses a native select for `select` fields.
- 83f3b66: Normalize all package versions to 0.1.0 before the first npm publish.

## 0.1.0

### Minor Changes

- Add `ApiAuthError` (thrown by write methods on a `401` response) and `CmsApiService.login(email, password)`.

### Patch Changes

- fa38e92: `createDocument`/`updateDocument` now throw `ApiValidationError` (with a `details: ApiFieldError[]` array) when the server responds with per-field validation errors, instead of a generic `Error`. Parses the actual response shape the write routes return today (`{ statusMessage, data: { errors } }`, via h3's `createError`) rather than the `{ error, details }` shape documented in ARCHITECTURE.md, which doesn't match reality for these two routes.
- fa38e92: Add `FieldMeta` and `CollectionMeta.fieldDefinitions` (field kind, label, required, select options) so clients can render schema-driven UI (tables, forms) instead of just field names. Additive — existing `CollectionMeta.fields: string[]` is unchanged.
- `toApiError` now parses the `{ error: string, details?: ApiFieldError[] }` envelope ARCHITECTURE.md documents, since `apps/www`'s write routes now delegate to `@forge-cms/runtime`'s handlers (which have always produced this shape) instead of hand-rolling h3 error responses. Supersedes the shape described in the `api-validation-error` changeset, which matched the old (now-removed) route implementation.
