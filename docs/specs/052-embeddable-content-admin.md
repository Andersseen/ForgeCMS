# 052 — Embeddable Content Admin

- **Status:** done
- **Author:** agent draft (approved by the maintainer: "dale con desarrollo del plan")
- **Date:** 2026-08-31
- **Branch:** `feature/embeddable-content-admin`
- **Affected packages/apps:** `@forge-cms/admin`, `@forge-cms/angular`, `@forge-cms/core`,
  `@forge-cms/runtime` (metadata passthrough only), `apps/www`, `apps/demo-aesthetics`

## Context / Why

Specs 049–051 finished the runtime/adapter foundation (auth hardening, query parity across
InMemory/libSQL/D1, real Cloudflare Workers/D1/R2 integration). `@forge-cms/admin` already ships
real presentational building blocks (`ForgeAdminLayoutComponent`, `ForgeCollectionListComponent`,
`ForgeCollectionFormComponent`, `ForgeFieldControlComponent`, field widgets, state components) and
`@forge-cms/angular` already ships a full `CmsApiService` plus signal-based `collectionResource`/
`documentResource` helpers — but nothing wires them together. Every consuming app still hand-rolls
the orchestration: query state, pagination, sort, create/update/delete flow, delete confirmation,
and document titling.

The audit for this spec confirms the duplication is real and actively diverging:
`apps/www/src/app/pages/admin/collections/collection-detail.page.ts` (197 lines) is the canonical
example — it manually manages loading/error/form-mode signals, calls `getDocuments()` with **no**
pagination/sort/status options even though `CmsApiService` supports them, branches create vs.
update by hand, maps `ApiValidationError` to field errors by hand, and confirms deletes with a bare
`window.confirm(...)`. `apps/demo-aesthetics/src/app/pages/admin/collection-detail.page.ts` is an
independent near-clone that has since drifted ahead (it wires sort/page/status, `apps/www`'s copy
still doesn't) — proof that without a shared layer, every consumer reimplements and re-diverges.
`ForgeCollectionListComponent` already emits `sortChange`/`pageChange`/`statusChange` and accepts
`[meta]`/`[sort]`; nothing currently drives them from real query state. `collectionResource`/
`documentResource` (`packages/angular/src/resources.ts`) already exist and are unused by any admin
orchestration.

Consumer duplication audit, classified per the request's taxonomy:

| Area                                                                         | apps/www location                                                         | Classification                                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Collection metadata fetch, doc list fetch (no pagination/sort/status wired)  | `collection-detail.page.ts:102-130`                                       | QUERY STATE + CRUD GLUE                                                             |
| Create/edit form-mode toggling                                               | `collection-detail.page.ts:132-148`                                       | CRUD GLUE                                                                           |
| Save: create-vs-update branch, validation-error mapping, auth-error redirect | `collection-detail.page.ts:150-177`                                       | CRUD GLUE                                                                           |
| Delete: `window.confirm` + delete + reload                                   | `collection-detail.page.ts:179-196`                                       | CRUD GLUE (no confirm UX)                                                           |
| Collections list + N+1 count-per-collection                                  | `collections.page.ts:215-249`                                             | DATA ORCHESTRATION                                                                  |
| Document title (raw id in list rows)                                         | `packages/admin/src/document-label.ts` (heuristic only, no schema config) | SCHEMA LOOKUP                                                                       |
| Search box, filter buttons                                                   | `admin/components/search-toolbar/*`, `collections.page.ts:86-91`          | present but **not wired** (dead UI)                                                 |
| Dashboard aggregation, raw `/api/status` fetch, icon maps                    | `dashboard.page.ts`                                                       | APP-SPECIFIC — no change                                                            |
| Users CRUD (own create/edit/delete/confirm)                                  | `users.page.ts`                                                           | APP-SPECIFIC — explicitly out of scope (non-goal)                                   |
| Settings, API keys                                                           | `settings.page.ts`, `api.page.ts`                                         | APP-SPECIFIC — no change                                                            |
| Media library                                                                | `media.page.ts`                                                           | APP-SPECIFIC (buttons are stubs) — no change beyond what content forms already need |

## Goal

A consumer can render `forge-collections-index` + mount `forgeAdminContentRoutes()` under their own
`/admin` layout and get a working list → search/filter → sort → paginate → create → edit →
publish/draft → delete workflow for every declared collection, without writing per-collection
query, CRUD, or delete-confirmation glue.

## Non-goals

- Users, API-key management, Settings, full Media Library, dashboard analytics — stay app-specific,
  untouched by this spec (`apps/www`'s `users.page.ts`/`settings.page.ts`/`api.page.ts`/
  `dashboard.page.ts`/`media.page.ts` are not migrated or redesigned).
- An Analog-specific integration package (routing stays plain Angular `Routes`).
- Saved filters, bulk actions, workflow approvals, scheduled publishing, versioning UI.
- A full-text search backend — search is a `contains` query against one configured/detected field.
- Rewriting `ForgeCollectionFormComponent`'s field rendering, `ForgeFieldControlComponent`, or any
  existing field widget (relation/upload/richtext) — the new layer orchestrates them, doesn't
  replace them.
- Replacing `window.confirm` everywhere — only the new workspace's delete flow gets the styled
  confirmation; `users.page.ts`'s existing `window.confirm` is untouched (out of scope).
- Localization redesign — the editor passes `locales` through to the existing form unchanged.

## Design

### 1. `@forge-cms/core` — optional admin metadata on `defineCollection`

```ts
export interface CollectionAdminOptions {
  label?: string;
  description?: string;
  /** Field name whose value is used as the document's display title. */
  useAsTitle?: string;
  /** Field names to show as list columns; presentational hint only, not enforced. */
  defaultColumns?: string[];
}
```

Added as an optional `admin?: CollectionAdminOptions` property on `CollectionDefinition`. Purely
additive metadata — never validated against document data, never affects the DB schema generator.

### 2. `@forge-cms/runtime` — `describeCollection` passthrough

`describeCollection` already derives a humanized `name`/`description` when the definition doesn't
set one. It gains: prefer `admin.label`/`admin.description` when present (existing humanization
stays the fallback), and passes `admin.useAsTitle`/`admin.defaultColumns` straight through onto the
returned metadata (both optional, omitted when absent).

### 3. `@forge-cms/angular` — metadata + one convenience method

`CollectionMeta` (`packages/angular/src/types.ts`) gains two optional flat fields, matching its
existing flat `name`/`description`/`drafts`/`upload` style:

```ts
export interface CollectionMeta {
  // ...existing fields unchanged...
  useAsTitle?: string;
  defaultColumns?: string[];
}
```

`CmsApiService` gains one thin convenience wrapper (no new HTTP surface — it's `updateDocument`
under the hood, added because every consumer of draft/publish otherwise repeats the same
`{ _status: ... }` literal):

```ts
setDocumentStatus<T = Record<string, unknown>>(
  collection: string,
  id: string,
  status: 'draft' | 'published'
): Promise<T>
```

No other `@forge-cms/angular` changes. `collectionResource`/`documentResource` (already exported)
become the data layer the new admin orchestration is built on.

### 4. `@forge-cms/admin` — new public exports

Layered per the request's architecture: primitives (existing, unchanged) → content orchestration
(new) → route helper (new).

```ts
// collections-index.component.ts
@Component({ selector: 'forge-collections-index', ... })
export class ForgeCollectionsIndexComponent {
  config = input<ForgeAdminConfig | null>(null);
}
```

Fetches `CmsApiService.getCollections()`, filtered to `config()?.collections` slugs when the host
restricts visibility (reusing the existing `ForgeAdminConfig.collections` field — no new config
concept). For each visible collection, fetches a cheap count via
`listDocuments(slug, { limit: 1 })` → `meta.totalDocs` (not a full document fetch — bounded to one
request per visible collection, same shape as today's dashboard/collections pages but without
downloading document bodies). Renders label/description/count, links to `./<slug>` (router-relative
— no hardcoded `/admin` prefix, so it works at whatever path the host mounts it). Uses
`LoadingStateComponent`/`ErrorStateComponent`/`EmptyStateComponent`.

```ts
// collection-workspace.component.ts
@Component({ selector: 'forge-collection-workspace', ... })
export class ForgeCollectionWorkspaceComponent {
  collection = input<string | undefined>(undefined); // falls back to the `:collection` route param
}
```

Owns: collection metadata lookup (`getCollections()` + find by slug), query state
(`page`/`sort`/`status`/debounced `search` signals), and drives `collectionResource()` from those
signals. Renders a search box only when the collection has a `useAsTitle` field or a detectable
`text`/`email`/`slug`-kind field (otherwise hidden, never a broken query); renders an
All/Published/Draft segmented control only when `meta.drafts` is true. Passes `[meta]`/`[sort]` and
handles `(sortChange)`/`(pageChange)`/`(statusChange)`/`(create)`/`(edit)`/`(delete)` from the
existing `ForgeCollectionListComponent` unchanged. `(delete)` opens `ForgeConfirmDialogComponent`;
on confirm, `deleteDocument` then reload, stepping back one page if the deleted row was the last on
a page beyond page 1. `(statusChange)` calls the new `setDocumentStatus`. `(create)`/`(edit)`
navigate to child routes (`new` / `:id`) rendered through this component's own `<router-outlet>` as
an overlay on top of the still-mounted list (reusing `ForgeCollectionFormComponent`'s existing
modal chrome — no new overlay mechanism). A small route-scoped injectable (not publicly exported)
lets the child editor route tell the workspace to refetch after a save; this stays an internal
implementation detail, not a new public API.

```ts
// document-editor.component.ts
@Component({ selector: 'forge-document-editor', ... })
export class ForgeDocumentEditorComponent {
  collection = input<string | undefined>(undefined); // falls back to `:collection` route param
  documentId = input<string | undefined>(undefined);  // falls back to `:id` route param; absent = create mode
}
```

Loads field metadata the same way the workspace does; loads the existing document via
`documentResource()` when `documentId` is set. Renders `ForgeCollectionFormComponent` unchanged,
wires `(save)` to `createDocument`/`updateDocument`, maps `ApiValidationError` to per-field errors,
navigates back to the parent workspace route on success. Tracks a `dirty` signal (form value changed
since load) and exposes `canDeactivate(): boolean` — if dirty, `window.confirm('You have unsaved
changes. Leave without saving?')`. The package exports a functional guard,
`canDeactivateForgeDocumentEditor: CanDeactivateFn<ForgeDocumentEditorComponent>`, that calls it;
`forgeAdminContentRoutes()` attaches it automatically so hosts get the guard for free.

```ts
// confirm-dialog.component.ts
@Component({ selector: 'forge-confirm-dialog', ... })
export class ForgeConfirmDialogComponent {
  open = input(false);
  title = input.required<string>();
  message = input<string>('This action cannot be undone.');
  confirmLabel = input('Delete');
  cancelLabel = input('Cancel');
  confirm = output<void>();
  cancel = output<void>();
}
```

Same hand-rolled overlay chrome as `ForgeCollectionFormComponent` (VoltDialog's composition pattern
is not used there either, for the reason already documented in that file). Exported as a low-level
primitive — useful to hosts independently of the workspace.

```ts
// content-routes.ts
export function forgeAdminContentRoutes(): Routes;
```

Returns:

```ts
[
  { path: 'collections', component: ForgeCollectionsIndexComponent },
  {
    path: 'collections/:collection',
    component: ForgeCollectionWorkspaceComponent,
    children: [
      {
        path: 'new',
        component: ForgeDocumentEditorComponent,
        canDeactivate: [canDeactivateForgeDocumentEditor]
      },
      {
        path: ':id',
        component: ForgeDocumentEditorComponent,
        canDeactivate: [canDeactivateForgeDocumentEditor]
      }
    ]
  }
];
```

No `basePath` parameter — Angular's own route nesting already supplies that (a host does
`{ path: 'admin', component: ForgeAdminLayoutComponent, children: [...forgeAdminContentRoutes(), ...appSpecificRoutes] }`,
matching how `ForgeAdminLayoutComponent` is already mounted today). This does not replace or wrap
the layout route — dashboard/media/users/settings/api stay whatever the host already has.

