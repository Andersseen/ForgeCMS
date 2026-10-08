# 085 — Reliable content state and failure recovery (roadmap 0.11 / U01)

- **Status:** done (2026-10-08)
- **Author:** agent draft (implementation requested by the maintainer, 2026-10-08 — "spec 085 — roadmap 0.11 / U01";
  per [SDD.md](../SDD.md) an explicit request to implement counts as approval)
- **Date:** 2026-10-08
- **Branch:** feature/spec-085-admin-reliability
- **Affected packages/apps:** `packages/admin` (editor, form, workspace, list, confirm dialog, users workspace,
  collections index; test config), `apps/tiny-project` (browser journeys), docs. **No `@forge-cms/angular` change:**
  no generic SDK defect was found.

## Context / Why

C03 (spec 077) made the _read_ path honest: stale list/document responses cannot commit and credentials changes
reset resources. The _write_ path and the surrounding component state were still optimistic: a document save had no
in-flight guard, a delete closed its dialog before the server answered, local form edits belonged to a component the
router reuses, query state outlived a collection change, and the users workspace was imperative and unguarded.
Roadmap 0.11 / U01 makes the existing admin dependable under ordinary failure and concurrency — reliability, not a
redesign.

## Goal

An editor using the reusable ForgeCMS Angular admin can load, search, edit, validate, save, publish/unpublish and
delete content without duplicate writes, stale async results, silently lost input or misleading success state;
recoverable failures preserve the user's work, and session or permission changes reported by the server are
reflected safely in the UI.

## Non-goals

No visual redesign, dashboard, bulk actions, saved filters, richtext replacement, new field kinds, command palette,
custom widgets, dialog/focus-system rewrite or accessibility audit (U02), no custom-mount/base-path certification
(U03), no backend work (none was needed), no URL persistence of list state, no auto-retry, no optimistic updates.
Relation and upload pickers were not touched (see Outcome).

## Evidence gathered before design (2026-10-08)

