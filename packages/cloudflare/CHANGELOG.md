# @forge-cms/cloudflare

## 0.1.0

### Minor Changes

- 2b5d6da: Add `count(collection)` to the `DatabaseAdapter` contract so callers can get record counts without fetching every row.
- 83f3b66: Normalize all package versions to 0.1.0 before the first npm publish.

### Patch Changes

- 27c202c: Remove unnecessary `@forge-cms/runtime` dependency from cloudflare package.
- ed933dc: Fix D1 `findMany` filters by coercing boolean/relation values with `toDbValue` before binding them to SQLite parameters.
- Updated dependencies [2b5d6da]
- Updated dependencies [83f3b66]
  - @forge-cms/db@0.1.0
  - @forge-cms/core@0.1.0

## 0.0.1

### Patch Changes

- Updated dependencies [3029071]
- Updated dependencies [44956ef]
  - @forge-cms/runtime@0.0.1
  - @forge-cms/db@0.0.1
