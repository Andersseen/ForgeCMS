# @forge-cms/runtime

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
