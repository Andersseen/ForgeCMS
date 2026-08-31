---
'@forge-cms/core': minor
'@forge-cms/runtime': minor
'@forge-cms/angular': minor
'@forge-cms/admin': minor
---

feat: embeddable content-admin orchestration — collections index, workspace, document editor (spec 052)

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
