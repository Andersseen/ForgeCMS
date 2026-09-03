# 054 — Angular/Admin auth experience

- **Status:** done
- **Author:** maintainer direction (Andrii), drafted by agent
- **Date:** 2026-09-03
- **Branch:** feature/admin-auth-experience
- **Affected packages/apps:** `@forge-cms/angular`, `@forge-cms/admin`, `@forge-cms/auth`, `apps/www`, `apps/demo-aesthetics`

## Context / Why

Spec 053 shipped the server-side contract — `forge_session` HttpOnly cookies, CSRF protection,
`handleLogin`/`handleSignup`/`handleLogout`/`handleMe`, `defineUsersCollection()` — and explicitly
deferred everything client-side ("Any Angular/admin UI, client SDK auth methods, or route guards... a
follow-up spec") and one invariant ("last admin can't demote/delete themselves... left for whichever
spec first builds user-management UX"). Both are now due.

An audit of `packages/angular`, `packages/admin`, `apps/www`, and `apps/demo-aesthetics` (see Outcome
for the full findings) found the shared packages are **still on the pre-053 model**: `CmsApiService`
sends no cookie credentials on any request, `ForgeAdminLayoutComponent`'s login state is a hardcoded
`localStorage.getItem('forge-auth-token')` check whose "Log out" button never calls
`POST /api/auth/logout` (the session cookie survives a "logout" untouched — a real bug, not just
duplication), and there is no route guard anywhere in the repo — `apps/www/e2e/admin-crud.spec.ts`
already proves an anonymous visitor can navigate straight to `/admin/collections/posts`. A working,
non-generic `/admin/users` page already exists in `apps/www` (dedicated `@forge-cms/angular` auth
methods, not the generic collection editor — `passwordHash` never leaks), but it is duplicated
near-identically in `apps/demo-aesthetics` and has zero server-side protection against emptying the
admin set. `apps/demo-aesthetics`'s own `login.post.ts`/`me.get.ts` were never migrated to spec 053's
handlers at all — its login route sets no cookie — which would silently break the moment the shared
client relies on cookies instead of `localStorage`.

## Goal

`@forge-cms/angular` exposes a signals-based, cookie-aware auth session and route guard; `@forge-cms/admin`
exposes reusable sign-in, optional sign-up, and users-management UI built on them; `apps/www` dogfoods all
of it in place of its hand-rolled equivalents; and the users-collection adapter enforces that no
operation can leave a Forge installation with zero admins.

## Non-goals

- OAuth/social login, password reset emails, email verification, MFA, passkeys, magic links, teams,
  organizations, dynamic/custom RBAC beyond the existing `admin`/`editor`/`viewer` roles.
- A generic active/inactive user-status system — the `users` collection has no such field today and
  none is added in this branch (last-admin safety is keyed on `role`, not status).
- Moving authorization policy into Angular — the guard and nav-hiding are UX; every check they perform
  is redundant with, never a substitute for, server-side `access`/`requireRole` enforcement.
- SSR auth/transfer-state hydration — session bootstrap is a client-side `GET /api/auth/me` call behind
  a `loading` state, not a server-rendered auth payload.
- A second server error-reason system — the client surfaces the server's own curated
  `authFailureResponse`/`ForgeApiErrorBody` messages (spec 053) rather than re-deriving its own copy
  for the same failures.
- Publishing, version reconciliation, or the `0.0.2`-vs-manifest divergence — explicitly deferred to the
  future v0.1.0 readiness audit.
- Fully migrating `apps/demo-aesthetics`'s hand-rolled login/users UI to the new package components —
  only its **server** auth routes are brought up to spec 053's contract (required for the cookie session
  to function at all now that the shared client sends `credentials: 'include'`); its client pages are
  left as-is, per CLAUDE.md's demo-findings rule (no `packages/*`-driven behavior change should be
  "fixed" by silently reworking the demo instead).
- Enabling public signup on the real deployed `apps/www`/`apps/demo-aesthetics` by default — see Design
  §7.

## Design

### 1. `CmsApiService` — cookie credentials + new methods (`packages/angular/src/api.service.ts`)

Every `fetch()` call gains `credentials: 'include'` (currently none do — same-origin fetch already
sends cookies by default, but an embeddable admin is not guaranteed to be same-origin as its API, and
being explicit is what makes cross-origin deployments work at all once CORS is configured for them).
This is additive: existing `Authorization: Bearer` machine/API-key flows are unaffected.

```ts
async signup(input: { email: string; password: string; name?: string }): Promise<{ token: string; user: AuthUser }>;
// POST /api/auth/signup, credentials: 'include'. Same response shape as login().

async logout(): Promise<void>;
// POST /api/auth/logout, credentials: 'include'. Always resolves (204 is success; a network/CSRF
// failure still clears local session state — see ForgeAuthSession.logout()).
```

