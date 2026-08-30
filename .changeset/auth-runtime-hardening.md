---
'@forge-cms/core': patch
'@forge-cms/db': patch
'@forge-cms/auth': patch
'@forge-cms/runtime': patch
'@forge-cms/cloudflare': patch
---

fix: harden auth error semantics, API-key lifecycle, and DB-adapter schema sync (spec 049)

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
