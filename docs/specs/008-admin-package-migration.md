# 008 — Migrate the real admin UI (layout, document list, schema-driven form) into @forge-cms/admin

- **Status:** done
- **Author:** agent draft
- **Date:** 2026-07-08
- **Branch:** main
- **Affected packages/apps:** @forge-cms/admin, apps/www

## Context / Why

PLAN.md P2-3 / STATE.md known issue #2: `@forge-cms/admin` is a skeleton (placeholder templates, no
real behavior) that `apps/www` doesn't consume — the actual admin UI (built in specs 003/004) lives
entirely in `apps/www/src/app`. Approved as part of finishing PLAN.md in full (2026-07-08); the
peer-dependency decision (`@voltui/components`) was already recorded in PLAN.md.

## Goal

`apps/www`'s admin layout, document list, and schema-driven create/edit form are the real
`@forge-cms/admin` package components (not app-local files), and `apps/www` imports them.

## Non-goals

- `dashboard.page.ts`, `media.page.ts`, `users.page.ts`, `api.page.ts`, `settings.page.ts`, and
  `collections.page.ts` (the all-collections grid) — PLAN.md's text scopes this to "the schema-driven
  form + document list + layout" only. These stay in `apps/www` untouched.
- A config-driven/dynamic sidebar nav — the migrated layout keeps the same fixed nav items
  `apps/www` already has (Dashboard/Collections/Media/Users/API/Settings). Making the nav generate
  from `ForgeAdminConfig.collections` is a reasonable future improvement, not required here.
- Any change to the CRUD API, auth, or validation — presentational/UI migration only.

## Design

### Corrected skeleton mismatch

The existing skeleton's `ForgeCollectionListComponent`/`ForgeCollectionFormComponent` type their
`collection` input as `CollectionDefinition` (`@forge-cms/core`) — the server-side schema DSL shape.
Real browser-side code (`collection-detail.page.ts`) has only ever used `CollectionMeta`/`FieldMeta`
(`@forge-cms/angular`) — the wire shape returned by `GET /api/v1/collections`. `CollectionDefinition`
doesn't serialize over HTTP (it's not what the client ever has). This spec corrects the input types to
`CollectionMeta`/`FieldMeta` to match how data actually flows; the skeleton's original typing was never
exercised end-to-end, so this isn't a breaking change to real usage.

### Split of `collection-detail.page.ts`

`collection-detail.page.ts` today does two jobs: (1) data-fetching/state (`CmsApiService` calls,
signals for documents/loading/error/editing) and (2) rendering (the documents table + wiring the
modal form). Per the skeleton's shape (presentational, no service injection), the package gets the
**presentational half only** — apps/www keeps the "smart" page, now composed from two package
components instead of hand-rolled markup:

```ts
// @forge-cms/admin public surface (packages/admin/src/index.ts)
export class ForgeCollectionListComponent {
  collection = input.required<CollectionMeta>();
  documents = input.required<Record<string, unknown>[]>();
  create = output<void>();
  edit = output<Record<string, unknown>>();
  delete = output<Record<string, unknown>>();
}

export class ForgeCollectionFormComponent {
  fields = input.required<FieldMeta[]>();
  initialValue = input<Record<string, unknown>>({});
  fieldErrors = input<Record<string, string>>({});
  submitLabel = input('Save');
  save = output<Record<string, unknown>>();
  cancel = output<void>();
}

export class ForgeAdminLayoutComponent {
  config = input<ForgeAdminConfig>();
}
```

`apps/www/src/app/pages/admin/collections/collection-detail.page.ts` keeps its `CmsApiService`
calls/signals, and its template becomes:

```html
<forge-collection-list
  [collection]="col"
  [documents]="documents()"
  (create)="openCreate()"
  (edit)="openEdit($event)"
  (delete)="deleteDoc($event)"
/>
@if (showForm()) {
<forge-collection-form
  [fields]="col.fieldDefinitions"
  [initialValue]="editingDoc() ?? {}"
  [fieldErrors]="fieldErrors()"
  [submitLabel]="editingDoc() ? 'Save' : 'Create'"
  (save)="onSave($event)"
  (cancel)="closeForm()"
/>
}
```

`ForgeCollectionListComponent` owns the table markup (currently inline in `collection-detail.page.ts`)
plus the empty-state and the "New" button (emits `create`); `ForgeCollectionFormComponent` is
`document-form.component.ts` relocated as-is, including the 2026-07-08 fix where `formValue` is a
`computed` merging `initialValue()` with a separate edits signal (not a field-initializer snapshot —
that was the bug this session found and fixed; porting the fixed version, not the original).

### Layout

`ForgeAdminLayoutComponent` ← real content of `apps/www/src/app/layouts/admin/admin.layout.ts`
(sidebar, breadcrumbs, theme toggle, mobile trigger, login/logout link). `ThemeService` moves into
the package (`packages/admin/src/theme.service.ts`, not exported — internal to the layout; confirmed
unused anywhere else in apps/www). The login/logout link keeps checking
`localStorage.getItem('forge-auth-token')` directly (same literal key used by `apps/www`'s
`app.config.ts` and `login.page.ts`, mirroring how `ThemeService` already hardcodes its own storage
key) — no new config surface for this.

### Icons

The migrated components (list, form, layout) drop the local `apps/www` hand-rolled
`components/icons.ts` in favor of `lumen-icons` (already a used dependency, and a package shouldn't
depend on an app-internal file). Confirmed exports cover every icon needed:
`LmnPencilIcon`/`LmnPlusIcon`/`LmnTrashIcon`/`LmnChevronRightIcon`/`LmnBars3Icon`/`LmnChartBarIcon`/
`LmnSquares2x2Icon`/`LmnPhotoIcon`/`LmnUsersIcon`/`LmnCodeBracketIcon`/`LmnCogIcon`/`LmnSunIcon`/
`LmnMoonIcon`/`LmnBellIcon`/`LmnAlertCircleIcon`. `apps/www`'s local `icons.ts` stays (still used by
the non-migrated pages) — just no longer imported by the migrated components.

