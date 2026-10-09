# 086 — Keyboard, focus and existing field interactions (roadmap 0.11 / U02)

- **Status:** done (2026-10-09)
- **Author:** agent draft (implementation requested by the maintainer, 2026-10-09 — "spec 086 — roadmap 0.11 / U02";
  per [SDD.md](../SDD.md) an explicit request to implement counts as approval)
- **Date:** 2026-10-09
- **Branch:** feature/spec-086-admin-keyboard-focus
- **Affected packages/apps:** `packages/admin` (modal chrome, form, field control, relation/upload/richtext pickers,
  list, workspace, users workspace, sign-in/up, page header; tests), `packages/runtime` + `packages/angular`
  (`withTime` field metadata only), `apps/tiny-project` and `apps/demo-aesthetics` (browser journeys and axe scans),
  `apps/www` (release-truth constant), docs, changesets.

## Context / Why

U01 (spec 085) made the existing reusable admin dependable under failure and concurrency. It deliberately left the
hand-rolled modal chrome, the native unsaved-changes `window.confirm`, and every keyboard/screen-reader question to U02
(roadmap 0.11). Spec 056 had also deferred automated accessibility checks ("axe"). U02 _certifies and fixes_ the
existing admin — it does not redesign it, add field kinds, or replace the richtext editor.

## Goal

A keyboard-only editor can sign in, navigate the reusable ForgeCMS admin, create/edit content, correct a real server
validation error, select a relation, use the existing supported field controls, publish/unpublish, cancel or confirm
destructive actions, handle unsaved navigation, and sign out. Modal focus is contained and restored, errors are
programmatically associated with their controls, and primary actions remain reachable on mobile.

## Non-goals

No visual redesign, dashboard, bulk actions, saved filters, command palette, new richtext editor, new field kinds,
arbitrary custom-widget API, drag/drop framework, state-management library, U03 custom-mount/surface-freeze work, or
backend feature expansion unrelated to an existing broken field contract (the only runtime/SDK change is exposing the
existing core `withTime` option in field metadata). No ARIA combobox pattern for the relation picker (a labelled search
plus ordinary result buttons is the supported shape). Localization support is **not** widened (spec 066 stands).

## Evidence gathered before design (2026-10-09)