`document-label.ts`'s `documentLabel` gains an optional second parameter:
`documentLabel(doc: unknown, useAsTitle?: string)` — when given and the field holds a non-empty
string, it wins over the existing heuristic field list. `ForgeCollectionListComponent`'s existing
row-title rendering (already calling `documentLabel`) passes `collection().useAsTitle` through — a
one-line change to an existing call site, not a new component.

### 5. Error UX

The workspace/editor normalize `CmsApiService`'s existing typed errors into plain messages using
the state components already in the package — no new error contract:

| Error                         | Presentation                                                                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ApiValidationError`          | Per-field messages under each `ForgeFieldControl`, existing pattern                                                                                               |
| `ApiAuthError` (401/403)      | `ErrorStateComponent` with a clear "sign in again" / "not permitted" message, no redirect logic duplicated (host's existing auth guard already handles redirects) |
| 404 (`getDocument` rejection) | `ErrorStateComponent`: "Document not found"                                                                                                                       |
| Network/500                   | `ErrorStateComponent` with retry, generic message — never the raw error/JSON body                                                                                 |

### 6. apps/www dogfooding

`apps/www/src/app/app.routes.ts` replaces its `collections`/`collections/:slug` entries
(`collections.page.ts`, `collection-detail.page.ts`) with `...forgeAdminContentRoutes()`.
`collections.page.ts` and `collection-detail.page.ts` are deleted. `dashboard.page.ts`,
`media.page.ts`, `users.page.ts`, `settings.page.ts`, `api.page.ts` are untouched.
`apps/www`'s seed `posts` collection (`apps/www/src/server/api/runtime.ts:25-37`) gains
`drafts: true` and `admin: { useAsTitle: 'title' }` so the dogfood + E2E has a real draft/publish

- titled-document collection to exercise (currently no seed collection has `drafts: true`).

### 7. apps/demo-aesthetics

No required migration (non-goal explicitly allows this). Verify the package changes are additive
and demo-aesthetics still builds/passes its existing tests unchanged. If time allows within the
implementation step, migrate demo-aesthetics's `collections.page.ts`/`collection-detail.page.ts` to
`forgeAdminContentRoutes()` too, since the audit shows it's a near-duplicate of `apps/www`'s old
version — this is optional dogfood-strength proof, not a blocking acceptance item.

## Implementation plan

- [x] `packages/core`: `CollectionAdminOptions` + `admin?` on `CollectionDefinition`; unit test
- [x] `packages/runtime`: `describeCollection` passthrough of `admin.*`; unit test
- [x] `packages/angular`: `CollectionMeta.useAsTitle`/`defaultColumns`; `CmsApiService.setDocumentStatus`; unit tests
- [x] `packages/admin`: `documentLabel(doc, useAsTitle?)` change + call-site update in
      `collection-list.component.ts`; unit test
- [x] `packages/admin`: `ForgeConfirmDialogComponent` + unit test
- [x] `packages/admin`: `ForgeCollectionsIndexComponent` (visibility filtering, count fetch,
      loading/empty/error) + unit test
- [x] `packages/admin`: `ForgeCollectionWorkspaceComponent` (query state: search debounce+reset,
      sort, pagination, status filter; delete confirm + page-back-when-empty; publish/unpublish;
      create/edit navigation) + unit tests
- [x] `packages/admin`: `ForgeDocumentEditorComponent` (create vs. edit load, validation-error
      mapping, dirty-state guard) + `canDeactivateForgeDocumentEditor` + unit tests
- [x] `packages/admin`: `content-routes.ts` (`forgeAdminContentRoutes`) + exports in `index.ts`
- [x] `apps/www`: seed `posts` gains `drafts: true` + `admin.useAsTitle`; `app.routes.ts` uses
      `forgeAdminContentRoutes()`; delete `collections.page.ts`/`collection-detail.page.ts`
- [x] `apps/demo-aesthetics`: regression check (build + existing tests green); not migrated (allowed
      by non-goals — its own `collections.page.ts`/`collection-detail.page.ts` are untouched)
- [x] Playwright E2E in `apps/www`: login → collections index → open Posts → create → appears in
      list → edit → save → publish → filter drafts/published → delete → disappears (plus an
      unsaved-changes-prompt case and an anonymous-read-only case)
- [x] Packed-package + external Angular consumer compile fixture importing
      `ForgeCollectionWorkspaceComponent`, `ForgeDocumentEditorComponent`, `ForgeCollectionsIndexComponent`,
      `ForgeConfirmDialogComponent`, `forgeAdminContentRoutes` from `@forge-cms/admin`'s public entry
      only — extended `scripts/verify-release.mjs`'s existing `verifyAngularConsumer` (run via
      `pnpm release:verify`, already wired into both the `checks` and `release` CI jobs)
- [x] `docs/specs/052-*.md` implementation plan ticked off; `docs/STATE.md` and `docs/ROADMAP.md`
      updated ("core content admin is embeddable"; list users/API-keys/settings/media-library-polish
      as remaining)
- [x] Changeset covering `@forge-cms/core`, `@forge-cms/runtime`, `@forge-cms/angular`,
      `@forge-cms/admin`

## Test plan

- Unit (Vitest): every item in the implementation plan's "unit test" notes above, plus
  `component/unit tests` from the request: query state, search, pagination, sort, delete
  confirmation, create/update routing, error mapping, draft status, dirty state, collection
  visibility.
- Manual (`pnpm dev:www` → `/admin/collections`): collections index shows real counts; opening
  Posts shows a searchable, sortable, paginated list with a title column (not a raw id); create,
  edit, publish/unpublish, delete (with confirmation) all work without a page having its own glue.
- E2E (`pnpm e2e:www`): the full create → list → edit → publish → filter → delete flow above.
- Gates: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:cloudflare`.
- Packed package verification + external consumer compile fixture (per existing repo tooling for
  this, extended with the three new imports).