### Shared presentational components

`page-header`, `loading-state`, `error-state`, `empty-state` move into `packages/admin/src/components/`
(only these four — `search-toolbar`/`collection-icon`/`stat-card`/`section-header`/`settings-card` are
used exclusively by non-migrated pages and stay in `apps/www`).

### Package dependencies

`packages/admin/package.json`: add `@voltui/components` (`^0.6.0`) and `lumen-icons` (`^0.2.0`) as
both `peerDependencies` and `devDependencies`, mirroring the existing `@angular/core`/`@angular/router`
pattern.

### apps/www wiring

- `app.routes.ts`: `admin` route's `loadComponent` imports `ForgeAdminLayoutComponent` from
  `@forge-cms/admin` instead of the local file.
- Delete: `apps/www/src/app/layouts/admin/admin.layout.ts`, `apps/www/src/app/services/theme.service.ts`,
  `apps/www/src/app/pages/admin/collections/document-form.component.ts`, and the four migrated shared
  components (`page-header`, `loading-state`, `error-state`, `empty-state` dirs + their barrel entries).
- `collection-detail.page.ts` rewritten per Design above; `collections.page.ts` and the other
  non-migrated pages update their imports if they used any of the four migrated shared components
  (`collections.page.ts` uses `PageHeaderComponent`/`LoadingStateComponent`/`ErrorStateComponent`/
  `SearchToolbarComponent` — the first three now come from `@forge-cms/admin`, `SearchToolbarComponent`
  stays local).
- Add `@forge-cms/admin: workspace:*` to `apps/www/package.json` (never previously a dependency).

## Implementation plan

- [x] `packages/admin/package.json`: add `@voltui/components`/`lumen-icons`/`rxjs` peer+dev deps
- [x] `packages/admin/src/components/`: move page-header, loading-state, error-state, empty-state
      (icons switched to lumen-icons) — as flat files (`src/*.component.ts`), matching this
      package's existing convention rather than apps/www's per-component-folder layout
- [x] `packages/admin/src/theme.service.ts`: moved (internal, not exported)
- [x] `packages/admin/src/layout.component.ts`: real `ForgeAdminLayoutComponent`
- [x] `packages/admin/src/collection-list.component.ts`: real `ForgeCollectionListComponent`
      (`CollectionMeta`/`FieldMeta` typed, per Design)
- [x] `packages/admin/src/collection-form.component.ts`: real `ForgeCollectionFormComponent`
      (relocated + already-fixed `document-form.component.ts`)
- [x] `packages/admin/src/index.ts`: update exports (types + components + internal component barrel)
- [x] `apps/www`: wire `app.routes.ts`, rewrite `collection-detail.page.ts`, update
      `collections.page.ts`'s/`dashboard.page.ts`'s/`users.page.ts`'s/`media.page.ts`'s/
      `settings.page.ts`'s/`api.page.ts`'s imports (every page consuming the 4 migrated shared
      components), delete migrated files, add the `@forge-cms/admin` dependency
- [x] Changeset (minor, `@forge-cms/admin`)
- [x] `pnpm --filter www e2e` (existing spec, unmodified) green against the migrated app
- [x] Manual `pnpm dev:www` browser pass of `/admin`
- [x] Update STATE.md (`@forge-cms/admin` row: real, consumed; known issue #2 resolved)
- [x] Full gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

## Test plan

- `packages/admin`'s existing smoke-test pattern (`expect(Component).toBeDefined()`), extended to the
  new components/config shape.
- `apps/www/e2e/admin-crud.spec.ts` (P1-4) re-run unmodified — same user-facing behavior expected
  since this is an internal refactor; a pass here is the real proof the migration didn't regress
  anything user-visible.
- Manual browser pass of `/admin` (dashboard, collections list, collection detail, create/edit/delete,
  login/logout link, theme toggle).

## Acceptance criteria

1. `apps/www/src/app/layouts/admin/admin.layout.ts` no longer exists; `/admin` renders via
   `@forge-cms/admin`'s `ForgeAdminLayoutComponent`.
2. Creating, editing, and deleting a document at `/admin/collections/posts` still works exactly as
   before (verified by the unmodified e2e spec passing).
3. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.

## Open questions

None.

## Outcome

Shipped as designed, plus one significant build-tooling fix discovered only by actually running the
migrated app in a browser (unit tests and `tsc --noEmit` both stayed green through this bug — neither
exercises Angular's AOT template/import analysis): `packages/admin` built with plain `tsc`, which
leaves `@Component`-decorated classes as bare TS-decorator output with no Ivy (`ɵcmp`) definitions.
`apps/www`'s real build (`@analogjs/vite-plugin-angular`, AOT) failed at runtime with "Component
imports must be standalone components, directives, pipes, or must be NgModules — value could not be
determined statically" the moment a page importing `@forge-cms/admin` loaded — this repo had never
before had a package ship real `@Component` classes for cross-package consumption, so this path was
never exercised. Fixed by switching `packages/admin`'s build script to `ngc` (Angular's compiler CLI)
with `angularCompilerOptions.compilationMode: "partial"` — the same Ivy partial-compilation output
real published Angular libraries use (confirmed against the sibling `volt-ui` repo, which uses
`ng-packagr` with the identical `compilationMode: "partial"` setting). Verified the fix by inspecting
the compiled output for `ɵɵngDeclareComponent`-style partial declarations, then re-running the full
browser flow (login → collections → collection detail) and the unmodified e2e suite, both green.
