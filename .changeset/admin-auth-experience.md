---
'@forge-cms/angular': minor
'@forge-cms/admin': minor
'@forge-cms/auth': patch
---

feat: Angular/admin auth experience — session, guard, sign-in/up UI, users workspace (spec 054)

- **`@forge-cms/angular` gains a cookie-first browser session.** Every `CmsApiService` request now
  sends `credentials: 'include'` (additive — same-origin fetch already did this by default; this is
  what makes a cross-origin deployment work once CORS allows it). No browser-session code path writes
  to `localStorage`/`sessionStorage` — the existing `authToken` Bearer path is unaffected, for
  machine/API-key consumers. New `signup()`/`logout()` methods alongside the existing `login()`
  (unchanged shape). `login`/`signup`/`logout` now throw the new `ApiAuthActionError` (`code`,
  `message`, `status`) carrying the server's own curated message instead of a generic string.
- **New `ForgeAuthSession`** (`providedIn: 'root'`) — signals-based session state: `user`, `status`
  (`'loading' | 'authenticated' | 'anonymous' | 'error'`), `authenticated`, `loading`, `error`,
  `expired`, plus `login()`/`signup()`/`logout()` (none throw — check `authenticated()`/`error()`
  after) and `refresh()`/`ready()`. Bootstraps via exactly one `/api/auth/me` call regardless of how
  many guarded routes mount concurrently. A `401` on any request while authenticated flips the session
  to `anonymous`/`expired` without polling; a `403` never touches it.
- **New `forgeAuthGuard(options?)`** — a functional `CanActivateFn`. Awaits the session's bootstrap,
  redirects an anonymous visitor to `signInPath` (default `/admin/login`) with a `returnUrl`, and
  — with `roles` — redirects an authenticated-but-unauthorized visitor to `forbiddenPath` (default
  `/admin`). UX only: every check is redundant with, never a substitute for, server-side enforcement.
- **`@forge-cms/admin` gains `ForgeSignInComponent`/`ForgeSignUpComponent`** — reusable sign-in/sign-up
  pages (Volt UI, signals, accessible show/hide password toggle, `autocomplete`). Sign-up's input has
  no `role` field at all — structurally, not just visually, impossible to smuggle one through. **New
  `forgeAdminAuthRoutes({ signup? })`** mounts `login` (and `signup` only when explicitly enabled,
  matching `handleSignup`'s own opt-in default) with the same zero-assumption convention as
  `forgeAdminContentRoutes()`.
- **New `ForgeUsersWorkspaceComponent`** — list/create/edit/delete users and reset a password
  (`updateUser(id, { password })`, already policy-checked), ported from `apps/www`'s app-local
  `UsersPage` onto the dedicated `/api/auth/users*` primitives (never the generic collection editor —
  `passwordHash` has no path to reach it). Adds last-admin UX on top: the sole admin's own
  delete/demote controls are disabled with an explanation, mirroring the new server-side invariant
  below.
- **`ForgeAdminLayoutComponent`** now reads `ForgeAuthSession` instead of a hardcoded
  `localStorage.getItem('forge-auth-token')` check — its "Log out" button previously cleared only that
  local flag without ever calling the server logout endpoint, leaving the session cookie live; it now
  calls `session.logout()` for real. New `ForgeAdminConfig.signInPath` (default `/admin/login`)
  controls where "Log in" and the post-logout redirect go, for a host whose sign-in route predates
  `forgeAdminAuthRoutes()`'s convention.
- **Last-admin invariant, `@forge-cms/auth`.** `UsersCollectionAuthAdapter.updateUser`/`deleteUser` now
  reject (a new `UserMutationError`, `reason: 'last-admin' | 'weak-password'`) any change that would
  leave the installation with zero admins — the sole admin demoting or deleting themselves, or being
  demoted/deleted by another admin — and reject a password-reset shorter than the configured policy
  (previously unchecked on `updateUser`, only on `createUser`/`signup`). A second admin makes both
  operations succeed normally again.
- No behavior change to machine auth, the typed Local API, or any HTTP response shape for an existing,
  still-passing request. `apps/demo-aesthetics`'s own hand-rolled login/users UI is untouched — only its
  server `login.post.ts`/`me.get.ts` (previously hand-rolling `auth.login()`/`requireAuth()` directly and
  never setting a session cookie) were brought onto `handleLogin`/`handleMe`, and a new `logout.post.ts`
  added — required for the shared package's cookie-based client to work against that app at all.
