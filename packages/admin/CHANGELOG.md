# @forge-cms/admin

## 0.13.0

### Minor Changes

- 90376d1: Reusable admin mounts anywhere, and the 1.0 admin surface is reviewed (spec 087, roadmap 0.11 / U03). Adds `ForgeAdminConfig.basePath` and `forgeAdminAuthRoutes({ basePath })` — a same-app mount root such as `/studio` or `/ops/cms` (default `/admin`, unchanged for existing hosts) that roots the layout's breadcrumbs, default navigation and default sign-in path, and bounds the sign-in/sign-up return target (`/admin/...`, `/studio-evil`, `//host` and URLs are refused). Route `data.config` now also reaches `ForgeCollectionsIndexComponent` (previously only the layout saw it). `ForgeAdminConfig.collections` is typed `ReadonlyArray<{ slug }>` so browser apps need not import server schema; `logo` and `features` are marked deprecated no-ops.

  **Behaviour change (why this is a minor):** `DEFAULT_ADMIN_NAV` now lists only what the package mounts — Collections and the admin-only Users — instead of also linking Dashboard, Media Library, API and Settings pages the package never provided. A host that relied on the old defaults must list those entries in `nav`. An inline `collections: [{ slug, …extra }]` literal with extra keys no longer type-checks (pass slugs, or a variable). Migration notes: `docs/1.0-PUBLIC-SURFACE.md`.

### Patch Changes

- @forge-cms/angular@0.13.0

## 0.12.1

### Patch Changes

- 5383b69: Keyboard, focus and field interactions in the admin (spec 086, roadmap 0.11 / U02). Modals trap and restore focus (`@angular/cdk/a11y` is now a declared peer, `^21.2.0`); unsaved-change navigation asks in Forge's own dialog instead of `window.confirm`; every field is named by a real `<label for>` and its rendered control carries `required`/`aria-invalid`/`aria-describedby`; a server validation error focuses the first invalid field; composite errors render with their fieldset; `minRows` is respected on removal; rows address the correct row (a nested-`@for` index bug edited row 0 when a later row's first field changed); unknown stored block types are kept untouched; `date`/`withTime` fields use the right native control; the locale selector, relation picker, upload picker and richtext editor are keyboard operable with named controls; the editor keeps Save/Cancel on screen on a phone. Adds optional inputs `error` (form), `label` (relation and upload pickers) and `label`/`idPrefix` (richtext). `ForgeDocumentEditorComponent.canDeactivate()` now returns `boolean | Promise<boolean>`; hosts composing their own guard must await it.
- Updated dependencies [5383b69]
  - @forge-cms/angular@0.12.1

## 0.12.0

### Minor Changes

- 21795b9: Reliable content state and failure recovery in the reusable admin (spec 085, roadmap 0.11 / U01).
  The document editor saves once (a visible "Saving…" state, no duplicate writes), keeps the form and
  unsaved-changes flag after any failed save, and starts a clean draft when the document changes. The
  collection workspace keeps search/filter/sort/page across editor round trips, resets them for another
  collection, and isolates late delete/publish responses; deleting and publishing report the real
  outcome (a failed delete keeps its dialog as the retry path). The users workspace is latest-wins,
  single-write, keeps its form on failure and shows friendly errors. A session expiry no longer erases
  unsaved edits, and a `403` re-reads the live role through `ForgeAuthSession`.

  Additive component inputs: `ForgeCollectionFormComponent` `submitting`/`submitDisabled`,
  `ForgeConfirmDialogComponent` `pending`/`pendingLabel`/`error`, `ForgeCollectionListComponent`
  `pendingIds`.

### Patch Changes

- @forge-cms/angular@0.12.0

## 0.11.0

### Patch Changes

- @forge-cms/angular@0.11.0

## 0.10.2

### Patch Changes

- @forge-cms/angular@0.10.2

## 0.10.1

### Patch Changes

- Updated dependencies [3656284]
  - @forge-cms/angular@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies [5ba2958]
  - @forge-cms/angular@0.10.0

## 0.9.3

### Patch Changes

- @forge-cms/angular@0.9.3

## 0.9.2

### Patch Changes

