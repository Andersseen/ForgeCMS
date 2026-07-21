---
'@forge-cms/db': minor
'@forge-cms/cloudflare': minor
'@forge-cms/runtime': minor
'@forge-cms/testing': minor
---

Added query operators and single-field sorting to `DatabaseAdapter.findMany` (spec 011).

- `@forge-cms/db`: `where` values can now be a bare value (`eq`, unchanged) or an operator object —
  `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `contains` (new `packages/db/src/where.ts`). `FindManyOptions`
  gained `sort`/`order`. Implemented in `InMemoryDatabaseAdapter` and `LibSqlDatabaseAdapter` (drizzle
  operators + `.orderBy`); `LibSqlDatabaseAdapter` now has its own test file (it had none before).
- `@forge-cms/cloudflare`: `D1DatabaseAdapter.findMany` maps operators to parameterized SQL and adds
  `ORDER BY`; column names (including `sort`) are validated against the collection's known fields
  before interpolation.
- `@forge-cms/runtime`: `GET /api/v1/[collection]` accepts `field[op]=value` query params (`in` is
  comma-separated) alongside the existing bare `field=value` equality syntax, plus `sort`/`order`.
  Unknown operators or sort fields return `400`.
- `@forge-cms/testing`: extended `runDatabaseAdapterContractTests` with cases for every operator and
  both sort directions.
