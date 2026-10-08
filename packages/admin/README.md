# @forge-cms/admin

Embeddable Angular admin for ForgeCMS: layout, collections index, collection workspace, document
editor, sign-in/sign-up and users workspace, plus the route helpers `forgeAdminContentRoutes()` and
`forgeAdminAuthRoutes()`. Built on `@forge-cms/angular`.

```sh
pnpm add @forge-cms/admin @forge-cms/angular @voltui/components lumen-icons @angular/cdk
```

Guide: https://forge-cms.pages.dev/docs/small-project-guide

## Compatibility

Peers: `@angular/{common,core,forms,platform-browser,router}` `^21.2.0`, `rxjs` `^7.8.0`,
`@voltui/components` `^1.0.1`, `lumen-icons` `^0.2.0`; optional `@angular/compiler-cli` `^21.2.0`,
`@babel/core` `^7.28.0` and `vite` `^7.0.0 || ^8.0.0` for the linker. Proven by strict packed-consumer
builds (`pnpm release:compat`: Angular 21.2.0, 21.2.10 and 21.2.25). Angular 22 is not supported yet:
VoltUI 1.x peers `@angular/* ^21.2.0`. VoltUI's dependency `ng-primitives` also needs `@angular/cdk`.

Vite/Analog apps must add the Angular linker (the same plugin as `@forge-cms/angular/vite`):

```ts
import { angularLinker } from '@forge-cms/admin/vite';

export default defineConfig({ plugins: [angularLinker(), analog()] });
```

## Reliability behaviour (spec 085)

What an editor can rely on when something goes wrong — the server stays authoritative throughout:

- **Saving is single-shot.** A save shows "Saving…", disables submit/cancel, and sends exactly one
  write; success clears the unsaved-changes flag _before_ navigating, so leaving never prompts.
- **A failed save keeps the work.** Validation errors render beside their fields; network, `5xx` and
  `409` failures show a readable message; every entered value and the dirty flag stay, and retry sends
  the current form. A remote refresh of the same document never overwrites local edits; moving to
  another document, `new`, or another collection starts a clean draft.
- **Unsaved changes** use the browser confirmation from `canDeactivateForgeDocumentEditor`; it prompts
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