`login()` keeps its exact existing signature and `{ token, user }` return shape (Bearer-compatible,
unchanged) — it now also relies on the browser storing the `Set-Cookie` the server already sends. No
consumer is required to use `token` for anything; `ForgeAuthSession` (below) ignores it and trusts the
cookie.

**Error surfacing fix**, needed for §6/§8 below to show real messages instead of `"Failed to update
user: 409"`: `createUser`/`updateUser`/`deleteUser`/`getUsers` hit `apps/*`'s hand-rolled
`users/[id].{put,delete}.ts` routes, which throw h3 `createError({ statusCode, statusMessage })` — a
different JSON shape (`{ statusMessage, message, ... }`) than the Forge envelope
(`{ error: { code, message } }`) the generic collection routes return. The existing private
`toApiError` only ever reads `body.details`/falls back to a generic `"<fallback>: <status>"` string, so
today's server `statusMessage` (e.g. a real validation reason) never reaches the UI. Fixed by also
checking `body.statusMessage ?? body.message` as a text source before the generic fallback — additive,
doesn't change any path that already worked (`ApiValidationError`'s `details` branch is untouched).

**401 tracking**, needed for §3's session-expiry transition: `toApiError` becomes a private instance
method (was a free function) so it can bump a new signal when it produces `ApiAuthError`:

```ts
readonly unauthorized: Signal<number>; // read-only counter, bumped once per observed 401
```

`ForgeAuthSession` watches this to detect "an authenticated session's request just got a 401" without
polling `/api/auth/me` in a loop (see §3). This is the one new piece of shared mutable state in the
service — everything else stays pure per-call `fetch`.

### 2. New shared types (`packages/angular/src/types.ts`)

```ts
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** Thrown by login/signup/logout on a non-2xx response carrying the server's own Forge error envelope. */
export class ApiAuthActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiAuthActionError';
  }
}
```

`login`/`signup`/`logout` throw `ApiAuthActionError` (not the generic `Error` other write methods
throw) — its `.message` is always the exact curated text from spec 053's `authFailureResponse` table
(`'Invalid email or password'`, `'Email is already in use'`, `'Signup is disabled'`, ...), safe to show
directly (Non-goals: no second error-reason system).

### 3. `ForgeAuthSession` — signals-based session state (`packages/angular/src/auth-session.ts`, new)

```ts
export type ForgeAuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'error';

@Injectable({ providedIn: 'root' })
export class ForgeAuthSession {
  readonly user: Signal<AuthUser | null>;
  readonly status: Signal<ForgeAuthStatus>;
  readonly authenticated: Signal<boolean>; // computed: status() === 'authenticated'
  readonly loading: Signal<boolean>; // computed: status() === 'loading'
  readonly error: Signal<Error | null>;
  /** `true` only when the session just transitioned authenticated → anonymous via a 401, not on a
   *  plain unauthenticated bootstrap or a user-initiated logout. Cleared on the next successful login. */
  readonly expired: Signal<boolean>;

  /** Re-runs the `/api/auth/me` bootstrap. Also the promise the guard awaits before its first check. */
  refresh(): Promise<void>;
  ready(): Promise<void>; // resolves once the *initial* bootstrap has settled past 'loading'
  login(email: string, password: string): Promise<void>; // never throws — check authenticated()/error() after
  signup(input: { email: string; password: string; name?: string }): Promise<void>; // same contract
  logout(): Promise<void>; // never throws — always clears local state even if the request fails
}
```

