# @forge-cms/runtime

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
