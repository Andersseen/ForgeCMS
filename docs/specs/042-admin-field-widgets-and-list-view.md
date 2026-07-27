# 042 — Make the admin usable by someone who is not a developer

- **Status:** in-progress
- **Author:** agent draft (approved by the maintainer: "implement them now")
- **Date:** 2026-07-27
- **Branch:** `feature/demo-aesthetics-app`
- **Affected packages:** `@forge-cms/admin`, `@forge-cms/angular` (metadata only), `@forge-cms/runtime`
  (`describeCollection`)

## Context / Why

Screenshotting the demo's `/admin/collections/services` made the gap concrete: the `description`
column read `[object Object], [object Object]`, `category` showed a raw UUID, the draft treatment
looked identical to the published ones, and there was no way to publish anything without editing
JSON. Findings 7, 16, 17 and 20 in [DEMO-FINDINGS.md](../DEMO-FINDINGS.md), plus roadmap items 032
and 033.

Spec 041 gave the client the queries this needs (filters, sorting, pagination, draft visibility,
uploads), so the UI work is now unblocked.

## Goal

An editor can find a document, tell whether it is live, publish it, pick a related document by name,
pick or upload an image, and write prose — without seeing a UUID or a JSON tree.

## Non-goals

- A WYSIWYG richtext editor with inline marks. The block editor here adds **no runtime dependency**;
  a real editor belongs in an opt-in package.
- Saved filters, bulk actions, configurable columns, drag-to-reorder (rest of roadmap 033).
- Live preview, conditional fields (034/035).
- Versioning UI — there are no versions to show yet (roadmap 024).

## Design

### Metadata

`describeCollection` now reports `drafts` and `upload`, and derives readable labels
(`service_categories` → `Service categories`, `durationMinutes` → `Duration minutes`) instead of
echoing the slug. `CollectionMeta` in `@forge-cms/angular` mirrors both flags.

### Cells (`cell-value.ts`)

```ts
export type CellView =
  | { kind: 'text'; text: string }
  | { kind: 'muted'; text: string }
  | { kind: 'image'; url: string; text: string }
  | { kind: 'count'; text: string };

export function toCellView(field: FieldMeta, value: unknown): CellView;
```

`richtext` → flattened prose, `upload` → thumbnail when populated, `relation` → the document's label
(`title`/`name`/`filename`/…, via `documentLabel`), `group`/`array`/`blocks` → a count chip.

### List (`ForgeCollectionListComponent`)

New inputs `meta` (from `listDocuments`) and `sort`; new outputs `sortChange`, `pageChange`,
`statusChange`. A `drafts: true` collection gets a status badge column and a publish/unpublish
button. The component stays presentational: the caller owns the query and re-fetches.

### Field widgets

- `ForgeRelationPickerComponent` — searches the target collection server-side. It reads the target's
  schema, picks its first `text`/`slug`/`email` field and queries `?<field>[contains]=<term>`;
  selections render as chips with real labels. Falls back to client-side filtering of the first page
  when the target has no text field.
- `ForgeUploadPickerComponent` — preview, upload (`CmsApiService.uploadFile`), and a library grid.
- `ForgeRichTextEditorComponent` — edits the node tree as a list of typed text blocks
  (paragraph/heading/quote) with add, remove and reorder. Any document it cannot represent falls back
  to the JSON textarea rather than being flattened.

`ForgeFieldControlComponent` dispatches to all three.

### Navigation

`ForgeAdminConfig.nav?: ForgeAdminNavGroup[]`, defaulting to `DEFAULT_ADMIN_NAV` (today's fixed
list), with `adminOnly` per item. An app can now put "Bookings" first and drop pages it does not have.

## Implementation plan

- [x] `describeCollection` reports `drafts`/`upload` and humanises labels; `CollectionMeta` mirrors it
- [x] `document-label.ts` + `cell-value.ts` (+ tests)
- [x] list: typed cells, status column, publish/unpublish, sorting, pagination
- [x] relation picker, upload picker, richtext editor; wired into the field control
- [x] config-driven sidebar nav
- [x] demo app consumes all of it
- [x] changeset

## Test plan

- Unit: `toCellView` per field kind, `documentLabel`/`documentImageUrl`/`richTextToPlainText`.
- Manual (real browser, `apps/demo-aesthetics`): the services list shows treatment names, a category
  label, an image thumbnail and a Draft badge; publishing from the list makes the draft appear on the
  public site; the relation picker finds a category by typing; the upload picker previews and uploads;
  the journal body edits as paragraphs.
- Gates green.

## Acceptance criteria

1. No cell in the demo's admin renders `[object Object]` or a bare UUID.
2. A `drafts: true` collection shows a status badge and can be published from the list.
3. A relation is chosen by searching for a name.
4. An image can be uploaded from the document form and is previewed.
5. Richtext edits as text blocks.
6. The demo's sidebar shows its own navigation (Bookings first), not the package default.
7. Gates green.

## Open questions

None.

## Outcome

Shipped as specified.
