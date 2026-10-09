# @forge-cms/admin

Embeddable Angular admin for ForgeCMS: layout, collections index, collection workspace, document
editor, sign-in/sign-up and users workspace, plus the route helpers `forgeAdminContentRoutes()` and
`forgeAdminAuthRoutes()`. Built on `@forge-cms/angular`.

```sh
pnpm add @forge-cms/admin @forge-cms/angular @voltui/components lumen-icons @angular/cdk
```

Guide: https://forge-cms.pages.dev/docs/small-project-guide

## Compatibility

Peers: `@angular/{cdk,common,core,forms,platform-browser,router}` `^21.2.0`, `rxjs` `^7.8.0`,
`@voltui/components` `^1.0.1`, `lumen-icons` `^0.2.0`; optional `@angular/compiler-cli` `^21.2.0`,
`@babel/core` `^7.28.0` and `vite` `^7.0.0 || ^8.0.0` for the linker. Proven by strict packed-consumer
builds (`pnpm release:compat`: Angular 21.2.0, 21.2.10 and 21.2.25). Angular 22 is not supported yet:
VoltUI 1.x peers `@angular/* ^21.2.0`. `@angular/cdk` is a direct peer since 0.12.1: the admin's modal
focus trap uses `@angular/cdk/a11y` (VoltUI's `ng-primitives` already required it, so most hosts have it).

Vite/Analog apps must add the Angular linker (the same plugin as `@forge-cms/angular/vite`):

```ts
import { angularLinker } from '@forge-cms/admin/vite';

export default defineConfig({ plugins: [angularLinker(), analog()] });
```

## Mounting and configuration (spec 087)

`forgeAdminContentRoutes()` and `forgeAdminAuthRoutes()` return relative route subtrees; nest them under
any path. `/admin` is only the default assumption. To mount elsewhere (e.g. `/studio`), pass the same
root to the three places that name a URL — plus the one client provider for the APIs:

```ts
const MOUNT = '/studio';
export const ADMIN_ROUTES: Routes = [
  ...forgeAdminAuthRoutes({ signup: true, basePath: MOUNT }),
  {
    path: '',
    component: ForgeAdminLayoutComponent,
    data: { config: { title: 'Studio', basePath: MOUNT } satisfies ForgeAdminConfig },
    canActivate: [forgeAuthGuard({ signInPath: `${MOUNT}/login`, forbiddenPath: MOUNT })],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'collections' },
      ...forgeAdminContentRoutes()
    ]
  }
];
// app.config.ts: provideRouter(routes, withComponentInputBinding()),
//   provideForgeCms({ baseUrl: '/content-api', authBaseUrl: '/account-api', credentials: 'include' })
```

`basePath` must be a same-app absolute path (nested segments allowed, trailing slash ignored). A sign-in
`returnUrl` is honoured only under it. The package has no API URL of its own — `provideForgeCms()` is the
only place the content and auth bases are set. The default navigation lists only package-mounted
destinations (Collections, admin-only Users); add your own dashboard/media/settings pages through
`ForgeAdminConfig.nav`. `logo` and `features` are deprecated no-ops. Forge Analytics is experimental.
The full reviewed contract, defaults and migration notes are in
[docs/1.0-PUBLIC-SURFACE.md](../../docs/1.0-PUBLIC-SURFACE.md).

## Reliability behaviour (spec 085)

What an editor can rely on when something goes wrong — the server stays authoritative throughout:

- **Saving is single-shot.** A save shows "Saving…", disables submit/cancel, and sends exactly one
  write; success clears the unsaved-changes flag _before_ navigating, so leaving never prompts.
- **A failed save keeps the work.** Validation errors render beside their fields; network, `5xx` and
  `409` failures show a readable message; every entered value and the dirty flag stay, and retry sends
  the current form. A remote refresh of the same document never overwrites local edits; moving to
  another document, `new`, or another collection starts a clean draft.
- **Unsaved changes** are confirmed in Forge's own dialog (spec 086; the guard
  `canDeactivateForgeDocumentEditor` returns an asynchronous result, never `window.confirm`); it prompts
  only for a dirty editor.
- **List state** (search, status, sort, page) survives an editor round trip and resets when the
  collection changes. Late delete/publish responses for another collection are ignored.
