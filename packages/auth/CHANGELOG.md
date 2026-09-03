# @forge-cms/auth

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
