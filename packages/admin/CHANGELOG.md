# @forge-cms/admin

## 0.4.1

### Patch Changes

- 5dd03da: Harden admin auth redirects, remove decorative shell controls and external avatar loading, and
  improve dialog semantics and empty-state affordances.
  - @forge-cms/angular@0.4.1

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
  - @forge-cms/angular@0.4.0

## 0.3.0

### Patch Changes

- @forge-cms/angular@0.3.0

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
  - @forge-cms/angular@0.2.0

## 0.1.2

### Patch Changes

- @forge-cms/angular@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [d63d93f]
  - @forge-cms/angular@0.1.1

## 0.1.0

### Patch Changes

- @forge-cms/angular@0.1.0

## 0.0.2

### Patch Changes

- @forge-cms/angular@0.0.2

## 0.2.0

### Minor Changes

- 1a9dec6: Refactor collection metadata: remove redundant `CollectionMeta.fields` and add `relation` metadata to `FieldMeta`. The admin form now renders `relation` fields and uses a native select for `select` fields.
- 83f3b66: Normalize all package versions to 0.1.0 before the first npm publish.

### Patch Changes

- Updated dependencies [1a9dec6]
- Updated dependencies [83f3b66]
  - @forge-cms/angular@0.2.0

## 0.1.0

### Minor Changes

- `ForgeAdminLayoutComponent`, `ForgeCollectionListComponent`, and `ForgeCollectionFormComponent` are now real components (moved from `apps/www`'s demo), not placeholders — real Angular admin layout (sidebar, breadcrumbs, theme toggle, auth-aware login/logout link), a schema-driven document list, and a schema-driven create/edit form. Also exports `PageHeaderComponent`/`LoadingStateComponent`/`ErrorStateComponent`/`EmptyStateComponent`. New peer dependencies: `@voltui/components`, `lumen-icons`, `rxjs`. The package now builds with `ngc` (Angular's partial-compilation mode) instead of plain `tsc`, required for its components to be statically analyzable by a consuming app's AOT build.

### Patch Changes

- Updated dependencies
- Updated dependencies [fa38e92]
- Updated dependencies [fa38e92]
- Updated dependencies
  - @forge-cms/angular@0.1.0