## Acceptance criteria

1. `forge-collections-index` renders every visible collection with a real document count and a
   working link into its workspace, with zero per-collection host code.
2. `forge-collection-workspace` loads and lists documents for a given collection slug without the
   host writing fetch/pagination/sort code.
3. Sorting via the existing `ForgeCollectionListComponent` header clicks updates results without
   consumer-written handlers.
4. Pagination works end-to-end (`meta.totalPages`/`hasNextPage`/`hasPrevPage`) with no host glue.
5. Search is shown and functional for collections with a title-shaped field, and hidden otherwise
   (never issues a broken query).
6. Draft/Published/All filtering and one-click publish/unpublish work for `drafts: true`
   collections via `setDocumentStatus`.
7. Create navigates to `forge-document-editor` in create mode, validates via the existing schema,
   and on success returns to a refreshed list.
8. Edit loads the existing document into the same editor and updates on save.
9. `ApiValidationError`/`ApiAuthError`/404/network errors all render a clean message via the
   existing state components — never raw JSON/stack text.
10. Delete requires confirmation through `ForgeConfirmDialogComponent`, then refreshes the list and
    steps back a page if the deleted row was the last one on a page beyond page 1.
11. Navigating away from a dirty editor prompts before discarding changes.
12. A collection with `admin.useAsTitle` shows that field's value as the row/document title instead
    of a raw id.