- `main` = `ec96cdd5b10b2dfd2187ea83d77f1d0cffec4f15` (PR #83). PR #83's post-merge `CI` run **37776352995 succeeded**
  (17m46s). No open PRs. npm and GitHub: the fixed family, including `@forge-cms/s3`, is `0.11.0`. `.changeset/`
  held only two empty changesets. `docs/STATE.md` still said spec 084 was "on branch / PR pending" and `README.md`
  still said "currently `0.8.3` on npm" and omitted `@forge-cms/s3` from the install list — both corrected here.
- `@forge-cms/admin` had **no rendered component tests**: signal `input()`s are not inputs under plain JIT, so
  `TestBed` could not bind a template. The existing admin tests read signals white-box.

## Design

**Test infrastructure.** `@analogjs/vite-plugin-angular@2.4.8` (the version the apps already use) is added to
`packages/admin` as a devDependency with a `vitest.config.ts` (`jit: true`); signal inputs are then real inputs and
`TestBed.createComponent` renders the true templates. Helpers live in `reliability.test-helpers.ts` (excluded from
the build): a hand-settled `ControlledTransport` (never answers on its own, ignores abort — the worst case), fake
`Router`/`ActivatedRoute`, DOM helpers. No new test framework.

**Document editor.**

- `saving` signal; `onSave` returns immediately while saving or while writing is blocked. The form gets two optional
  inputs: `submitting` ("Saving…", submit and Cancel/Escape/backdrop disabled — cancelling mid-write would be
  ambiguous) and `submitDisabled`.
- **Identity.** The form is rendered through `@for (identity of identities(); track identity)` where the key is
  `collection + '/' + (id ?? '#new')`: a new identity _recreates_ the form (clean local edits, clean dirty latch),
  while a failed save, field errors or a same-document reload keep the instance and its edits. No public API.
- **Late save.** If the identity changed while the write was in flight, the write still bumps `ForgeContentRefresh`
  (the data did change) but does not clear dirty, set errors or navigate the editor now showing another document.
- **Document retention.** `loadedDocument` is a `linkedSignal` over `documentRef.value()` that keeps the last value
  for the _same_ identity. Without it a session expiry (a credential-revision reset in C03) swapped the form for a
  loading/error state and destroyed the unsaved edits — reproduced, see Outcome.
- **Blocked writes.** `blockedMessage`: `ForgeAuthSession.expired()` → "session expired … changes are still here";
  a signed-in user who is not `canWriteContent` → "can't edit". Anonymous (`user() === null`, not expired) is _not_
  blocked: whether anonymous writes are allowed is the server's decision. No second auth store.
- **403** → `void session.refresh()` (shared helper `isForbiddenError`); never treated as a sign-out.

**Collection workspace.**

- Query state (`page`, `sort`, `status`, `searchTerm`, debounced search) and per-collection UI state (`deleteTarget`,
  `deleting`, `deleteError`, `actionError`, `statusPending`) are `linkedSignal`s sourced from `collectionSlug`: they
  reset synchronously — before the list request is built — when the slug changes (the router reuses the component for
  `:collection`) and persist across everything else.
- The debounced search callback receives the slug it was armed on and refuses to apply on another collection
  (`.cancel()` in an effect is tidy only).
- `epoch` (also a `linkedSignal` on the slug) is captured by each mutation; an outcome for a past epoch is discarded.
- **Delete:** confirm → `deleting`; success closes the dialog, applies `pageAfterDelete`, reloads once; failure keeps
  the dialog open with the mapped error (the retry path); Cancel/Escape/backdrop are inert while pending.
- **Publish/unpublish:** per-id `statusPending` (list `pendingIds` input → disabled "Publishing…/Unpublishing…");
  no optimistic update; failure shows the error and leaves the real status; success clears the error.
- `ForgeConfirmDialogComponent` gains optional `pending`, `pendingLabel`, `error`.

**Users workspace.** Latest-wins `load()` (token + `AbortController` via `CmsApiService`'s request signal);
`saving`/`deleting`; create/update and delete errors through `describeAdminError` (server `409` messages such as the
last-admin rule are preserved); the form and the delete dialog stay on failure; a successful self-edit calls
`session.refresh()`; `403` refreshes the session. An effect on `isAdmin()` loads when admin and, when permission is
lost, clears rows/dialog (and the form, unless the session merely expired — then the half-typed form is kept and
submit is disabled). Expired sessions show "Session expired" instead of "Access denied".

**Collections index.** Latest-wins `load()` (token + abort); a failed count still shows `—` for that card only.

## Implementation plan

1. Rendered-test infrastructure + red tests for editor, workspace, users, index. 2. Form/editor. 3. Dialog, list,
   workspace. 4. Users workspace, index. 5. tiny-project browser journeys. 6. Docs, changeset, full gates.

## Test plan

Rendered component tests (`*.reliability.test.ts`) over the real components and the real `CmsApiService`/
`ForgeAuthSession`; the existing C03 tests (`content-resources.test.ts`, angular resource/credential tests) are
unchanged and green. Playwright (tiny-project, real server): rejected save keeps values and the retry succeeds once;
search/filter survive an editor round trip + dirty prompt dismiss/accept; delete Cancel sends nothing and the row goes
only after the 204; a session ended by a real server-side logout in another tab makes the next save a real `401`
with the edit still on screen and Save disabled. Demotion (`403` → refreshed `viewer`) is covered by component tests
over the real session (two Playwright accounts would add cost without new behaviour).

## Acceptance criteria

- [x] Document save has an explicit pending state; double submit → one write; dirty is not cleared before success;
      success clears dirty once and navigates once.
- [x] Validation and network/`5xx`/`409` failures preserve entered values; field errors stay by their fields; retry works.
- [x] A → B, edit → new and collection X → Y cannot inherit edits; same-document failure/reload does not wipe them.
- [x] Unsaved-navigation prompt semantics are pinned (clean no prompt, dirty prompts, decline keeps values).
- [x] List query state survives editor round trips; resets on collection change; an old debounce cannot mutate the new one.
- [x] Late mutation responses cannot alter another collection's view; read-resource guarantees stay green.
- [x] Delete: Cancel → no request; Confirm → one request; failure keeps a retry path; row leaves only after success.
- [x] Publish/unpublish cannot double-submit; failure keeps the real status; later success clears the error.
- [x] Users: latest-wins load; single create/update; failure keeps the form; delete is outcome-safe; friendly errors.
- [x] `401` write cannot succeed and does not erase edits; `403` reconciles the role via `ForgeAuthSession`; viewer /
      non-admin controls react to the refreshed role; no second session store; last-admin stays server-authoritative.
- [x] No U02 focus/accessibility work, no U03 custom-mount work; API baseline reviewed; correct changeset; gates pass.

## Open questions

None blocking. U02 owns keyboard/focus (including replacing the native unsaved-changes `confirm`).

## Outcome

**Baseline.** `main` `ec96cdd5b10b2dfd2187ea83d77f1d0cffec4f15`; PR #83 main CI `37776352995` ✓ success; published
`0.11.0`; no open PRs; pending changesets were the two empty ones.

**Reproduced defects (red tests before fixes).**

1. Document save: a double submit issued **two** PUTs (no in-flight guard) and no "Saving…" state.
2. `edit → new`: the child form's local edits **survived** into the create form (the route differs but the form
   instance, and its `edits` signal, were kept).
3. Session expiry: the 401 → anonymous + credential-revision reset swapped the editor form for a loading/error state,
   **destroying the unsaved edit** — the exact thing U01 forbids.
4. Workspace: switching `:collection` reused the component and **leaked** status/sort/page/search into the new
   collection; a pending debounce armed on collection A **applied its term to B's request**.
5. Delete closed its dialog before the request settled: a failure left no retry path and a duplicate confirm could send
   two DELETEs. Publish had no pending state or duplicate guard; `actionError` survived a later success; a late
   delete/publish response for collection A set errors on / reloaded collection B.
6. Users workspace: overlapping `load()`s were last-response-wins; create/update could double-submit; failures showed
   `err.message` (raw provider text); a failed delete replaced the whole table with an error page; losing admin left
   rows (and the form) on screen.

**Disproved / already safe.** `A → B` and `collection X → Y` in the editor already cleared edits — but only
_accidentally_ (the loading state of the new document/meta unmounted the form). The explicit identity key now makes
the invariant structural. `ForgeCollectionsIndexComponent`'s per-card `—` isolation was already correct. The relation
and upload pickers showed no defect in these journeys and were left alone (U02's field-interaction audit covers them).
No generic `@forge-cms/angular` defect: C03 behaved as specified.

**Contracts delivered.** Save state, identity/reset behaviour, failure preservation, unsaved-change contract, query-state
lifetime, delete and publish semantics, users semantics, session/permission behaviour: see Design (all pinned by tests).

**Session expiry / demotion.** `401` → existing `ForgeAuthSession` (anonymous + `expired`) — the editor shows a
"session expired" notice, keeps the form, disables Save; the layout's existing "Log in" link is the way back (no forced
redirect). `403` → one `session.refresh()`; a refreshed `viewer` hides write controls and disables Save; a non-admin
sees "Access denied" with the user list cleared. Signing in again is an explicit user action; a form that outlives a
sign-in as a _different_ user keeps its edits but the retained server snapshot is the old user's view of that
document — acceptable (it was already on screen), and a route change discards it.

**Public API impact.** No new exports (`pnpm check:api` ✓ unchanged, 46 admin exports). Additive optional inputs on
exported components: form `submitting`/`submitDisabled`, confirm dialog `pending`/`pendingLabel`/`error`, list
`pendingIds`. `isForbiddenError` is internal (`admin-error.ts`, not re-exported).

**Changeset / release.** `.changeset/reliable-admin-content-state.md` — `@forge-cms/admin: minor` (new supported
component inputs and behaviour). Fixed family → `pnpm changeset status`: all eleven public packages at **minor** →
expected next npm version **`0.12.0`** (not chosen because of the roadmap name: the semver reason is the added inputs).

**Browser evidence.** tiny-project `golden-path.spec.ts`, 19/19: four new U01 journeys (above) against the real dev
server.

**Review follow-ups (fixed).** `forge-rules-reviewer`/`spec-reviewer` found: the retained editor document could be shown to a different user after sign-in (now carried only for the same user or an `expired` session; plain logout drops it, tested); a save finishing after `A → B → A` could navigate (per-visit counter instead of the key); users mutations finishing after admin loss are discarded (mutation epoch); users shows loading, not "Access denied", while the session bootstraps. Known and accepted: a document deleted remotely while open is only discovered on Save; the editor now instantiates `ForgeAuthSession` (one `/me` bootstrap) if the host had not.

**Gates.** All exit 0 on the final tree (2026-10-08): `format:check`, `lint`, `typecheck`, `test` (admin 103 tests, newly run; 23/27 Turbo tasks cached for unchanged packages), `build` (12/15 cached; admin rebuilt), `check:api` (unchanged baseline), `test:cloudflare`, `test:libsql`, `test:upgrade` (33 tests, Turbo-cached — no input changed), `release:verify`, `release:compat` (Angular 21.2.0/21.2.10/21.2.25), `release:ssr`, `test:s3` (Docker/Garage, profiles stage passed), `e2e:www` 41, `e2e:www:prod` 11, `e2e:tiny-project` 19, `e2e:demo` 29 — Playwright suites newly executed. `pnpm changeset status`: all eleven public packages minor → `0.12.0`. Not run: none skipped.

**Remaining.** U02 — keyboard, focus and existing field interactions; U03 — admin reuse and surface freeze.