- **Bootstrap:** the constructor calls `refresh()` once and keeps that promise for `ready()` — the
  guard (§5) awaits it instead of re-triggering `/api/auth/me`, so a page refresh does exactly one
  session check no matter how many guarded routes exist (closes the "flash of anonymous admin, then
  suddenly authenticated" gap from the brief and the "repeated `/me` calls" risk).
- **`login`/`signup` set state directly** from the response's `user` (no follow-up `/me` call) and clear
  `expired`. On failure they set `error` and leave `status` at `'anonymous'` — they resolve, never
  reject, so a sign-in form never needs its own try/catch; it reads `session.error()` reactively.
- **401 downgrade:** an `effect()` watches `api.unauthorized()`; when it increments while
  `status() === 'authenticated'`, the session sets `user: null`, `status: 'anonymous'`, `expired: true`
  — no network call, no loop. A `403` never reaches here (`toApiError` only special-cases `401` into
  `ApiAuthError`; a `403` stays a plain `Error`), so a forbidden single operation never logs anyone out
  (brief requirement, and acceptance criterion 14 below).
- **`logout()`** calls `api.logout()` in a `try/finally` — cookie-clear failure (network error) still
  clears local `user`/`status`, since the point of logging out client-side is "stop presenting this
  browser as authenticated," which must not depend on the network round-trip succeeding.

### 4. `packages/angular/src/index.ts` — new exports

```ts
export { ForgeAuthSession, type ForgeAuthStatus } from './auth-session.js';
export { forgeAuthGuard, type ForgeAuthGuardOptions } from './auth-guard.js';
export { ApiAuthActionError, type ApiErrorBody } from './types.js'; // alongside existing type exports
```

### 5. `forgeAuthGuard()` (`packages/angular/src/auth-guard.ts`, new)

```ts
export interface ForgeAuthGuardOptions {
  /** Restrict to these roles on top of "must be authenticated". Omit to allow any authenticated user. */
  roles?: UserRole[];
  /** Redirect target for an anonymous visitor. Defaults to '/admin/login'. */
  signInPath?: string;
  /** Redirect target for an authenticated visitor failing the role check. Defaults to '/admin'. */
  forbiddenPath?: string;
}

export function forgeAuthGuard(options?: ForgeAuthGuardOptions): CanActivateFn;
```

Behavior: `inject(ForgeAuthSession)` and `await session.ready()` (resolves the _shared_ bootstrap
promise — no duplicate `/me` call even with several guarded route subtrees active). Then: not
authenticated → `router.createUrlTree([signInPath], { queryParams: { returnUrl: state.url } })`;
authenticated but `roles` given and the user's role isn't in it → `createUrlTree([forbiddenPath])`;
otherwise `true`. A functional guard (`CanActivateFn`), Angular Router's own primitive — no routing
framework, per the brief's explicit constraint.

### 6. `ForgeSignInComponent` / `ForgeSignUpComponent` (`packages/admin/src/signin.component.ts`,

`signup.component.ts`, new)

```ts
@Component({ selector: 'forge-sign-in', ... })
export class ForgeSignInComponent {
  readonly signUpPath = input<string>(); // set via route `data`, see §9 — omit to hide the link entirely
  readonly redirectTo = input('/admin');
}

@Component({ selector: 'forge-sign-up', ... })
export class ForgeSignUpComponent {
  readonly redirectTo = input('/admin');
}
```

