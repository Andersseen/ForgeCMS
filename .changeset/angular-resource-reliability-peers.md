---
'@forge-cms/angular': patch
'@forge-cms/admin': patch
---

Angular resource reliability and proven peer ranges (spec 077, roadmap 0.8 C03).

**Resources** (`collectionResource`, `documentResource`) — same public API, deterministic behaviour:

- A superseded request (new params, `reload()`, params → `undefined`, owner destroyed, credential
  change) is **aborted** through its `AbortSignal`, and can never write `value`/`error`/`isLoading`
  afterwards — even with a custom transport that ignores the signal.
- **Fixed:** when params became `undefined`, the in-flight request could still fill the resource
  afterwards. Idle now resets `value()` and `error()` and invalidates the request.
- **Behaviour change:** `value()` resets to `undefined` when the request changes (another query, page,
  id) instead of showing the previous request's result while the new one loads. `reload()` (same
  request) still keeps the value while loading. A failure clears `value()`; an abort is never an
  `error()`. Nothing is retried.
- **Credentials:** every sign-in, sign-up, sign-out (even a failed one), first `401` while signed in,
  or `refresh()` that finds another user immediately hides resource values and reloads them under the
  new identity; a request started as user A can never fill a resource after the switch. An
  `authToken` function that reads a signal is observed the same way.

**Admin:** the document editor resets its unsaved-changes flag and save errors when the edited
document changes (A → B, edit → new), and never shows document A while B loads.

**Peers are now ranges proven by `pnpm release:compat`** (strict installs of packed tarballs, single
Angular copy, `tsc` + `ngc` strict templates, linked production build):

- `@forge-cms/angular`: `@angular/core`/`@angular/router` `^21.0.0 || ^22.0.0` (was exactly `21.2.10`).
- `@forge-cms/admin`: `@angular/*` `^21.2.0`, `rxjs` `^7.8.0`, `@voltui/components` `^1.0.1`,
  `lumen-icons` `^0.2.0`, optional `@babel/core` `^7.28.0` and `vite` `^7.0.0 || ^8.0.0` (were exact
  pins that the first-party apps' own versions — VoltUI 1.1.0, rxjs 7.8.2, Vite 7.1.4 — did not satisfy).

**New `@forge-cms/angular/vite`:** the Angular linker Vite plugin moved here from `@forge-cms/admin/vite`
(which re-exports it unchanged), because a Vite/Analog app using only `@forge-cms/angular` also needs
it — without it, its production build crashed with `JIT compiler unavailable`. Optional peers:
`@angular/compiler-cli`, `@babel/core` (`^7.28.0 || ^8.0.0`; Angular 22 needs Babel 8), `vite`.