- 19798ed: Angular resource reliability and proven peer ranges (spec 077, roadmap 0.8 C03).

  **Resources** (`collectionResource`, `documentResource`) — same public API, deterministic behaviour:
  - A superseded request (new params, `reload()`, params → `undefined`, owner destroyed, credential
    change) is **aborted** through its `AbortSignal`, and can never write `value`/`error`/`isLoading`
    afterwards — even with a custom transport that ignores the signal.
  - **Fixed:** when params became `undefined`, the in-flight request could still fill the resource
    afterwards. Idle now resets `value()` and `error()` and invalidates the request.
  - **Behaviour change:** `value()` resets to `undefined` when the request changes (another query, page,
    id) instead of showing the previous request's result while the new one loads. `reload()` (same
    request) still keeps the value while loading. A failure clears `value()`; an abort is never an
    `error()`. Nothing is retried.
  - **Credentials:** every sign-in, sign-up, sign-out (even a failed one), first `401` while signed in,
    or `refresh()` that finds another user immediately hides resource values and reloads them under the
    new identity; a request started as user A can never fill a resource after the switch. An
    `authToken` function that reads a signal is observed the same way.

  **Admin:** the document editor resets its unsaved-changes flag and save errors when the edited
  document changes (A → B, edit → new), and never shows document A while B loads.

  **Peers are now ranges proven by `pnpm release:compat`** (strict installs of packed tarballs, single
  Angular copy, `tsc` + `ngc` strict templates, linked production build):
  - `@forge-cms/angular`: `@angular/core`/`@angular/router` `^21.0.0 || ^22.0.0` (was exactly `21.2.10`).
  - `@forge-cms/admin`: `@angular/*` `^21.2.0`, `rxjs` `^7.8.0`, `@voltui/components` `^1.0.1`,
    `lumen-icons` `^0.2.0`, optional `@babel/core` `^7.28.0` and `vite` `^7.0.0 || ^8.0.0` (were exact
    pins that the first-party apps' own versions — VoltUI 1.1.0, rxjs 7.8.2, Vite 7.1.4 — did not satisfy).

  **New `@forge-cms/angular/vite`:** the Angular linker Vite plugin moved here from `@forge-cms/admin/vite`
  (which re-exports it unchanged), because a Vite/Analog app using only `@forge-cms/angular` also needs
  it — without it, its production build crashed with `JIT compiler unavailable`. Optional peers:
  `@angular/compiler-cli`, `@babel/core` (`^7.28.0 || ^8.0.0`; Angular 22 needs Babel 8), `vite`.

- Updated dependencies [19798ed]
  - @forge-cms/angular@0.9.2

## 0.9.1

### Patch Changes

- 5dbf847: Honest schema-to-wire types for the Angular client (spec 076, roadmap 0.8 C02). Patch level on purpose: the fixed group already moves to `0.9.0` through C01's pending minor changeset.
  - `@forge-cms/angular`: share the content model's **type** with the browser (`type SiteSchema = ForgeSchema<typeof collections, [typeof siteSettings]>`, from `import type`, so no server code is bundled) and call `injectForgeClient<SiteSchema>()`. Slugs, `where`/`sort` fields, create/update payloads and results are checked against what the HTTP API sends: ISO date strings, `depth: 1` targets that may be `null` (many: readable targets only), access-controlled fields optional, `access.read: []` fields absent, localized fields a per-locale map without `locale` and a string with it, write results that may be only `{ id }`. New types: `ForgeSchema`, `ForgeDocument`, `ForgeCreateInput`, `ForgeUpdateInput`, `ForgeWriteResult`, `ForgeGlobalDocument`, `ForgeGlobalInput`, `ForgeWhere`, `ForgeSort`, `ForgeQueryOptions`, `UntypedDocument` and friends. `@forge-cms/core` is now a (type-only) dependency.
  - **Migration:** `CmsApiService` is `CmsApiService<S = UntypedForgeSchema>`; `inject(CmsApiService)` is the untyped client (results `UntypedDocument`). The per-method response generic is removed — `getDocument<Post>(…)` no longer compiles: use the typed client, or treat results as untyped. `collectionResource<Post>(…)` becomes `collectionResource<SiteSchema, 'posts'>(…)` (or no type argument). Typed create/update results are `document | { id }`.
  - **Dates (demo finding 24):** a date is an ISO-8601 `toISOString()` string at rest, on Local API reads and on the wire. `@forge-cms/runtime` canonicalizes every valid date on write (top-level and nested; before, in-memory echoed the caller's text and a numeric timestamp read back as `null` on libSQL/D1). `@forge-cms/db`'s `fromDbValue` returns the canonical string instead of a `Date`. `@forge-cms/core`: `DateField` reads as `string`; the typed Local API input takes `Date | string` (`FieldInputValue`, `InferInputFields`). **Local API reads of dates on libSQL/D1 are now strings** — use `new Date(value)` where a `Date` is needed.
  - `@forge-cms/core`: `defineField.*` keep their options as literal types (`required`, `access`, `localized`, relation target and `many`, select options); `defineCollection`/`defineGlobal` keep a literal `drafts: true` (`DraftsFlag`); `FieldDefinition`'s options parameter is no longer constrained. A `required` localized field now rejects an empty per-locale map `{}`.
  - `@forge-cms/auth`: `defineUsersCollection()` keeps a literal slug (`'users'` by default) instead of `string`, so registries containing it keep typed slugs.
  - `@forge-cms/admin`: uses the untyped client (no behaviour change).

- Updated dependencies [5dbf847]
  - @forge-cms/angular@0.9.1

## 0.9.0

### Minor Changes

- d1e486b: Configurable Angular transport and structured errors (spec 075, roadmap 0.8 C01 — the first npm `0.9.0` work).
  - `@forge-cms/angular`: every option of `provideForgeCms()` is optional (defaults unchanged: same-origin `/api/v1` and `/api/auth`, cookie credentials). New `credentials`, `trustedOrigins` and `transport` options; cookies and the Bearer token are sent only to relative URLs, the page's origin and listed origins. One URL joiner; every collection slug, document id, user id and global slug is encoded as one path segment. Every method takes an optional last `{ signal }`. Every failure is a `ForgeApiError` (`kind`: `http` | `network` | `aborted` | `invalid-response`, plus `status`, `code`, `details`); `ApiValidationError`, `ApiAuthError` and `ApiAuthActionError` are now its subclasses. Nothing is retried.
  - **Behavior changes:** `getCurrentUser()` resolves `null` only for a 401 and throws for a 403/5xx/network/malformed response, so `ForgeAuthSession` enters `'error'` instead of `'anonymous'` during an outage. A failed `ForgeAuthSession.logout()` keeps its error. An absolute base on another origin no longer receives credentials unless listed in `trustedOrigins`.
  - `@forge-cms/admin`: `describeAdminError` reads the structured status/kind (network, 403, 404, 409, 413, 429, 5xx); new `describeSessionError`, used by the sign-in and sign-up forms so an outage is never shown as a credential problem.

### Patch Changes

- Updated dependencies [d1e486b]
  - @forge-cms/angular@0.9.0

## 0.8.3

### Patch Changes

- @forge-cms/angular@0.8.3

## 0.8.2

### Patch Changes

- @forge-cms/angular@0.8.2

## 0.8.1

### Patch Changes

- d0d12dc: The reusable collection workspace (`forgeAdminContentRoutes()`) now lists documents with `depth: 1`,
  so relation and upload columns show the related document's title and the image thumbnail instead of
  a truncated id. Spec 042 had this on the app-local list that spec 052's workspace replaced; found by
  moving `apps/demo-aesthetics` onto the package routes (spec 071).

  Also from the same dogfood pass:
  - Wide collection lists and the users table scroll inside the content area instead of widening the
    whole page (a `services` list overflowed a 390 px viewport by 700 px).
  - The layout's sidebar-collapse and theme buttons have accessible names. The theme toggle's label sat
    on the `<volt-button>` host, which Volt 1.0.x does not forward to the native button.
  - Boolean fields in the document form render a switch named after the field; its `<label>` did not
    reach Volt's inner switch button, so it had no accessible name.
  - @forge-cms/angular@0.8.1

## 0.8.0

### Patch Changes

- @forge-cms/angular@0.8.0

## 0.7.0

### Patch Changes

- @forge-cms/angular@0.7.0

## 0.6.0

### Patch Changes

- e5151aa: The collection form no longer submits the Forge-owned metadata (`id`, `created_at`, `updated_at`,
  `_storageKey`) of the document it loaded. Saving therefore always gets a new `updated_at` from the
  server. It also avoids a spurious `400` when another write changed the document's metadata after the
  form loaded it (spec 063).
- 215c026: `ForgeAdminLayoutComponent`: the sidebar and top header bar now stay fixed while only the page content
  scrolls, instead of the whole admin shell (sidebar included) scrolling together on a tall page — found
  on the Clinic settings page in `apps/demo-aesthetics`, which has enough fields to overflow the viewport.
  The outer shell moved from `min-h-screen` (grows with content) to `h-dvh overflow-hidden` (pinned to the
  viewport); the header gained its own bounded, non-scrolling region, and only the `<router-outlet>`
  content area scrolls (`overflow-y-auto` with `min-h-0`, the standard fix for a flex child that needs to
  shrink below its content's natural height). No template structure or public API changed — CSS only.
  Affects every consumer of `@forge-cms/admin`'s shared admin shell (`apps/www`, `apps/demo-aesthetics`,
  `apps/tiny-project`); `e2e:www`/`e2e:demo`/`e2e:tiny-project` re-run and pass.
- Updated dependencies [d718fbd]
  - @forge-cms/angular@0.6.0

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

- 5dd03da: Harden admin auth redirects, remove decorative shell controls and external avatar loading, and
  improve dialog semantics and empty-state affordances.
- 255febb: Fix mismatched Angular peer dependency pins that caused pnpm to install a second, duplicate copy of `@angular/common`/`@angular/platform-browser` inside any app depending on `@forge-cms/admin` (e.g. `apps/demo-aesthetics`). The duplicate copy's DOM adapter was never initialized by `bootstrapApplication`, so `PlatformLocation.getBaseHrefFromDOM()` threw `Cannot read properties of null (reading 'getBaseHref')` at runtime — reproduced in production on `/login` at `forge-cms-demo.pages.dev`. `@forge-cms/admin` and `@forge-cms/angular` now pin `@angular/*` peers to `21.2.10`, matching every consumer app, and `@forge-cms/admin` now declares `@angular/platform-browser` as an explicit peer so it dedupes against the host app's copy instead of resolving its own via a transitive `@angular/cdk` peer requirement.
- Updated dependencies [255febb]
- Updated dependencies [23dac05]
  - @forge-cms/angular@0.5.0

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
