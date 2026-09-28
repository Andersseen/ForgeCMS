---
'@forge-cms/db': minor
'@forge-cms/cloudflare': minor
'@forge-cms/auth': minor
'@forge-cms/runtime': minor
'@forge-cms/testing': minor
---

Detect schema drift and plan safe upgrades (spec 070, roadmap 0.7 M01).

**Behaviour change:** on libSQL and D1, `syncSchema()` no longer reports success for a database it
did not bring in line. It plans first. Fresh tables and safe additive changes run as one
transaction. Anything that needs a reviewed migration throws `SchemaDriftError` with **nothing
executed**, in any table. Examples: a removed field, a type change, `localized` or relation `many`
toggled, a new required field on a non-empty table, `drafts`/`upload` enabled on a non-empty table,
`unique` ⇄ `index` on the same field, a stale unique index, or a new unique index over duplicate rows.
Renames are never guessed. Check a deployed database with `runtime.planSchema()` before upgrading; see
`docs/SCHEMA-UPGRADES.md`.

- `@forge-cms/db`:
  - `SchemaPlan`, `SchemaChange`, `SchemaChangeKind`, `SchemaChangeClassification`,
    `SchemaDriftError`, `isSchemaDriftError`, `formatSchemaPlan`, `mergeSchemaPlans` and
    `SCHEMA_BASELINE_TABLE`;
  - optional `DatabaseAdapter.planSchema(collections)`;
  - `planSqliteSchema`/`syncSqliteSchema` over a `SqliteSchemaExecutor`;
  - `desiredTableSchema` (the one model DDL and planning share).
  - `LibSqlDatabaseAdapter` and `InMemoryDatabaseAdapter` implement `planSchema` (InMemory's plan is
    always empty).
  - A new internal table, `_forge_schema`, records each table's semantic baseline (kind, localized,
    cardinality, target, required, default).
  - `generateAddColumnSql` is deprecated.
- `@forge-cms/cloudflare`: `D1DatabaseAdapter` implements `planSchema` and plans before `syncSchema`.
- `@forge-cms/auth`: optional `AuthAdapter.planSchema()`, implemented by
  `UsersCollectionAuthAdapter` (`_forge_bootstrap`), `ApiKeyAuthAdapter` (`_forge_api_keys`) and
  `CompositeAuthAdapter`.
- `@forge-cms/runtime`: `ForgeCmsRuntime.planSchema()` covers collections, globals, versions,
  storage intents and the auth adapter's tables. `syncSchema()` refuses before touching any table.
  Spec 062's duplicate-version diagnostic is unchanged.
- `@forge-cms/testing`: `runSchemaDriftContractTests` (from `@forge-cms/testing/contracts`).
