# 004 — Schema-driven document form (create / edit / delete)

- **Status:** done
- **Author:** agent draft
- **Date:** 2026-07-07
- **Branch:** main
- **Affected packages/apps:** apps/www (depends on spec 003's `FieldMeta`/`fieldDefinitions`)

## Context / Why

PLAN.md P1-3 — the "wow" feature: a document form generated from the collection's field definitions,
not hand-written per collection. Depends on spec 003 (`docs/specs/003-collection-detail-page.md`)
for the `fieldDefinitions: FieldMeta[]` metadata and the `/admin/collections/:slug` page this form
attaches to. Do not start this until 003 is at least `in-progress` with `fieldDefinitions` landed.

## Goal

From the collection detail page (spec 003): "New" opens a create form, each row's "Edit" opens an
edit form, both generated from `fieldDefinitions`; submitting calls `createDocument`/`updateDocument`;
server validation errors render per-field; "Delete" removes a document with a confirm step. Full CRUD
cycle works on `posts` from the browser in local dev.

## Non-goals

- Moving anything into `@forge-cms/admin` — build directly in `apps/www` (PLAN.md's placement
  decision; migration is P2-3).
- Relation-field pickers (searchable select, etc.) — a plain text input for the raw id/ids, same as
  today's plan.
- Rich text / file upload widgets for any field kind — out of scope until those field kinds mature.
- Client-side validation beyond what's needed for a sane UX (e.g. disabling submit while empty) —
  the server is the source of truth for validation; don't duplicate `validateCollection`'s rules on
  the client.
- Optimistic UI / undo on delete.

## Design

### Field-kind → input mapping

| `FieldMeta.kind`        | Control                                                                                               | Notes                                                                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`, `email`, `slug` | `VoltInput` (`type="email"` for email)                                                                |                                                                                                                                                                 |
| `textarea`              | `VoltTextarea`                                                                                        |                                                                                                                                                                 |
| `json`                  | `VoltTextarea`                                                                                        | raw JSON as a string; parse-on-submit is a non-goal — send as-is, matching how seed data stores `json` fields as strings today (see `runtime.ts`'s `seo: '{}'`) |
| `boolean`               | `VoltSwitch`                                                                                          |                                                                                                                                                                 |
| `select`                | `VoltNativeSelect` (**changed from `VoltSelect`** — see note below), options from `FieldMeta.options` |                                                                                                                                                                 |
| `number`                | `VoltInput` `type="number"`                                                                           | coerce to `Number(value)` on submit                                                                                                                             |
| `date`                  | `VoltInput type="date"` (**not `VoltDatePicker`** — see note below)                                   | send as ISO string                                                                                                                                              |
| `relation`              | `VoltInput` (plain text)                                                                              | comma-separated ids if the field is `many`, else a single id string                                                                                             |

**Divergence found during implementation**: `VoltSelect` is a full custom listbox/popover component
(separate `VoltSelectContent`/`VoltSelectItem` composition, positioned overlay) whose exact wiring
couldn't be visually verified in this environment (no browser automation available this session).
Used `VoltNativeSelect` instead — a thin styled wrapper around a real `<select>` that just projects
`<option>` elements and is bound via a native `(change)` event — much lower risk to get right blind,
still visually consistent (same Tailwind styling as the rest of Volt). `VoltDatePicker` wasn't
attempted for the same reason; used a plain `<volt-input type="date">` as the spec already allowed.

Every field shows `FieldMeta.label`, a required-marker if `FieldMeta.required`, and a per-field error
message slot.

### Component

New `apps/www/src/app/pages/admin/collections/document-form.component.ts` (standalone,
`ChangeDetectionStrategy.OnPush`), used by the detail page (spec 003) for both create and edit:

```ts
@Component({ selector: 'forge-document-form', ... })
export class DocumentFormComponent {
  fields = input.required<FieldMeta[]>();
  initialValue = input<Record<string, unknown>>({}); // empty for create, existing doc for edit
  fieldErrors = input<Record<string, string>>({}); // keyed by field name, from server details[]
  submitLabel = input('Save');

  save = output<Record<string, unknown>>(); // parent calls createDocument/updateDocument
  cancel = output<void>();
}
```

Rendering: **divergence found during implementation** — `VoltDialog` (and `VoltDrawer`) turned out to
compose via a CDK-style trigger+`TemplateRef` pattern (`[voltDialog]="myTemplateRef"` on a trigger,
with `voltDialogOverlay`/`voltDialogContent`/`voltDialogTitle` attribute directives on plain elements
inside an `<ng-template>`), not a simple open/close-signal component. Getting this composition wrong
with no way to visually verify it would risk breaking the CRUD demo's core flow, so the modal chrome
was hand-rolled instead: a plain `fixed inset-0` Tailwind backdrop + centered `VoltCard`, with a
backdrop click (or a click anywhere outside the card) emitting `cancel`. Still uses Volt's simple leaf
components (`VoltCard`, `VoltButton`, `VoltInput`, etc.) throughout — only the compound Dialog
primitive was avoided. Opened from the detail page via `@if (showForm())`, not a separate route —
keeps the table visible underneath.

### Wiring in the collection detail page (extends spec 003's page)

- "New" button (in the page header actions) opens the form with `initialValue = {}`.
- Each table row gets an "Edit" action opening the form with `initialValue = <that row's record>`.
- On `save`: call `createDocument(slug, value)` or `updateDocument(slug, id, value)`. On success:
  close the form, refresh the document list (re-`getDocuments`). On failure: if `err instanceof
ApiValidationError`, map `err.details` (each `{ field, message, code }`) into `fieldErrors` (a
  `Record<field, message>`) and keep the form open; otherwise (unexpected/network error)
  `window.alert(...)` and keep the form open with its data intact (there is no page-level error
  state that's safe to reuse here — setting the page's `error` signal would replace the whole page,
  including the open form, with the error screen).
- Each table row gets a "Delete" action: `window.confirm(...)` then `deleteDocument(slug, id)`, then
  refresh the list. (No existing confirm-dialog pattern in this codebase to mirror, and — per the
  Dialog-composition risk noted above — `window.confirm` was the safe, verifiably-correct choice.)

### `CmsApiService` change (packages/angular) — corrected error-envelope shape

**Divergence found during implementation**: the actual write routes
(`apps/www/src/server/routes/api/v1/[collection].post.ts` and `.../[collection]/[id].put.ts`) don't
delegate to `@forge-cms/runtime`'s handlers at all — they use h3's `createError({ statusCode,
statusMessage, data })` directly. Verified against the running dev server: a validation failure
actually returns `{ error: true, statusCode, statusMessage, message, data: { errors: [{ field,
message, code }] } }`, **not** the `{ error: string, details: ValidationError[] }` shape ARCHITECTURE.md
documents as the stable envelope. (This is pre-existing behavior, not introduced here — flagged as a
new STATE.md known issue, out of scope to fix in this spec.)

```ts
export interface ApiFieldError {
  field: string;
  message: string;
  code: string;
}

export class ApiValidationError extends Error {
  constructor(
    message: string,
    readonly details: ApiFieldError[]
  ) {
    super(message);
  }
}
```

`createDocument`/`updateDocument` catch a non-ok response, try to parse `{ statusMessage, data: {
errors } }` (the real shape), and throw `ApiValidationError` when `data.errors` is present, else a
plain `Error`.

## Implementation plan

- [x] `packages/angular/src/index.ts`: add `ApiValidationError`/`ApiFieldError`; update
      `createDocument`/`updateDocument` to throw it when the response body has `data.errors`
- [x] Changeset (patch, `@forge-cms/angular`)
- [x] New `document-form.component.ts` (Design §Component) with the field-kind mapping table
- [x] Extend `collection-detail.page.ts` (from spec 003): New/Edit/Delete wiring
- [x] Verified the underlying API contract end-to-end via curl against the real dev server: create
      with missing required fields → exact `{ data: { errors: [...] } }` shape `ApiValidationError`
      expects; create/update/delete all succeed with valid payloads. **Not visually verified in a
      real browser** (no browser automation available this session) — `pnpm --filter @forge-cms/www
typecheck` passed with `strictTemplates: true`, which does validate every template binding
      against the real component APIs, but does not catch layout/click-handling issues live.
- [x] Update STATE.md (PLAN.md P1-3 done; the demo is now full-CRUD; new known issue for the
      error-envelope mismatch)
- [x] Full gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

## Test plan

- Manual, on `pnpm dev:www`, using the `posts` collection (has `text`, `slug`, `textarea`, `relation`,
  `date` fields — good coverage):
  1. New → submit with `title` empty (required) → inline error under the Title field, form stays open.
  2. Fill `title` (+ any other required fields) → submit → new post appears in the table.
  3. Edit that post → change `title` → save → table reflects the change.
  4. Delete it → confirm → row disappears, `GET /api/v1/posts` (devtools/network or a manual curl) no
     longer includes it.
- This is exactly the flow P1-4's Playwright e2e spec will automate later — no need to write it here,
  but keep the DOM structure reasonably selector-friendly (e.g. stable `data-testid` or predictable
  text) since P1-4 comes right after.

## Acceptance criteria

1. Full CRUD cycle on `posts` works from the browser in local dev (create, see it listed, edit,
   delete).
2. Submitting a create/edit with an empty required field shows a visible, per-field validation error
   without a full-page error state.
3. The form's fields and input types are derived from `fieldDefinitions` — adding a new field kind
   mapping requires touching only the mapping table in `document-form.component.ts`, not per-collection
   code.
4. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.

## Open questions

None — resolved during implementation (see Design divergence notes: hand-rolled modal chrome instead
of `VoltDialog`, `window.confirm` for delete).

## Outcome

Implemented as designed, with three divergences discovered and resolved during implementation (all
documented inline in Design above): (1) `VoltSelect` → `VoltNativeSelect` for the `select` kind, (2)
`VoltDialog`'s composition risk → hand-rolled Tailwind modal chrome, (3) the assumed `{ error, details
}` error envelope → the real `{ data: { errors } }` shape the write routes actually return. Full CRUD
cycle verified against the real running server via curl (create/update/delete succeed; validation
failures return the exact shape `ApiValidationError` parses). Full quality gates green. Not yet
visually verified in a real browser — recommend a manual pass in `pnpm dev:www` before demoing,
covering: create with an empty required field (expect inline error), fix and submit (expect row to
appear), edit (expect change to persist), delete with confirm (expect row to disappear).
