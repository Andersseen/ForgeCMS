---
'@forge-cms/core': minor
'@forge-cms/runtime': minor
'@forge-cms/auth': minor
'@forge-cms/db': minor
'@forge-cms/cloudflare': minor
'@forge-cms/testing': minor
---

Phase 0.2 — Trust / Production Hardening

**Breaking changes:**

- Auth adapters (`SignedTokenAuthAdapter`, `UsersCollectionAuthAdapter`) now require explicit `AUTH_SECRET` in production. Pass `{ devMode: true }` to use the built-in dev secret in development.
- API error responses now use a structured format: `{ error: { code, message, details? } }` instead of `{ error: string }`.
- Unknown fields in document bodies are now rejected with a validation error.
- Unknown filter/sort fields in queries are now rejected with a 400 error.
- Strict integer parsing for `limit`/`offset` query parameters (rejects `10foo`, negative values, excessive limits).

**New features:**

- Identifier validation: collection slugs and field names must match `^_?[a-z][a-zA-Z0-9_]*$`
  (the leading underscore is reserved for internal tables such as globals/versions).
- Query filters with multiple operators on one field are ANDed consistently across adapters
  (`{ price: { gte: 10, lte: 50 } }`).
- Field hooks now run recursively inside `group`, `array`, and `blocks` fields.
- Structured logging: `ForgeLogger` interface with `getLogger()`/`setLogger()` in `@forge-cms/core`.
- Upload lifecycle integrity: storage objects are cleaned up if document creation fails.
- Upload limits: configurable `maxFileSize` and `mimeTypes` in handler options.
- New error codes: `UNKNOWN_FIELD`, `INVALID_QUERY`, `INTERNAL_ERROR`.
- System field `_storageKey` for upload collections to track storage object keys.

**Security improvements:**

- Database adapters (D1, LibSQL) now validate column names against the collection schema before SQL generation.
- Token extraction is stricter: rejects malformed Authorization headers.
- Production deployments must set `AUTH_SECRET` explicitly; the dev-only fallback is no longer silent.
