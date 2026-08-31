# @forge-cms/auth

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
