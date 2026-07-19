# @forge-cms/runtime

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
