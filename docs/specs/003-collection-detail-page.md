# 003 — Collection detail page (browse documents)

- **Status:** done
- **Author:** agent draft
- **Date:** 2026-07-07
- **Branch:** main
- **Affected packages/apps:** @forge-cms/angular, apps/www

## Context / Why

PLAN.md P1-2. `/admin/collections` lists collections as cards but there is no per-collection page and
no `routerLink` into one — clicking a collection goes nowhere. This is the first half of the "browse
→ create/edit/delete" demo flow (P1-3 is the second half).

Investigated: `GET /api/v1/collections` (`apps/www/src/server/routes/api/v1/collections.get.ts`)
today returns only field **names** (`fields: string[]`, via `Object.keys(c.fields)`), not field kinds
or options. A schema-driven document table needs to know each field's `kind` (to format/label
columns) — this is missing today and both this spec and 004 need it, so it's added once here.

## Goal

From `/admin/collections`, clicking a collection navigates to `/admin/collections/:slug`, which lists
that collection's documents in a table with columns derived from its field definitions, plus
loading/error/empty states.

## Non-goals

- Create/edit/delete document actions (row actions may be visually present but wired in 004).
- Pagination UI beyond what the existing `limit`/`offset` API params support (a "Load more" or simple
  page-size cap is enough; no full pagination component).
- Relation-field population (show the raw id/ids for `relation` fields, same as today's create/edit
  plan in P1-3).
- Sorting/filtering the table.

## Design

### API: expose field kind/options (additive, non-breaking)

Extend `GET /api/v1/collections`'s per-collection object with a new `fieldDefinitions` array,
**alongside** the existing `fields: string[]` (unchanged, so `collections.page.ts`'s existing card
view keeps working untouched):

```ts
// apps/www/src/server/routes/api/v1/collections.get.ts
interface FieldMeta {
  name: string;
  kind: FieldKind; // from @forge-cms/core
  label: string; // options.label ?? name
  required: boolean;
  options?: string[]; // only present for kind === 'select'
}
```

```ts
const collections = serverRuntime.getCollections().map((c) => ({
  slug: c.slug,
  name: c.slug.charAt(0).toUpperCase() + c.slug.slice(1),
  description: `Content collection for ${c.slug}`,
  fields: Object.keys(c.fields),
  fieldDefinitions: Object.entries(c.fields).map(([name, field]) => ({
    name,
    kind: field.kind,
    label: field.options.label ?? name,
    required: field.options.required ?? false,
    ...(field.kind === 'select' && { options: (field.options as SelectFieldOptions).options })
  }))
}));
```

### `@forge-cms/angular`: extend `CollectionMeta`, add `getCollection`

```ts
// packages/angular/src/index.ts
export interface FieldMeta {
  name: string;
  kind: string; // kept as string (not importing @forge-cms/core into the client SDK) — non-goal to add that dependency here
  label: string;
  required: boolean;
  options?: string[];
}

export interface CollectionMeta {
  slug: string;
  name: string;
  description: string;
  fields: string[];
  fieldDefinitions: FieldMeta[]; // new
}
```

`CmsApiService.getCollections()` return type picks this up automatically (no method signature change).
Add a convenience lookup, since the detail page needs a single collection's metadata by slug and
re-fetching the whole list is wasteful for repeated navigations — but per Non-goals/keep-it-small,
just filter client-side from `getCollections()` (already fetched by the parent collections page); no
new HTTP endpoint needed. **Decision**: the detail page calls `getCollections()` itself and finds its
slug — one extra small request, avoids adding a `getCollection(slug)` method/endpoint for this spec's
scope.

### Angular route

`apps/www/src/app/app.routes.ts`, inside the `admin` children, add:

```ts
{
  path: 'collections/:slug',
  loadComponent: () =>
    import('./pages/admin/collections/collection-detail.page').then((m) => m.CollectionDetailPage)
}
```

(Static path `collections` must stay before `collections/:slug` is irrelevant here since Angular
matches by full path per route, not prefix — no ordering hazard.)

### `CollectionDetailPage` component

New file `apps/www/src/app/pages/admin/collections/collection-detail.page.ts`, same conventions as
`collections.page.ts` (standalone, `OnPush`, signals, `inject(ActivatedRoute)` for `:slug`,
`inject(CmsApiService)`).

- On init: read `slug` from `ActivatedRoute.snapshot.paramMap`, call `getCollections()` to find this
  collection's `CollectionMeta` (404-style "Collection not found" `forge-error-state` if absent), then
  call `getDocuments(slug)`.
