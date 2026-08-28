---
'@forge-cms/auth': minor
'@forge-cms/core': minor
'@forge-cms/runtime': patch
---

feat: add machine auth (API keys) alongside human auth (spec 048)

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
