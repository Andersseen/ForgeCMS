# @forge-cms/admin

## 0.2.0

### Minor Changes

- 1a9dec6: Refactor collection metadata: remove redundant `CollectionMeta.fields` and add `relation` metadata to `FieldMeta`. The admin form now renders `relation` fields and uses a native select for `select` fields.
- 83f3b66: Normalize all package versions to 0.1.0 before the first npm publish.

### Patch Changes

- Updated dependencies [1a9dec6]
- Updated dependencies [83f3b66]
  - @forge-cms/angular@0.2.0

## 0.1.0

### Minor Changes

- `ForgeAdminLayoutComponent`, `ForgeCollectionListComponent`, and `ForgeCollectionFormComponent` are now real components (moved from `apps/www`'s demo), not placeholders — real Angular admin layout (sidebar, breadcrumbs, theme toggle, auth-aware login/logout link), a schema-driven document list, and a schema-driven create/edit form. Also exports `PageHeaderComponent`/`LoadingStateComponent`/`ErrorStateComponent`/`EmptyStateComponent`. New peer dependencies: `@voltui/components`, `lumen-icons`, `rxjs`. The package now builds with `ngc` (Angular's partial-compilation mode) instead of plain `tsc`, required for its components to be statically analyzable by a consuming app's AOT build.

### Patch Changes

- Updated dependencies
- Updated dependencies [fa38e92]
- Updated dependencies [fa38e92]
- Updated dependencies
  - @forge-cms/angular@0.1.0