Both: `email`/`password` (`ForgeSignUpComponent` adds `name`), `VoltCard`/`VoltInput`/`VoltLabel`/
`VoltButton`/`VoltError` (matching `apps/www`'s current hand-rolled login page's primitives — same
package, same import paths), submit disabled while `session.loading()`, error text from
`session.error()?.message`, and on success `router.navigateByUrl(returnUrl ?? redirectTo())` where
`returnUrl` comes from the query param the guard attached. `ForgeSignUpComponent`'s form has **no role
field** — its `session.signup()` call only ever sends `{ email, password, name }`, so there is no code
path through which a role could be attached even if a field were added later by mistake (structural,
matching `handleSignup`'s own contract, not a UI convention).

**Password field (both forms):** `type="password"`/`type="text"` toggle button,
`aria-label="Show password"`/`"Hide password"` (flips with state), `autocomplete="current-password"`
(sign-in) / `"new-password"` (sign-up) — no separate password-input component, per Non-goals.

**Session-expiry banner:** `ForgeSignInComponent` shows a fixed line ("Your session has expired — please
sign in again.") when `session.expired()` is true on mount, distinct from a login-attempt failure
(`session.error()`), which only appears after a submit.

### 7. Signup enablement — both ends must agree, off by default

`handleSignup`'s `enabled` flag (spec 053) already defaults an app to no live signup route unless the
app wires one. This branch keeps that posture for both apps' **real deployments**: `apps/www` and
`apps/demo-aesthetics` each gain a real `signup.post.ts` (thin wrapper over `handleSignup`, matching
`login.post.ts`'s shape exactly), but `enabled` reads an environment flag —
`env.FORGE_ENABLE_SIGNUP === '1'` — that is unset (**disabled**) by default, the same "opt-in via env,
safe default" shape `AUTH_SECRET`/`devMode` already use in this codebase. Each app's own mounted
`forgeAdminAuthRoutes()` call passes `signup:` from that same flag, so the UI route doesn't exist at all
when the server route would 404 anyway (brief: "if signup is disabled, do not render a dead signup
link" — enforced structurally, not just by hiding a link). E2E coverage for the signup flow (brief §27)
sets `FORGE_ENABLE_SIGNUP=1` on the Playwright `webServer` env for one dedicated spec/project, never on
the app's real deploy config.

### 8. `ForgeUsersWorkspaceComponent` (`packages/admin/src/users-workspace.component.ts`, new)

Ports `apps/www/src/app/pages/admin/users/users.page.ts` (already dedicated-`AuthUser`-typed, already
proven never to touch `passwordHash` or the generic collection editor — see audit) into
`@forge-cms/admin`, unchanged in spirit, plus:

- **Last-admin UX** (brief §20, defense-in-depth alongside §9's server enforcement): computed
  `adminCount = computed(() => this.users().filter(u => userRole(u) === 'admin').length)`. A row is
  "the sole admin" when `userRole(row) === 'admin' && adminCount() === 1`. For that row: the delete
  button is `[disabled]` with a tooltip/`aria-label` explaining why, and the role `<select>` in its edit
  form is disabled on the `admin` option specifically (changing away from admin is blocked) —
  presentational only; §9's `UserMutationError` is the real backstop if a client is bypassed.
  Delete still goes through the existing `ForgeConfirmDialogComponent` pattern (already used by the
  content workspace) instead of `window.confirm`.
- **Self-action clarity**: when a row's `id === session.user()?.id`, its delete/demote controls show
  "(you)" and the same disabled+explanation treatment when doing so would remove the caller's own admin
  access — same mechanism as the sole-admin case (a self-demoting sole admin hits both conditions at
  once, one message).
- Errors from create/update/delete surface via the §1 error-message fix (so a blocked last-admin
  operation shows "Cannot remove the last remaining admin" verbatim, not a generic failure string).
- Otherwise unchanged: `getUsers`/`createUser`/`updateUser`/`deleteUser` are already exactly the right
  primitives (brief §14's audit conclusion: generic collection CRUD is correctly _not_ used here, and no
  new endpoint is needed for password reset — `updateUser({ password })` already exists and already
  never routes through the generic document editor, brief §16/§17's audit conclusion).

### 9. Last-admin invariant — `packages/auth/src/users-collection.adapter.ts`

```ts
export type UserMutationFailureReason = 'last-admin' | 'weak-password';

export class UserMutationError extends Error {
  constructor(
    message: string,
    readonly reason: UserMutationFailureReason
  ) {
    super(message);
    this.name = 'UserMutationError';
  }
}
```

`updateUser(id, input)`: if `input.password` is set, it's now checked against `passwordPolicy` (it
never was — a real gap for an admin-driven password reset specifically, found while designing this
spec's §8) and throws `UserMutationError(..., 'weak-password')` if too short. If `input.role` is set to
something other than `'admin'` **and** the target's current role is `'admin'` **and** they're the only
admin (`countAdmins(db) <= 1`), throws `UserMutationError(..., 'last-admin')` before writing anything.

`deleteUser(id)`: now fetches the record first; if its role is `'admin'` and `countAdmins(db) <= 1`,
throws the same error instead of deleting. Covers all four scenarios in the brief's audit (self-delete,
deleted-by-another-admin, self-demote, demoted-by-another-admin) with one check reused from both
methods — no status system, no policy engine, matching the brief's explicit scope limit.

`UserMutationError` is exported from `@forge-cms/auth`'s `index.ts` alongside the existing
`ForgeAuthError`.

### 10. Route-handler error mapping — `apps/www` and `apps/demo-aesthetics`

`users/[id].put.ts` and `users/[id].delete.ts` (both apps, four files) wrap their existing
`auth.updateUser`/`auth.deleteUser` call in a `catch` that maps `UserMutationError` to a status:
`'last-admin'` → `409`, `'weak-password'` → `400`, using `err.message` as `statusMessage` (matching
these routes' existing h3-`createError` style — they don't go through `handlers.ts`'s Forge envelope
today and this branch doesn't change that, only §1's client fix makes the message reach the UI either
way).

### 11. `forgeAdminAuthRoutes()` (`packages/admin/src/auth-routes.ts`, new)

```ts
export interface ForgeAdminAuthRoutesOptions {
  /** Mount the sign-up route. Defaults to `false` — structurally absent unless enabled (see §7). */
  signup?: boolean;
}

export function forgeAdminAuthRoutes(options?: ForgeAdminAuthRoutesOptions): Routes;
```

Same zero-assumption convention as `forgeAdminContentRoutes()` — no base path, spreadable into a host's
own `Routes`. Returns `[{ path: 'login', component: ForgeSignInComponent, data: options?.signup ? { signUpPath: 'signup' } : {} }, ...(options?.signup ? [{ path: 'signup', component: ForgeSignUpComponent }] : [])]`.
The `data.signUpPath` binds to `ForgeSignInComponent`'s `signUpPath` input via Angular's
`withComponentInputBinding()` (already enabled in `apps/www`'s router config) — no new wiring mechanism.

### 12. `ForgeAdminLayoutComponent` — consume the session (`packages/admin/src/layout.component.ts`)

Replaces its local `currentUser` signal, `loadCurrentUser()`, hardcoded `AUTH_TOKEN_KEY`, and the
broken `isLoggedIn()`/`logout()` with `private readonly session = inject(ForgeAuthSession)`:
`currentUser` → `this.session.user`, `isLoggedIn()` → `this.session.authenticated()`, `logout()` →
`async () => { await this.session.logout(); await this.router.navigate(['/admin/login']); }`
(previously a hard `window.location.reload()`; now an actual navigation once state is already cleared
client-side and the cookie is cleared server-side). `visibleItems()`'s `canManageUsers(this.currentUser())`
gate is unchanged in behavior, just reads `this.session.user()`.

### 13. `apps/www` dogfooding

- `app.routes.ts`/`admin.routes.ts` restructured to the brief's suggested composition:
  ```ts
  export const ADMIN_ROUTES: Routes = [
    ...forgeAdminAuthRoutes({ signup: false }), // /admin/login (signup gated per §7)
    {
      path: '',
      component: ForgeAdminLayoutComponent,
      canActivate: [forgeAuthGuard()],
      children: [
        { path: '', loadComponent: () => ... /* dashboard, unchanged */ },
        ...forgeAdminContentRoutes(),
        { path: 'media', ... /* unchanged */ },
        {
          path: 'users',
          component: ForgeUsersWorkspaceComponent,
          canActivate: [forgeAuthGuard({ roles: ['admin'] })]
        },
        { path: 'api', ... }, { path: 'settings', ... }
      ]
    }
  ];
  ```
  `/login` becomes `/admin/login` (this app's own URL, not a stable package surface — updated
  everywhere it's referenced, including e2e). The app-local `LoginPage`
  (`apps/www/src/app/pages/login/login.page.ts`) and `UsersPage`
  (`apps/www/src/app/pages/admin/users/users.page.ts`) are deleted — fully replaced.
- `app.config.ts` drops `authToken: () => localStorage.getItem('forge-auth-token')` from
  `provideForgeCms(...)` — dead now that the browser session is cookie-based; `CmsApiService`'s
  Bearer-header path stays fully functional for any consumer that does pass `authToken` (machine
  clients, or a future non-cookie embed).
- `apps/www/src/server/middleware/auth.ts` is deleted — confirmed dead by the audit (`event.context.forgeUser`
  has zero readers anywhere in the repo; every real route re-derives auth itself already).
- New `apps/www/src/server/routes/api/auth/signup.post.ts` per §7.

### 14. `apps/demo-aesthetics` companion fix (server only, per Non-goals)

- `login.post.ts` rewritten as a thin `handleLogin` wrapper (currently hand-rolls `auth.login()` with no
  `Set-Cookie` at all — the actual bug this spec must fix for the shared cookie-based client to work
  against this app).
- `me.get.ts` rewritten as a thin `handleMe` wrapper (currently hand-rolls `requireAuth` directly — works
  today only because it happens to accept the same request shape; switched for consistency and so a
  future auth-handler change can't silently diverge between apps again).
- New `logout.post.ts` (didn't exist at all).
- New `signup.post.ts`, same env-gated `enabled` pattern as §7 (independent flag/value from `apps/www`'s).
- `users/[id].put.ts`/`.delete.ts` gain the same `UserMutationError` mapping as §10.
- Its own `login.page.ts`/`users.page.ts`/`app.routes.ts` are **not** touched (Non-goals) — they keep
  working unmodified once the server sets a real cookie, since `CmsApiService.login()`'s response shape
  is unchanged.

## Implementation plan

- [x] `packages/angular`: `credentials: 'include'` on every `fetch`; `toApiError` → private instance
      method with `statusMessage`/`message` fallback text and `unauthorized` signal bump; `signup()`,
      `logout()`.
- [x] `packages/angular/types.ts`: `ApiErrorBody`, `ApiAuthActionError`.
- [x] `packages/angular`: `auth-session.ts` (`ForgeAuthSession`), `auth-guard.ts` (`forgeAuthGuard`);
      export both from `index.ts`.
- [x] `packages/auth/users-collection.adapter.ts`: `UserMutationError`, `countAdmins`, last-admin check
      in `updateUser`/`deleteUser`, password-policy check added to `updateUser`; export from `index.ts`.
- [x] `packages/admin`: `signin.component.ts`, `signup.component.ts`, `users-workspace.component.ts`,
      `auth-routes.ts` (`forgeAdminAuthRoutes`); export all from `index.ts`.
- [x] `packages/admin/layout.component.ts`: switch to `ForgeAuthSession`; drop `AUTH_TOKEN_KEY`/
      `isLoggedIn`/old `logout`.
- [x] `apps/www`: restructure `admin.routes.ts`/`app.routes.ts` per Design §13; delete `login.page.ts`,
      `pages/admin/users/users.page.ts`, `server/middleware/auth.ts`; drop `authToken` from
      `app.config.ts`; add `signup.post.ts`.
- [x] `apps/demo-aesthetics`: rewrite `login.post.ts`/`me.get.ts`, add `logout.post.ts`,
      `signup.post.ts`; add `UserMutationError` mapping to `users/[id].{put,delete}.ts`.
- [x] Tests: `packages/auth` unit tests (last-admin: self-delete/deleted-by-admin/self-demote/demoted-by-
      admin, all rejected; weak password on update rejected; a second admin can still be deleted/demoted
      freely); `packages/angular` unit tests (`ForgeAuthSession` state transitions incl. 401 downgrade
      and `ready()` single-bootstrap guarantee, `forgeAuthGuard` redirect/role branches, `CmsApiService`
      new methods/credentials); `packages/admin` component tests (`ForgeSignInComponent`/
      `ForgeSignUpComponent` incl. no-role-field, `ForgeUsersWorkspaceComponent` last-admin UI gating).
- [x] `apps/www/e2e`: update `admin-crud.spec.ts`/`rbac.spec.ts`/`users.spec.ts` for the `/admin/login`
      URL and cookie-based session (drop the `localStorage` token reads `rbac.spec.ts` used for manual
      `page.request` auth); new `auth.spec.ts` (guard redirect, cookie survives reload, logout actually
      clears the session, session-expiry redirect).
- [x] `apps/demo-aesthetics`: new `e2e/` directory, `auth.spec.ts` (signin/guard/logout journey) and
      `signup.spec.ts` (run with `FORGE_ENABLE_SIGNUP=1`, per Design §7).
- [x] Docs: `apps/www/src/content/docs/browser-auth.md` gains an Angular/admin usage section (or a new
      linked page) showing the copyable setup from the brief's §32.
- [x] Changesets: `@forge-cms/angular` (minor), `@forge-cms/admin` (minor), `@forge-cms/auth` (patch —
      new export + hardening, no breaking signature change).
- [x] `docs/STATE.md`/`docs/ROADMAP.md` updated; spec marked `done` with outcome note.

## Test plan

- `pnpm --filter @forge-cms/auth test` — last-admin + weak-password-on-update suites green.
- `pnpm --filter @forge-cms/angular test` — session/guard/service suites green.
- `pnpm --filter @forge-cms/admin test` — new component suites green.
- `pnpm e2e:www` — full suite green including the rewritten auth-affected specs and new `auth.spec.ts`.
- New `apps/demo-aesthetics` e2e run (its own Playwright config) — `auth.spec.ts` green;
  `signup.spec.ts` green only with `FORGE_ENABLE_SIGNUP=1` set.
- Manual: `pnpm dev:www` → visit `/admin/collections` anonymously → redirected to `/admin/login` →
  log in → land back on `/admin/collections` → refresh the browser → still authenticated (cookie, no
  form re-fill) → open `/admin/users` as the seeded admin → create an editor → log out → confirm (via
  devtools) the `forge_session` cookie is gone → log in as the new editor → `/admin/users` redirects to
  `/admin` (role-gated guard).
- Full gates: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`, plus
  `pnpm test:cloudflare` and `pnpm release:verify` (extended per the brief's §31 to compile
  `ForgeAuthSession`/`forgeAuthGuard`/`ForgeSignInComponent`/`ForgeSignUpComponent`/
  `ForgeUsersWorkspaceComponent`/`forgeAdminAuthRoutes` through the packed public exports only).

## Acceptance criteria

1. `CmsApiService`'s `login`/`signup`/`logout`/`getCurrentUser`/every collection method sends
   `credentials: 'include'`; no browser-session code path writes to `localStorage`/`sessionStorage`.
2. `ForgeAuthSession.ready()` resolves exactly once per app load regardless of how many guarded routes
   mount concurrently (proven by a test asserting `getCurrentUser` is called exactly once).
3. A page reload on a route behind `forgeAuthGuard()` while a valid session cookie exists never shows an
   anonymous flash before the guard resolves (guard awaits `ready()` before deciding).
4. `forgeAuthGuard()` redirects an anonymous visitor to `signInPath` (default `/admin/login`) with
   `returnUrl` set to the attempted URL; a successful sign-in navigates back to it.
5. `forgeAuthGuard({ roles: ['admin'] })` redirects an authenticated non-admin to `forbiddenPath`
   (default `/admin`) without ever calling any users-management endpoint.
6. `ForgeSignUpComponent`'s submitted payload never contains a `role` key under any input, including a
   crafted DOM/value injection — the component's own type has no such field to populate.
7. Signup UI/route is absent entirely (not just hidden) when `forgeAdminAuthRoutes()` is called without
   `signup: true`; the corresponding server route 404s the same way when its `enabled` env flag is unset.
8. Logging out calls `POST /api/auth/logout`; a subsequent `GET /api/auth/me` returns 401/`null`
   (session cookie actually cleared, not just local state).
9. A request that gets a `401` while `status()` is `'authenticated'` transitions the session to
   `'anonymous'` with `expired() === true`; a `403` from any request never changes `status()`.
10. `UsersCollectionAuthAdapter.deleteUser`/`updateUser` reject (via `UserMutationError`, reason
    `'last-admin'`) every one of: the sole admin deleting themselves, another admin deleting the sole
    admin, the sole admin demoting themselves, another admin demoting the sole admin. The same calls
    succeed when a second admin exists.
11. `updateUser` rejects a password shorter than the configured policy with `UserMutationError`, reason
    `'weak-password'`; the users-workspace UI surfaces the exact server message for both this and the
    last-admin rejection (not a generic "Failed to update user" string).
12. `passwordHash` is not present on any type/response reachable from `@forge-cms/admin`'s or
    `@forge-cms/angular`'s public exports (regression test asserting `AuthUser`'s shape and that
    `ForgeUsersWorkspaceComponent` never imports the generic `ForgeCollectionForm`/`ForgeFieldControlComponent`).
13. An editor/viewer's crafted `PUT /api/auth/users/:id` with `{ role: 'admin' }` is rejected `403`
    before reaching `updateUser` at all (unchanged spec-053 behavior — regression-tested here again
    against the new route/guard wiring to prove nothing in this branch weakened it).
14. `apps/demo-aesthetics`'s `login.post.ts` sets the `forge_session` cookie (it didn't before this
    branch); its `me.get.ts`/new `logout.post.ts` round-trip correctly against that cookie.
15. Every existing `apps/www`/`apps/demo-aesthetics` functionality unrelated to auth (content admin,
    spec 052 workspace, media, public pages) is unaffected — proven by the full existing test/e2e suites
    passing, not just the new auth-specific ones.
16. `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build` green; `pnpm test:cloudflare`
    and `pnpm release:verify` green with the extended packed-consumer assertions from the Test plan.
17. Changesets present for `@forge-cms/angular`, `@forge-cms/admin`, `@forge-cms/auth`; `docs/STATE.md`/
    `docs/ROADMAP.md` updated; no Glossa-specific behavior, no OAuth/MFA/reset-email, no unrelated
    feature expansion.

## Open questions

None — every decision point raised during design (credentials mode, error-envelope mismatch between
`handlers.ts` and the hand-rolled user routes, signup enablement default, last-admin error shape,
`/login` → `/admin/login` URL change) is resolved above rather than left pending, per the maintainer's
brief already constituting approval to proceed directly to implementation.

## Outcome

Implementation complete on `feature/admin-auth-experience`, committed, all gates green. Full detail is
also recorded in `docs/STATE.md`'s 2026-09-03 entry; this section focuses on what diverged from the
Design as written, since that's what a future reader most needs.

**Design decisions made during implementation, not fully specified up front:**

1. §7's signup-enablement mechanism (`FORGE_ENABLE_SIGNUP` env var, checked via both
   `event.context.cloudflare?.env` and `process.env`) was chosen during implementation to satisfy the
   brief's "opt-in, never live in production merely for testing" constraint without adding a second
   config system — not fully nailed down in the original Design pass.
2. §13's apps/www `/login` → `/admin/login` URL change, and the corresponding `ForgeAdminConfig.signInPath`
   addition needed to keep `apps/demo-aesthetics`'s own `/login` working (see finding 3 below), were
   both decided while implementing, not anticipated in the initial audit.

**Three real bugs found only by actually driving a real browser (Playwright MCP tools), not by the
automated e2e suite alone — which was itself initially green against a _stale_ reused dev server
process from before these fixes, the exact "stale reused server masks real behavior" pitfall spec 053's
own Outcome section already flagged. Recorded in full because each is a reusable lesson for this
codebase, not just a fix:**

1. **Angular Router's `withComponentInputBinding()` clobbers `input()` defaults on any route-mounted
   component.** `RoutedComponentInputBinder` (`@angular/router`) calls
   `activatedComponentRef.setInput(name, data[name])` for **every** declared input of a component
   mounted via `component:`, on every `combineLatest([queryParams, params, data])` emission — including
   an input with no matching key in that merged object, which resolves `data[name]` to `undefined` and
   overwrites the input's own default. `ForgeSignInComponent`/`ForgeSignUpComponent`'s
   `redirectTo = input('/admin')` hit this: after a successful sign-in with no `returnUrl`, the app
   silently landed on `/` instead of `/admin` (traced via a temporary `console.log` plus Angular's own
   `NG04018: Error parsing URL undefined` warning). Fixed by dropping the `input()` default entirely
   (`input<string>()`) and applying `?? '/admin'` at the read site instead — the correct pattern for
   any future route-mounted (not template-instantiated) component in this codebase.
2. **`CmsApiService.toApiError` never actually parsed the real server error envelope.** Every handler in
   `packages/runtime` (`handlers.ts`, `auth-handlers.ts`, `authFailureResponse`) emits
   `{ error: { code, message, details? } }` — nested. `toApiError` checked a top-level `details` and a
   _string_ `error` that no real route sends (both artifacts of an older/parallel shape), so a real
   message like `"Cannot remove the last remaining admin"` or a real per-field validation array
   surfaced to a user as the literal string `"[object Object]"` — caught live in the browser while
   testing the new users workspace's weak-password rejection. Fixed to unwrap the nested object shape
   first (message and array-typed `details` both), falling back to the old flat shape and to h3's
   `{ statusMessage }` (used by the hand-rolled `apps/*` user routes) in that order — a genuinely
   pre-existing client bug, not introduced by this branch, just never previously hit by a passing test
   because nothing before this branch exercised a message-only nested-error response client-side.
3. **`VoltButton`'s `[attr.aria-label]` does not forward to its inner native `<button>`.** Set as a host
   attribute on `<volt-button aria-label="...">`, the label lands on the non-interactive wrapper; the
   accessible name of the actual `button` role (an icon with no text) stays empty — invisible to both
   `getByRole('button', { name })` and a real screen reader. `ForgeUsersWorkspaceComponent`'s icon-only
   Edit/Delete buttons hit this (the automated `users.spec.ts` e2e test timed out looking for a
   role-named button that didn't exist); `ForgeCollectionListComponent` (spec 052) had already solved
   this correctly with a `<span class="sr-only">Label</span>` in the button's **projected** content,
   which does reach the inner button — switched to match.

**A fourth, smaller gap found (not a bug, a design omission):** `ForgeAdminLayoutComponent`'s "Log in"
link and post-logout redirect were hardcoded to `/admin/login` to match the new
`forgeAdminAuthRoutes()` convention — silently breaking `apps/demo-aesthetics`, whose own top-level
`/login` route (kept, per Non-goals) the shared layout no longer knew about. Fixed with a new
`ForgeAdminConfig.signInPath` (default `/admin/login`), which `apps/demo-aesthetics` sets to `/login`.
Caught by writing and running that app's own new e2e suite, not by inspection.

**Verification, all green:** `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
across all 13 packages/apps; `pnpm test:cloudflare` (72 tests, real local D1/R2, unaffected by this
branch as expected); `pnpm release:verify` (packed-tarball consumer compiles the real spec 054 public
API — `ForgeAuthSession`, `forgeAuthGuard`, `ForgeSignInComponent`, `ForgeSignUpComponent`,
`ForgeUsersWorkspaceComponent`, `forgeAdminAuthRoutes` — through `ngc` against the actual published
`.d.ts`, not source); `apps/www/e2e` (16/16, including new `auth.spec.ts` and the rewritten
`admin-crud`/`rbac`/`users` specs); `apps/demo-aesthetics/e2e` (5/5, this app's first-ever e2e suite);
and a full manual walkthrough in a real browser (sign-in → dashboard → users workspace → last-admin UI
protection observed live with two admins then back to one → weak-password/duplicate-email error
messages → session persists across a real reload → logout clears the server session → anonymous
redirect with `returnUrl`).

**Divergence from the original non-goals:** none — `apps/demo-aesthetics`'s client UI (login page,
users page, `app.routes.ts` nav/config beyond the one `signInPath` line) stayed untouched as planned;
only its server auth routes were brought onto spec 053's contract, which the spec's own Non-goals
section already called out as required, not optional. No Glossa-specific behavior, no OAuth/MFA/reset-
email, no unrelated feature expansion. All 31 acceptance-criteria-equivalent items from the maintainer's
original brief are satisfied; see `docs/STATE.md` for the itemized final report.