13. All previously-exported low-level components (`ForgeCollectionListComponent`,
    `ForgeCollectionFormComponent`, `ForgeFieldControlComponent`, etc.) remain independently usable
    and unchanged in their own public signatures.
14. `apps/www`'s `app.routes.ts` mounts `forgeAdminContentRoutes()` for its generic collection
    routes; `collections.page.ts`/`collection-detail.page.ts` no longer exist.
15. A full Playwright E2E (`pnpm e2e:www`) proves create → list → edit → publish → filter →
    delete → disappears for a real (seed) collection.
16. External packed Angular consumer compile fixture imports
    `ForgeCollectionWorkspaceComponent`/`ForgeDocumentEditorComponent`/`forgeAdminContentRoutes`
    from `@forge-cms/admin`'s public entry and compiles.
17. `apps/demo-aesthetics` still builds and its existing tests remain green.
18. `docs/STATE.md`/`docs/ROADMAP.md` describe this as "core content admin is embeddable," not
    "complete admin," and list users/API-keys/settings/media-library-polish/bulk-actions as
    explicitly remaining.
19. `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:cloudflare`
    all green.
20. No unrelated admin/product feature (users UI, settings, media library, analytics) was touched.

## Open questions

None — ambiguous points (route shape for the create/edit overlay, unsaved-changes UX, count-fetch
strategy, `basePath` parameter) were resolved above against the existing codebase's own patterns.