- **Delete and publish report the real outcome.** Confirming sends one request; a failed delete keeps
  the dialog open with the error (confirming again is the retry). Publish/unpublish shows a pending
  state and never shows the new status before the server accepted it.
- **Sessions.** A `401` leaves the form on screen with a "session expired" notice and blocks further
  saves until sign-in; a `403` re-reads the live role through `ForgeAuthSession.refresh()`. The users
  workspace drops its rows (and, for a demotion, any open form) when admin permission is lost.

Component inputs added for hosts that use the pieces on their own: `ForgeCollectionFormComponent`
`submitting` / `submitDisabled`, `ForgeConfirmDialogComponent` `pending` / `pendingLabel` / `error`,
`ForgeCollectionListComponent` `pendingIds` — all optional.

## Keyboard, focus and field interactions (spec 086)

What a keyboard-only editor can rely on:

- **Modals** (the document editor, the delete and unsaved-changes confirmations) move focus inside when
  they open — the first field, or the safe choice (Cancel / Stay) — keep Tab and Shift+Tab inside, and
  Escape cancels (never while a write is in flight). Closing returns focus to what opened the dialog;
  when that control is gone (a deleted row, a closed editor) focus lands on the page heading, never on a
  removed node. The editor's title and Save/Cancel row stay fixed while only the fields scroll, so the
  primary actions stay on screen on a phone.
- **Unsaved changes.** Navigating away from a dirty editor opens the confirmation. _Stay_ keeps the
  editor, every value and the dirty state; _Leave without saving_ lets the navigation through. A second
  attempt while the dialog is open shares it (no stacked prompts). **Host guards:** `ForgeDocumentEditorComponent.canDeactivate()` now returns `boolean | Promise<boolean>` — `await` it (or return it from your guard) rather than using it in a boolean expression. A saved editor is clean: no dialog.
- **Errors belong to their control.** Every field is named by a real `<label for>`; the rendered native
  control carries `required`, `aria-invalid` and `aria-describedby` pointing at its error text. After a
  server validation error focus moves to the first invalid field (nested `seo.metaTitle`, `steps.1.label`
  included); a network failure, `5xx` or conflict without field details does not move focus, it shows an
  alert. A validation error on a `group`/`array`/`blocks` itself renders with that fieldset.
- **Arrays and blocks** are named groups ("Steps row 2 of 3", "Hero block 1 of 2") with per-row Remove
  and an Add control tied to the field. `minRows` stops removal at the minimum, `maxRows` disables Add
  at the maximum, and a short note says why. A stored block whose type is not in the schema is shown as
  unknown, kept untouched in what is saved, and only removed deliberately.
- **Dates.** A `date` field shows its canonical ISO value in a native date control and submits a
  `YYYY-MM-DD` day; `defineField.date({ withTime: true })` (now in the field metadata) uses
  `datetime-local`, shows the viewer's local wall-clock time and submits a canonical ISO instant. There
  is no timezone setting.
- **Locales.** A localized field (top-level `text`/`textarea`, the only shapes the runtime accepts)
  gets a labelled group of toggle buttons (`aria-pressed`); switching never overwrites another locale.
- **Relation picker.** Search box labelled by the field; Enter moves to the first result (it never
  submits the form); results are buttons; chips have named Remove buttons; searching/no matches are
  announced politely and failures show safe text. **Upload picker:** the file input is labelled by the
  field, "Choose existing" exposes `aria-expanded`, library items are named, one upload at a time.
  **Richtext:** every block's type, text and Move/Remove controls are named after the block; Add,
  Remove and Move keep focus on a useful control; a tree the block editor cannot represent stays an
  explicit, labelled JSON view.
- **Users.** A real form (Enter submits through the guarded save); the only admin's delete and role
  controls stay focusable and explain why they do nothing (the server still enforces it).

Component inputs added for hosts that use the pieces on their own — all optional:
`ForgeCollectionFormComponent` `error` (a request-level message shown with alert semantics inside the
dialog), `ForgeRelationPickerComponent` / `ForgeUploadPickerComponent` `label`,
`ForgeRichTextEditorComponent` `label` / `idPrefix`.

Automated evidence: the rendered `*.accessibility.test.ts` suites in this package and the
`@axe-core/playwright` scans (WCAG 2.2 AA) in `apps/tiny-project` and `apps/demo-aesthetics`.
