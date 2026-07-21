---
'@forge-cms/db': minor
'@forge-cms/cloudflare': minor
---

Added additive schema migrations (spec 014): `syncSchema` now detects fields present in a collection's
definition but missing from its already-existing table and adds them via `ALTER TABLE ... ADD COLUMN`,
on both `LibSqlDatabaseAdapter` and `D1DatabaseAdapter`. New `generateAddColumnSql` export from
`@forge-cms/db`. Introspection uses `PRAGMA table_info`, supported by SQLite/libsql/D1 alike. This is
additive only — dropping or retyping columns for fields removed from a definition is out of scope by
design; orphan columns are left alone rather than destroyed.