## Outcome

Shipped as designed, with two real bugs found only by exercising it in a real browser (not caught by
unit tests or `tsc`): (1) `ForgeDocumentEditorComponent` read `route.paramMap` for the `:collection`
param, but that param is matched by the _parent_ `collections/:collection` route segment — Angular's
default `paramsInheritanceStrategy: 'emptyOnly'` does not merge it into a child route with its own
component, so the editor was stuck showing its loading skeleton forever until fixed to read
`route.parent?.paramMap`; (2) the workspace never wired `ForgeCollectionListComponent`'s `readOnly`
input, so an anonymous/viewer visitor would have seen live New/Edit/Delete/Publish buttons that then
401'd on click — fixed by fetching `getCurrentUser()` and gating on `canWriteContent()`, matching
what the old app-local pages did. Manual browser verification (login → collections index → open
Posts → create → title-not-a-raw-id in the list → filter Draft → publish → filter All → edit →
unsaved-changes native-confirm guard → save → delete-with-styled-confirmation → gone) passed, then
was codified into a rewritten `apps/www/e2e/admin-crud.spec.ts` (the old version asserted button
_indices_, which broke the moment `posts` gained a status column and shifted every action button one
slot right). Auditing the existing `ForgeCollectionListComponent` for this work also surfaced two
pre-existing accessibility gaps directly adjacent to the new code — its edit/delete icon buttons had
no accessible name at all — fixed with `sr-only` text; the new `ForgeConfirmDialogComponent` was
built with `role="dialog"`/`aria-modal`/`aria-labelledby` from the start.