- Table: reuse `@voltui/components`'s `VoltTable` family. **Divergence found during implementation**:
  the installed `@voltui/components@0.1.0` didn't export any Table components at all (nor
  `VoltDatePicker`/`VoltDrawer`, needed by spec 004) — those only exist from `0.6.0` onward. The user
  bumped `apps/www`'s dependency to `^0.6.0` (plus added `lumen-icons`, `quartz-headless`,
  `angular-movement` as new available libraries) mid-implementation; `pnpm install` picked up the real
  `VoltTable`/`VoltTableRow`/etc. components as designed. Used `lumen-icons`' `LmnArrowLeftIcon` for
  the new "back to collections" affordance (not present in the local hand-rolled icon set). Columns =
  `fieldDefinitions` (capped to the first 6, to avoid unreadable tables for wide collections).
- Per-kind cell formatting: `boolean` → check/x icon or "Yes"/"No"; `date` → localized date string;
  `json`/`relation` → raw value stringified (`JSON.stringify` for objects/arrays, the id/ids as-is for
  relation); everything else → the raw string/number value.
- States: `forge-loading-state` while fetching, `forge-error-state` on fetch failure (with retry),
  `forge-empty-state` (existing local component) when `documents().length === 0`.
- Page header (`forge-page-header`) shows the collection's `name` as title, `description` as subtitle,
  a "Back to collections" affordance (routerLink to `/admin/collections`).

### Wire the navigation

In `collections.page.ts`'s card template, wrap the card (or add `routerLink` to the existing "eye"
view button) with `[routerLink]="['/admin/collections', col.slug]"`.

## Implementation plan

- [x] `apps/www/src/server/routes/api/v1/collections.get.ts`: add `fieldDefinitions` (Design §API)
- [x] `packages/angular/src/index.ts`: add `FieldMeta`, extend `CollectionMeta` (Design §angular)
- [x] Changeset (patch, `@forge-cms/angular`)
- [x] Bumped `apps/www`'s `@voltui/components` to `^0.6.0` + added `lumen-icons`, `quartz-headless`,
      `angular-movement` (user-directed stack update, needed for Table/DatePicker/Drawer components)
- [x] `apps/www/src/app/app.routes.ts`: add `collections/:slug` route
- [x] New `collection-detail.page.ts` (Design §component)
- [x] `collections.page.ts`: add `routerLink` to navigate into the detail page
- [x] Verified via `pnpm dev:www`: `GET /api/v1/collections` includes `fieldDefinitions`;
      `/admin/collections/posts` route resolves (200, SPA shell). **Not visually verified in a real
      browser** (no browser automation available in this session) — the rendered table/states should
      be eyeballed before considering this fully done.
- [x] Update STATE.md (`apps/www` row: detail page exists now)
- [x] Full gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

## Test plan

- No new unit-testable logic beyond the API route's field-mapping (small enough to eyeball, but add
  one `apps/www` test if there's precedent — check `apps/www/src/app/landing-data.test.ts` for the
  existing testing pattern in this app; mirror it if reasonable).
- Manual: `pnpm dev:www`, navigate `/admin/collections` → click `posts` → table shows the seeded post
  with correct column values; click a collection with zero seeded docs (e.g. `categories`) → empty
  state; temporarily break the API (e.g. stop dev server mid-load) → error state with retry.

## Acceptance criteria

1. Clicking any collection card on `/admin/collections` navigates to `/admin/collections/:slug`.
2. The detail page shows a table of that collection's documents with columns matching its field
   definitions, using seeded local-dev data.
3. Loading, error (with retry), and empty states all render correctly.
4. `GET /api/v1/collections` response still has today's `fields: string[]` unchanged, plus the new
   `fieldDefinitions` array — no existing consumer breaks.
5. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.

## Open questions

None — ready for approval as written.

## Outcome

Implemented as designed, with one dependency-version divergence: `@voltui/components@0.1.0` (the
version installed at spec-drafting time) had no Table/DatePicker/Drawer exports at all, discovered
when `tsc` failed on the new component. The user bumped `apps/www` to `@voltui/components@^0.6.0` and
added `lumen-icons`/`quartz-headless`/`angular-movement` as newly-available sibling libraries;
`pnpm install` resolved the real components and the original Design held without further changes.
Full quality gates green. Not yet visually verified in a real browser (no browser automation tool in
this session) — recommend a manual pass in `pnpm dev:www` before demoing.
