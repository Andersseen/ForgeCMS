# @forge-cms/admin

## 0.2.0

### Minor Changes

- 7ec5e67: feat: embeddable content-admin orchestration — collections index, workspace, document editor (spec 052)
  - **`@forge-cms/admin`** gains a content-CRUD orchestration layer on top of the existing
    presentational components: `ForgeCollectionsIndexComponent` (every visible collection with a real
    document count and a link into its workspace), `ForgeCollectionWorkspaceComponent` (owns search,
    sort, status filter, and pagination query state, driving the existing `ForgeCollectionListComponent`
    via `collectionResource()`), `ForgeDocumentEditorComponent` (create/edit via `documentResource()`,
    validation-error mapping, and an unsaved-changes guard exposed as
    `canDeactivateForgeDocumentEditor`), `ForgeConfirmDialogComponent` (a reusable "are you sure?"
    overlay for delete), and `forgeAdminContentRoutes()` (the `collections`/`collections/:collection`
    route subtree, with the create/edit editor rendered as an overlay through the workspace's own
    `<router-outlet>`). `ForgeCollectionFormComponent` gained a `dirtyChange` output.
    `ForgeCollectionListComponent` now shows a title column (driven by a collection's `useAsTitle`)
    instead of always leading with a raw id, and its edit/delete icon buttons gained accessible names.
    None of the existing low-level components changed their own public signatures.
  - **`@forge-cms/core`**: `CollectionDefinition` gains an optional, purely additive
    `admin?: { label?, description?, useAsTitle?, defaultColumns? }` — presentational hints only, never
    validated against document data, never affecting the generated DB schema.
  - **`@forge-cms/runtime`**: `describeCollection` passes `admin.*` through to the client-facing
    `CollectionDescription` (preferring it over the existing slug-humanizing fallback).
  - **`@forge-cms/angular`**: `CollectionMeta` gains `useAsTitle`/`defaultColumns`; `CmsApiService`
    gains `setDocumentStatus()`, a thin convenience wrapper over `updateDocument` for a `drafts: true`
    document's `_status`.

  `apps/www` dogfoods the new layer (`collections.page.ts`/`collection-detail.page.ts` deleted in
  favor of `forgeAdminContentRoutes()`); `apps/demo-aesthetics` is unaffected (all changes are
  additive) and was not migrated. See
  [docs/specs/052-embeddable-content-admin.md](../docs/specs/052-embeddable-content-admin.md).

### Patch Changes

- Updated dependencies [7ec5e67]
  - @forge-cms/angular@0.2.0

## 0.1.2

### Patch Changes

- @forge-cms/angular@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [d63d93f]
  - @forge-cms/angular@0.1.1

## 0.1.0

### Patch Changes

- @forge-cms/angular@0.1.0

## 0.0.2

### Patch Changes

- @forge-cms/angular@0.0.2

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