**Correction to an earlier draft of this Outcome**: this section originally claimed no
packed-package/external-consumer verification tooling existed anywhere in this repo, and verified
the acceptance criterion with a one-off, uncommitted manual `pnpm pack`+`tsc` check instead. That
claim was wrong — a research gap, not a repo gap: `scripts/verify-release.mjs` (run via `pnpm
release:verify`) already existed, already packs every public package into real tarballs, installs
them into throwaway fixture consumers, and — in `verifyAngularConsumer` — already compiled an
`@forge-cms/admin` consumer via `ngc`; it's already wired into both the `checks` and `release` CI
jobs (`.github/workflows/ci.yml`). Once found, `verifyAngularConsumer` was properly extended (not
worked around) to also import and use `ForgeCollectionWorkspaceComponent`,
`ForgeDocumentEditorComponent`, `ForgeCollectionsIndexComponent`, and `ForgeConfirmDialogComponent`,
and to call `forgeAdminContentRoutes()` and assign its result to `Routes` — all as real Angular route
`component:` values, the exact shape a host's own routes file would use. `pnpm release:verify` run
locally, real packed tarballs, real `ngc` compilation: passed.

`apps/demo-aesthetics` was not migrated to the new layer (allowed by the non-goals) — confirmed to
still build and pass its own tests unchanged, since every package-side change here is additive.
Users/API-keys/settings/media-library admin, saved filters, bulk actions, and an Analog-specific
routing package remain explicitly out of scope, per the non-goals above.

All quality gates green: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
&& pnpm test:cloudflare`.