- `main` = `9ab32d84860ae526194778359fd615444dd10020` (PR #85 "Version Packages"); clean tree, `main == origin/main`,
  no open PRs.
- PR #84 (U01) post-merge main CI `37826074960` ✓ success (16m58s). PR #85 release CI `37830311591` ✓ success
  (15m56s). GitHub release `v0.12.0` (and the per-package `@forge-cms/*@0.12.0` releases) exist; npm `latest` is
  `0.12.0` for `core`, `runtime`, `angular` and `admin`. `.changeset/` held only `config.json` + `README.md`.
- `docs/STATE.md` still said "U01 … PR pending", "npm `latest` is `0.11.0`" and "U01 … will produce `0.12.0`";
  `apps/www/src/app/forge-release.ts` still said `CURRENT_FORGE_VERSION = '0.11.0'`. Both corrected here
  (`0.12.0`, verified 2026-10-09). Package versions were not touched.
- Volt (`@voltui/components` 1.0.1) renders the real `<input>`/`<textarea>`/`<button>` inside its own template. Read
  from the shipped source, not assumed: `volt-input` forwards `id`, `required`, `ariaLabel` and an `aria-invalid`
  tied to an Angular form control (never plain inputs) and **no `aria-describedby`**; `volt-textarea` the same but with
  `state="error"`; `volt-switch` forwards `ariaLabel`; **`volt-label` renders `<label ngpLabel>` whose `for` is derived
  only from an enclosing `ngpFormField`** — outside one it renders no `for` at all.
- `@angular/cdk` (21.2.11 in the lockfile) is a required peer of Volt's `ng-primitives`, so every Volt consumer already
  has it; it was previously a _transitive_ requirement only.

## Audit

Method: read each component, render it under jsdom through the real Volt components and dump the DOM, then (for
anything a DOM dump cannot prove) drive it in Chromium. The Evidence column names the rendered test that pins each
fix; which of them were watched failing before the fix is recorded honestly in the Outcome.

| #   | Surface (file)                                | Observed issue                                                                                                                                                                                                                                                                                                | Evidence                                                                                          | Fix                                                                                                                                                                            | Package impact                  |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| 1   | field-control, sign-in, sign-up, users        | **No `<label for>` pointed at any control.** `volt-label` emits `for` only inside `ngpFormField`; every Forge label was an orphan (clicking it, or a screen reader, reached nothing).                                                                                                                         | DOM dump of sign-in/editor: `<label ngplabel id="ngp-label-0">` with no `for`; `labelFor()` null  | Native `<label [attr.for]>` with Volt's label classes; widgets without one native control are `role="group"` + `aria-labelledby`.                                              | admin                           |
| 2   | sign-in, sign-up, users                       | **Duplicate ids.** Static `id="forge-signin-email"` on `<volt-input>` sets the attribute on the host _and_ the inner input; a `for` would bind the non-labelable host.                                                                                                                                        | DOM dump: two elements per id                                                                     | `[id]="'…'"` (property binding: inner input only). Rendered test: one element per id.                                                                                          | admin                           |
| 3   | field-control (array, blocks)                 | **Row index bug.** Inside the nested `@for (child …)` `$index` is the _child's_ index, so `rowPath`/`setInRow` addressed row 0: editing row 2's first field edited row 0, rows 2+ shared ids and error paths.                                                                                                 | Rendered test `editing the second row changes the second row` (and nested error to the right row) | `let rowIndex = $index` on the outer loop.                                                                                                                                     | admin                           |
| 4   | document-editor                               | Request-level save/session message rendered **outside** the dialog, behind its backdrop.                                                                                                                                                                                                                      | Template read; screenshot                                                                         | Passed in as the form's optional `error` input, rendered inside the dialog with `role="alert"`.                                                                                | admin (optional input)          |
| 5   | field-control (scalars)                       | Required shown only as `*`; invalid state and the error text were not on the control (`volt-error` beside it, no association).                                                                                                                                                                                | DOM dump                                                                                          | `required` on the native control, `*` is `aria-hidden`; `ForgeControlA11yDirective` sets `aria-invalid`/`aria-describedby` on the rendered control; error is a plain `<p id>`. | admin                           |
| 6   | field-control (group/array/blocks)            | A validation error keyed at the composite (`steps`, `hero`) was rendered nowhere.                                                                                                                                                                                                                             | Rendered test `renders a composite-level error with its fieldset`                                 | Error text in the fieldset, `aria-describedby` on it.                                                                                                                          | admin                           |
| 7   | field-control (array, blocks)                 | `minRows` ignored on removal (only `maxRows` gated Add); Add vanished at `maxRows`, dropping focus.                                                                                                                                                                                                           | Rendered test `at minRows nothing is removable`                                                   | Remove disabled at the minimum, Add disabled (not removed) at the maximum, both with a visible reason.                                                                         | admin                           |
| 8   | field-control (arrays/blocks)                 | Rows and block pickers had no accessible identity; Remove/Add anonymous; block picker unnamed.                                                                                                                                                                                                                | DOM dump                                                                                          | `role="group"` "Steps row 2 of 3"; "Remove Steps row 2 of 3"; "Add row to Steps"; "Block type to add to Sections".                                                             | admin                           |
| 9   | field-control (blocks)                        | A stored `blockType` missing from the schema rendered a bare title and no fields — looking empty/safe. (Its raw row **was** already preserved untouched in the payload — verified; that part needed no change.)                                                                                               | Test `unknown stored block types` (payload equality)                                              | Explicit "Unknown block type …, kept as it is unless you remove it" notice; deliberate Remove only.                                                                            | admin                           |
| 10  | field-control (date), runtime, angular        | `date` bound an ISO instant to `type="date"` (always showed empty) and `withTime` never reached the client, so a datetime field was edited as a day and silently lost its time.                                                                                                                               | Date helper tests; rendered test                                                                  | `FieldDescription.withTime`/`FieldMeta.withTime`; `date-value.ts` helpers; `datetime-local` for `withTime`.                                                                    | runtime, angular, admin (patch) |
| 11  | field-control (locale)                        | Locale buttons: no group name, no selected state, no focus ring.                                                                                                                                                                                                                                              | Template read                                                                                     | Labelled group of `aria-pressed` toggle buttons with a focus ring.                                                                                                             | admin                           |
| 12  | relation-picker                               | Enter in the search box **submitted the whole document form**; chips' Remove were all "Remove"; raw `err.message` shown; no polite status; focus lost after choosing a single relation.                                                                                                                       | Rendered tests (Enter default prevented; names; safe text instead of provider text)               | Enter → first result; named chips; `describeAdminError`; persistent `role="status"`; focus moves to "Choose another"/search box.                                               | admin                           |
| 13  | upload-picker                                 | Toggle had no `aria-expanded`; library and items unnamed; raw `err.message`; a second upload could start while one ran; focus unpredictable.                                                                                                                                                                  | Rendered tests                                                                                    | `aria-expanded`/`aria-controls`, "Media library" group, "Select photo.png"; in-flight guard + disabled input; safe errors; focus handed back.                                  | admin                           |
| 14  | richtext-editor                               | Block selects/textareas unnamed; Move buttons were only "↑"/"↓"; Remove anonymous; JSON fallback textarea unlabelled; focus lost on Add/Remove/Move.                                                                                                                                                          | Rendered tests                                                                                    | Names "Body block 2 of 3 type/text/up/down/remove"; focus moves to the new/neighbouring block or Add; fallback textarea labelled by its explanation. JSON path unchanged.      | admin                           |
| 15  | collection-form, confirm-dialog               | Dialog semantics but **no focus entry, trap or return**; background reachable by Tab.                                                                                                                                                                                                                         | Rendered tests; real Tab loop in Chromium                                                         | `ForgeModalFocusDirective` over `@angular/cdk/a11y`'s focus trap (see Design).                                                                                                 | admin (+ cdk peer)              |
| 16  | document-editor                               | Unsaved navigation used native `window.confirm`.                                                                                                                                                                                                                                                              | U01 tests pinned it                                                                               | Async `canDeactivate` over the shared confirmation dialog.                                                                                                                     | admin                           |
| 17  | collection-workspace, users-workspace         | After a successful delete the focused row button was removed: focus fell to `<body>`.                                                                                                                                                                                                                         | Rendered tests                                                                                    | Focus the page `h1` (made `tabindex="-1"`).                                                                                                                                    | admin                           |
| 18  | collection-list                               | Row actions were "Edit"/"Delete"/"Publish" for every row; sort header gave no state.                                                                                                                                                                                                                          | DOM dump                                                                                          | Names carry the row's title ("Edit First"); sort state announced; focus ring on sort buttons.                                                                                  | admin                           |
| 19  | collection-workspace                          | Search input unlabelled; status filter had no group/pressed state/focus ring; `actionError` not an alert.                                                                                                                                                                                                     | DOM dump                                                                                          | `aria-label`, labelled group + `aria-pressed`, `role="alert"`.                                                                                                                 | admin                           |
| 20  | users-workspace                               | Not a `<form>` (Enter did nothing); the sole admin's controls were `disabled` (unreachable) with the reason only in `title`/sr text; `volt-error role="alert"` nested alerts.                                                                                                                                 | Template read                                                                                     | Real form → guarded `onSubmit`; focusable `aria-disabled` + `aria-describedby` reason (server rule unchanged); focus management; plain alert.                                  | admin                           |
| 21  | sign-in, sign-up                              | After a failed attempt focus was lost (the submit button was disabled while loading); nested `role="alert"`; password toggle had no focus ring.                                                                                                                                                               | Rendered tests                                                                                    | Focus → password (sign-in) / email (sign-up); plain alert + polite status; focus ring. Safe-return-URL logic untouched.                                                        | admin                           |
| 22  | collection-form (mobile)                      | The whole card scrolled (`max-h-[85vh]`), so the action row scrolled away with the fields.                                                                                                                                                                                                                    | Screenshot at 375px                                                                               | Card capped to `100dvh`; title and action row fixed, only the fields scroll.                                                                                                   | admin                           |
| –   | layout/sidebar, collections index, tables     | **NO CHANGE NEEDED.** `/admin` and `/admin/collections` pass axe (WCAG 2.2 AA, incl. target size and contrast in the styled consumer); the header's native icon buttons carry `aria-label`; tables are `volt-table`; wide tables already scroll inside `overflow-x-auto` (spec 075 responsive spec at 390px). | axe scans; existing `responsive.spec.ts`                                                          | —                                                                                                                                                                              | —                               |
| –   | password toggle name, `Enter` on sign-in form | **NO CHANGE NEEDED** for the accessible name ("Show/Hide password") and Enter-submits; duplicate submit was already blocked (`disabled` while loading) — an explicit guard added anyway.                                                                                                                      | Rendered tests                                                                                    | —                                                                                                                                                                              | —                               |

## Design

**Focus primitive.** Audit order: (1) VoltUI/ng-primitives — Volt's dialog needs a trigger+TemplateRef composition and the
CDK overlay (the reason the modals were hand-rolled, spec 042); using it would be a rewrite, not a focus fix, and
`ng-primitives`' trap is not exported by Volt. (2) **Angular CDK a11y** — `ConfigurableFocusTrapFactory`: maintained,
framework-native, already installed by every Volt consumer. (3) A hand-written Tab cycle — rejected. Chosen: CDK.
`@angular/cdk` is therefore declared a **direct peer** of `@forge-cms/admin` (`^21.2.0`, matching the existing Angular
21.2 floor; devDependency `21.2.11`), the README says so, and `release:compat` already installs it in all three Angular
21 combinations (the comment that called it "not a Forge peer" is corrected). Angular 22 support is unchanged
(VoltUI remains the limiting peer). No `@HostListener`/`@HostBinding`; nothing new is exported.

**`ForgeModalFocusDirective`** (internal, `forgeModalFocus` on the overlay element — whose lifetime is the dialog's):

- _Open:_ remember `document.activeElement`; create the CDK trap (anchors attached after first render — a constructor has
  no parent node yet, found by the first test); focus a component-chosen initial control (a static selector: Cancel for
  confirmations) or the first tabbable (the first field for the editor).
- _While open:_ Tab/Shift+Tab wrap inside via the trap's anchors, which sit directly around the overlay.
- _Close:_ in a microtask (after the DOM is gone) restore focus to the opener if it is still connected, else the page
  `h1` (`tabindex="-1"`), never a disconnected node; one retry after 150 ms covers a list that re-renders after a save.
  Dialogs closed in the same tick are resolved together, **outermost first**, and only if focus was actually lost — so
  _Leave without saving_ on an editor opened from "New" returns to "New", not to the inner dialog's button.
- _Escape_ stays on each dialog's own handler: inert while a U01 write is pending (`pending`/`submitting`).
- _Nesting:_ the unsaved-changes dialog is a sibling of the editor dialog (later in the DOM, same z-index) with its own
  trap; the editor's trap is untouched.

**Unsaved-changes guard.** `canDeactivate(): boolean | Promise<boolean>` — clean → `true` (no dialog); dirty → one shared
promise and one `forge-confirm-dialog` ("Leave without saving?", **Stay** / **Leave without saving**). Stay → `false`
(editor, values and dirty state intact; focus returns to what started the navigation); Leave → `true`. A second attempt
while open returns the same promise. Success still clears dirty before navigating, so no dialog. Destroying the editor
resolves an open prompt `false`. No autosave.

**Rendered control accessibility.** `ForgeControlA11yDirective` sits on each field wrapper and, after every render, sets
`aria-invalid` and its own token in `aria-describedby` on the _actual native control_ (found by `id`, never by a
path-built selector). The visible error is a plain `<p id="{path}-error">` (not `role="alert"`): field errors are
associated with the control, the request-level message is the one alert (no duplicate announcements). `novalidate` on the
forms keeps the browser from preempting server messages while `required` stays truthful.

**First invalid field.** `ForgeCollectionFormComponent` reacts to a _new_ non-empty `fieldErrors` and, after render, asks
the DOM for `[data-forge-invalid]` wrappers (flagged by the field control): the first one with no invalid descendant wins
(a child before its container); its control is found by `id === data-forge-path`, or, for a composite with only its own
error, the first actionable descendant. No error → no focus change (network/5xx/conflict show the alert); after a
disabled-then-enabled Save with no field to blame, focus returns to Save.

**Composite rows.** Rows/blocks are `role="group"` with a positional name; focus after Add is the new row's first field,
after Remove the row that took its place (else Add); `minRows`/`maxRows` as in the audit.

**Dates.** `date-value.ts`: `toDateInputValue` (canonical ISO → UTC `YYYY-MM-DD`; a bare day is kept),
`fromDateInputValue`, `toDateTimeLocalValue` (instant → viewer's local `YYYY-MM-DDTHH:mm`), `fromDateTimeLocalValue`
(complete local date-time → `toISOString()`; a half-typed value is returned as typed so the server reports it; empty →
unset). No timezone configuration, wire format unchanged (`Date` canonicalization on the server is spec 076).
`describeField` copies `withTime: true` for date fields only. Tests build every expectation from the local components so
they hold in any timezone.

**Pickers and richtext, users, auth.** As in the audit; no component was replaced. The relation picker keeps its
server-side search and stale-response protection (a regression test pins the latter).

**Mobile.** The editor card is `max-h-[calc(100dvh-2rem)]` with the title and the action row outside the scrolling
region; measured at 375×667 in the styled demo.

**Public surface.** No new exports (`pnpm check:api` unchanged: it tracks exported names). Additive optional members:
`FieldDescription.withTime`, `FieldMeta.withTime`; optional component inputs `error` (form), `label` (relation/upload
pickers), `label`/`idPrefix` (richtext). `ForgeModalFocusDirective`, `ForgeControlA11yDirective` and `date-value.ts` are
internal. `canDeactivate()`'s return type widens to `boolean | Promise<boolean>`.

## Implementation plan

1. Release truth (STATE, `CURRENT_FORGE_VERSION`). 2. `withTime` metadata + test. 3. `@angular/cdk` peer, internal
   directives, date helpers (+ tests). 4. Dialogs, form, editor guard. 5. Field control, pickers, richtext. 6. List,
   workspace, users, auth. 7. Rendered `*.accessibility.test.ts` suites (red first for each defect). 8. Playwright: the
   tiny-project keyboard journey and axe scans, the styled demo scans and mobile check. 9. Docs, changesets, full gates.

## Test plan

- **Rendered (Vitest + `@analogjs/vite-plugin-angular` + jsdom, the U01 infrastructure; U01 suites unchanged except
  where U02 deliberately changes the contract — see Outcome):** `confirm-dialog`, `collection-form`, `field-control`,
  `document-editor`, `relation-picker`, `upload-picker`, `richtext-editor`, `users-workspace`, `collection-workspace`,
  `auth` `.accessibility.test.ts`; pure `date-value.test.ts`; runtime `describe.test.ts`. jsdom has no layout and does not
  Tab, so a `stubLayout()` helper gives elements geometry and the trap is proven by the anchors' placement and what
  focusing them does (exactly what a real Tab off either end does); real Tab/Shift+Tab is proven in Chromium.
- **Playwright, real server:** `apps/tiny-project` — the keyboard journey (sign-in → Posts → New → a real server validation error → the required `posts.author`
  relation → save → publish → edit → Stay/Leave → delete Cancel/Confirm → sign-out), axe on sign-in (+ error), collections index, collection workspace, users workspace (+ form), editor, editor
  with real server errors, relation picker with results, both confirmation dialogs.
  `apps/demo-aesthetics` — the styled consumer: workspace, delete dialog, editor with array row, upload library open,
  editor with errors, relation results, users workspace, and the 375px mobile reachability test.
- **axe:** `@axe-core/playwright` **4.13.0** (npm `latest`, published 2026-08-11; peer `playwright-core >= 1.0`, repo
  uses 1.60.0), tags `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa`. No other scanner. **One narrow exclusion:**
  `target-size` (WCAG 2.2 · 2.5.8) in `apps/tiny-project` only — that fixture ships no stylesheet at all (spec 055), so
  control sizes are browser defaults and the rule measures the fixture, not the admin. It runs, unexcluded, in the styled
  consumer; the first unexcluded tiny-project scan flagged only that rule. No other rule is disabled anywhere.

## Acceptance criteria

1. PR #84 main CI, PR #85 release CI and the `0.12.0` publication confirmed; STATE and the website constant say `0.12.0`.
2. U01 suites remain green; the three tests that asserted `window.confirm` now assert the Forge dialog (contract change owned by U02).
3. Editor modal: initial focus inside; Tab and Shift+Tab contained (jsdom anchors + real Chromium loop); pending write cannot be dismissed; focus returns to the opener, or to the heading when it is gone; nested confirmation returns focus correctly.
4. No `window.confirm` in the reusable editor; Stay/Leave/clean/no-stacking proven.
5. Real label, required, invalid and described error on the rendered native control for every scalar kind; widgets are labelled groups.
6. Server validation focuses the first invalid control (nested paths, composites); network/5xx does not move focus.
7. Composite errors render and are associated; `minRows`/`maxRows`/identity/unknown-block behaviour pinned (component and payload).
8. `withTime` reaches runtime and Angular metadata; date/datetime controls correct; helpers tested timezone-independently.
9. Locale selector keyboard-usable with exposed selection; support still limited to what the runtime accepts.
10. Relation/upload/richtext keyboard flows, names, status, safe errors and in-flight guard proven.
11. Sole-admin reason keyboard-discoverable; server invariant untouched; users form submits on Enter once.
12. Sign-in/up: labelled, single submit, announced error, usable focus.
13. Mobile 375px: Create/Cancel in the viewport before and after scrolling the fields, no horizontal overflow.
14. axe passes the representative states with the single documented exclusion; the keyboard journey passes.
15. API baseline reviewed (unchanged); changesets patch → `0.12.1`; no U03 work; every CI-equivalent gate passes.

## Supported admin field matrix (as of this spec)

"Keyboard" = operable and named without a pointer. "Localization" is the **runtime** truth (spec 066): only top-level
`text`/`textarea`; everything else is rejected at startup, nested localized fields included — the admin never offers a
locale selector the runtime would not honour.

| Kind       | Admin control                                        | Keyboard                                             | Validation / error behaviour                                                  | Localization | Limitations                                                                                   |
| ---------- | ---------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------- |
| `text`     | `volt-input` (text)                                  | ✓ label, `required`                                  | `aria-invalid` + described error; first-invalid focus                         | ✓ top-level  | —                                                                                             |
| `number`   | `volt-input` (number)                                | ✓                                                    | same; empty → unset (never `0`)                                               | ✗            | Browser number input semantics                                                                |
| `boolean`  | `volt-switch` (a `role="switch"` button)             | ✓ Space/Enter; named by `aria-label`                 | `aria-invalid` + described error                                              | ✗            | `required` is not expressible on a switch (no `aria-required` for the role)                   |
| `date`     | native `date`, or `datetime-local` when `withTime`   | ✓                                                    | same; half-typed date-time is sent as typed for the server to report          | ✗            | No timezone setting; a date-only value is its UTC day; `withTime` shows local wall-clock time |
| `relation` | relation picker (search + result buttons + chips)    | ✓ Enter → results, Enter/Space chooses, named Remove | error on the search box (or the group when none); safe failure text           | ✗            | Not an ARIA combobox (no arrow-key model); searches the target's first text/slug/email field  |
| `json`     | `volt-textarea`                                      | ✓                                                    | invalid JSON is kept as text and reported by the server                       | ✗            | Raw text editing                                                                              |
| `select`   | native `<select>`                                    | ✓                                                    | same as text                                                                  | ✗            | —                                                                                             |
| `slug`     | `volt-input` (text)                                  | ✓                                                    | same; generation is server-side                                               | ✗            | No client-side slug preview                                                                   |
| `email`    | `volt-input` (email)                                 | ✓                                                    | same                                                                          | ✗            | —                                                                                             |
| `textarea` | `volt-textarea`                                      | ✓                                                    | same                                                                          | ✓ top-level  | —                                                                                             |
| `richtext` | simple-block editor, else an explicit JSON view      | ✓ named type/text/move/remove/add, focus follows     | error on the labelled group                                                   | ✗            | No marks/WYSIWYG; unrepresentable trees stay JSON (never flattened)                           |
| `upload`   | upload picker (file input, library, preview, Remove) | ✓ `aria-expanded`, named items, one upload at a time | error on the file input; safe failure text                                    | ✗            | Single file; no drag/drop, crop or processing                                                 |
| `group`    | `fieldset` + `legend`                                | ✓ children as above                                  | own error rendered with the fieldset and associated; child errors on children | ✗ (nested)   | —                                                                                             |
| `array`    | row groups ("Steps row 2 of 3"), Add/Remove          | ✓ focus to new/neighbouring row                      | composite error rendered; nested paths focus the right row                    | ✗ (nested)   | No reorder or drag/drop; `minRows`/`maxRows` explained in text                                |
| `blocks`   | row groups per block + a named type picker           | ✓ as arrays                                          | as arrays                                                                     | ✗ (nested)   | Unknown stored block types are shown as unknown, kept as-is, removable only deliberately      |

## Remaining non-blocking limitations

Background content behind a modal is not made `inert` (Tab is trapped and a pointer is blocked by the backdrop; some
screen readers can still browse behind `aria-modal`). The relation picker is not a combobox. `target-size`/contrast are
measured in the styled consumer only. The virtual-keyboard case on a real phone is not simulated (the action row is
inside the `100dvh` card, so it follows the dynamic viewport). U03 (custom-mount reuse, surface freeze) is untouched.

## Open questions

None.

## Outcome

**Baseline.** `main` `9ab32d84860ae526194778359fd615444dd10020`; PR #84 main CI `37826074960` ✓; PR #85 release CI
`37830311591` ✓; published `0.12.0` (npm + GitHub `v0.12.0`); no open PRs. STATE, README and
`CURRENT_FORGE_VERSION` corrected to `0.12.0` (not `0.12.1`: the constant reports what is published).

**Audit.** 22 findings and 2 NO CHANGE NEEDED rows (layout/sidebar/index/tables; password-toggle name) — see the table. The
most consequential, all pre-existing: `volt-label` never emitted `for` (every label orphaned), duplicate ids from
static `id` on `volt-input`, array/block rows 2+ addressing row 0 (data-corrupting), Enter in the relation search
submitting the whole form, request errors rendered behind the backdrop. **Watched failing before the fix:** the
label association (`labelFor` null), the row index bug (fix reverted to confirm), the focus anchors (not attached from
a constructor), restore-to-opener with stale batches, Enter-before-results. The remaining fixes were written together
with their rendered tests rather than red-first; the tests pin the behaviour regardless.

**Delivered.** Focus: `ForgeModalFocusDirective` over `@angular/cdk/a11y` (chosen over Volt's dialog — a rewrite — and a
hand-written trap); entry/trap/return/outermost-first restore as in Design. Unsaved guard: async, shared promise,
Forge dialog, no `window.confirm`. Errors: native labels, `required`/`aria-invalid`/`aria-describedby` on the rendered
control, composite errors (a chosen single relation/richtext described on its group), first-invalid focus incl. nested
paths, non-field failures keep focus off fields. `minRows`/`maxRows` with reasons; unknown blocks flagged and
preserved. `withTime` → `datetime-local`. Locale toggle group with `aria-pressed`. Relation/upload/richtext named,
status regions, `describeAdminError`, upload in-flight guard, focus management. Sole-admin: focusable `aria-disabled`
with a **visible** reason. Users real form. Sign-in/up focus after failure. Mobile: card ≤ `100dvh`, fixed title and
action row. Review follow-up fixed: `afterNextRender` after an `await` throws on a destroyed view (cancelled upload) →
`afterNextRenderIfAlive`, tested.

**Evidence.** Admin: 189 tests (U01's 103 retained; changed only where U02 changes the contract: the three
`window.confirm` assertions, row-action name matchers, `#id input` → `input#id`); runtime `describe` +1. Browser
(all newly executed, 2026-10-09): tiny-project 22/22 (keyboard journey + axe on collections index, workspace, users
(+form), editor, editor with real server errors, relation results, both confirmations, sign-in (+error)); demo 32/32
(styled axe scans incl. upload library, array row, relation results, 375px reachability: the card fits, the fields
scroll, Create/Cancel stay in view, ≥24px); www 41/41, www:prod 11/11. U01 e2e locators were changed to leading-word
regexes because row actions now carry the row title; the www/tiny unsaved-changes e2e now drives the Forge dialog.
**Honest limits:** the journey uses `focus()` + Enter/Space for most controls and real Tab only inside the modals and
sign-in, so it proves operability and containment, not tab-order reachability of every control; invalid-state tests
pin text/number/select/textarea/nested/relation, not each of boolean/date/email/json/slug individually (same
directive); the batched outermost-first restore is proven end to end by the browser journey, not by a same-tick unit test.

**axe.** `@axe-core/playwright` 4.13.0, tags `wcag2a,wcag2aa,wcag21a,wcag21aa,wcag22aa`. One exclusion: `target-size`
in the unstyled tiny-project fixture only (documented above); none in the styled demo.

**Public/peer/release.** No new exports (`check:api` unchanged — it tracks names, not members). Additive optional
members `withTime` (runtime, Angular), inputs `error`/`label`/`idPrefix`; `canDeactivate()` now
`boolean | Promise<boolean>` (documented in README and changeset). `@angular/cdk ^21.2.0` is a direct admin peer;
`release:compat` (Angular 21.0.0 → 22 matrix, admin 21.2.0/21.2.10/21.2.25) ✓. Changesets: admin patch; runtime +
angular patch → `pnpm changeset status`: whole fixed family patch → expected **`0.12.1`**.

**Gates (2026-10-09).** Newly executed: `lint`, `typecheck`, `test` (only unchanged packages Turbo-cached on the final
run; an earlier full run had 0 cached), `build`, `check:api`, `test:cloudflare`, `test:libsql`, `test:upgrade`,
`release:verify`, `release:compat`, `release:ssr`, `e2e:www`, `e2e:www:prod`, `e2e:tiny-project`, `e2e:demo`.
`format:check`: only fails on the untracked local `.kilo/worktrees/…` fixtures (not in the repo); all repo files clean.
**Not runnable locally:** `test:s3` (no Docker daemon; nothing under `packages/s3` or its fixtures changed — CI runs it).
Open, accepted: the modal background is not `inert`; `afterEveryRender` in the control directive does a small DOM
lookup per field per render; the focus directive's batch state is module-level (client-only use; the admin is not
server-rendered).

**Remaining.** U03 — certify admin reuse and freeze the 1.0 surface.
