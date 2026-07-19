# @forge-cms/db

## 0.1.0

### Minor Changes

- 2b5d6da: Add `count(collection)` to the `DatabaseAdapter` contract so callers can get record counts without fetching every row.
- 83f3b66: Normalize all package versions to 0.1.0 before the first npm publish.

### Patch Changes

- Updated dependencies [83f3b66]
  - @forge-cms/core@0.1.0

## 0.0.1

### Patch Changes

- 44956ef: Fix `generateCreateTableSql` to emit single-line SQL. Cloudflare D1's real `exec()` splits its input on `\n` to detect multiple statements, so the previous pretty-printed multi-line `CREATE TABLE` broke with `SQLITE_ERROR: incomplete input` against a real D1 binding — invisible in unit tests since they only exercise a mocked D1 adapter, not real SQLite. Caught by verifying spec 005 against a real local D1 binding.
