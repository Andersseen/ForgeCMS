---
'@forge-cms/core': minor
'@forge-cms/runtime': minor
---

feat: add typed collection Local API (spec 047)

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
