---
'@forge-cms/db': patch
---

Fix `generateCreateTableSql` to emit single-line SQL. Cloudflare D1's real `exec()` splits its input on `\n` to detect multiple statements, so the previous pretty-printed multi-line `CREATE TABLE` broke with `SQLITE_ERROR: incomplete input` against a real D1 binding — invisible in unit tests since they only exercise a mocked D1 adapter, not real SQLite. Caught by verifying spec 005 against a real local D1 binding.
