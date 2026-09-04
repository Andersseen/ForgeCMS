# @forge-cms/auth

## 0.4.1

### Patch Changes

- @forge-cms/core@0.4.1
- @forge-cms/db@0.4.1

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
