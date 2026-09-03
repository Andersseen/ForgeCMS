---
title: Browser auth
description: Cookie sessions, login/signup/logout/me handlers, CSRF protection, and the first-admin bootstrap.
group: Server APIs
order: 4
---

[Machine auth](/docs/machine-auth) answers "which server is this?" for a Bearer-token client.
Browser auth answers "which person is this?" for a real browser — a page refresh should stay signed
in without client JS re-attaching a stored token, which means a cookie, which means CSRF protection.

## The recommended `users` collection

```ts
import { defineUsersCollection } from '@forge-cms/auth';

const users = defineUsersCollection();
// email (required, unique), name, role (admin | editor | viewer, defaults to viewer), passwordHash.
// Ships with sensible default access: any authenticated user may read the list and update their own
// record; only an admin may create, update any record, or delete. Already-hand-rolled `users`
// collections can keep using `withAuthFields()` directly instead — this is opinionated, not mandatory.
```

The unique `email` index is what makes signup race-safe against a duplicate email under concurrent
writes — see `UsersCollectionAuthAdapter`'s `UniqueConstraintError` handling.

## Wiring it up

```ts
import { UsersCollectionAuthAdapter, defineUsersCollection } from '@forge-cms/auth';
import { handleLogin, handleSignup, handleLogout, handleMe } from '@forge-cms/runtime';

const auth = new UsersCollectionAuthAdapter({ devMode: !env?.AUTH_SECRET }).init({
  ...env,
  userDatabase: database
});

const runtime = new ForgeCmsRuntime({
  collections: [defineUsersCollection() /* ...your other collections */],
  adapters: { database, auth, storage }
});

runtime.init();
await runtime.syncSchema();
```

Each server route stays a thin wrapper — the same shape as any other collection route:

```ts
// POST /api/auth/login
export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const context: ApiContext = { request: toWebRequest(event), env: event.context.cloudflare?.env };
  return handleLogin(context, { runtime, cookie: { secure: !!event.context.cloudflare?.env } });
});
```

`handleSignup` additionally takes `enabled: boolean` — public signup is opt-in, off unless a host
explicitly turns it on:

```ts
return handleSignup(context, { runtime, enabled: true, cookie: { secure: true } });
```

## What a successful login does

```text
POST /api/auth/login { email, password }
      ↓
200 { data: { user, token } }              ← same shape as before; Bearer clients keep working
      +
Set-Cookie: forge_session=…; HttpOnly; SameSite=Lax; Secure
```

`requireAuth()` (used by every handler, not just auth ones) checks `Authorization: Bearer` first, then
falls back to the `forge_session` cookie — a page refresh authenticates from the cookie alone, with no
client JS involved. `ApiKeyAuthAdapter` (machine auth) keeps its own independent, Bearer-only token
extraction, unaffected by any of this.

## CSRF protection

A cookie is sent automatically by the browser on every request to your origin — including one a
different site tricks the user's browser into making. `assertCsrfSafe` (wired into every mutating
collection/global/preview request, not just the auth endpoints) rejects a `POST`/`PUT`/`PATCH`/`DELETE`
whose only credential is that ambient cookie unless its `Origin` (or `Referer`) matches the request's
own host:

```text
mutating request, cookie only, cross-site Origin  →  403
mutating request, cookie only, same-site Origin   →  allowed
mutating request, Authorization: Bearer present   →  never checked — not forgeable cross-site
```

## Public signup and the first-admin bootstrap

`signup()`'s input type has no `role` field — a client cannot smuggle a role through the server API,
not just through a UI that hides the field:

```ts
interface PublicSignupInput {
  email: string;
  password: string;
  name?: string;
}
```

The very first user ever created — via `signup()` **or** the trusted `createUser()` — always becomes
`admin`, regardless of any requested role. A fresh install can never end up with a non-admin as its
only user. Every signup after that gets `viewer`.

## Error reasons

`login`/`signup`/`createUser` return a result, not a thrown exception, for every expected failure:

```ts
type AuthActionResult =
  | { ok: true; token: string; user: AuthUser }
  | {
      ok: false;
      reason: 'invalid-credentials' | 'invalid-email' | 'weak-password' | 'email-in-use';
    };
```

`handleLogin`/`handleSignup` map each reason to a distinct status — `401` for bad credentials, `400`
for a malformed email or a password under the policy minimum (8 characters by default, configurable via
`new UsersCollectionAuthAdapter({ passwordPolicy: { minLength: 12 } })`), `409` for a duplicate email.
None of it leaks adapter or database internals.

## Logout

```ts
return handleLogout(context, { runtime, cookie: { secure: true } });
```

Clears the cookie and returns `204` — idempotent, and CSRF-checked like any other mutation. Tokens are
stateless (signed, not stored), so this is client-state-only: it cannot revoke a Bearer token a
programmatic client still holds. A future spec may add real session revocation; this one doesn't
pretend to.

## Angular / admin auth experience

Everything above is the server contract. `@forge-cms/angular` and `@forge-cms/admin` build a complete,
reusable browser layer on top of it — session state, a route guard, sign-in/sign-up UI, and a users
workspace — so a consumer never re-implements this flow. This is the short version; each piece links
back to its own doc for detail.

**1. Server** — as above: `defineUsersCollection()`, `UsersCollectionAuthAdapter`, the four handlers.

**2. Angular provider** — no `authToken` needed for a browser session (see
[Angular client](/docs/angular-client)):

```ts
// app.config.ts
import { provideForgeCms } from '@forge-cms/angular';

export const appConfig: ApplicationConfig = {
  providers: [provideForgeCms({ baseUrl: '/api/v1' })]
};
```

**3. Router** — a guarded subtree next to the sign-in/sign-up routes:

```ts
// admin.routes.ts
import type { Routes } from '@angular/router';
import {
  ForgeAdminLayoutComponent,
  ForgeUsersWorkspaceComponent,
  forgeAdminAuthRoutes,
  forgeAdminContentRoutes
} from '@forge-cms/admin';
import { forgeAuthGuard } from '@forge-cms/angular';

export const ADMIN_ROUTES: Routes = [
  ...forgeAdminAuthRoutes({ signup: false }), // GET /admin/login (+ /admin/signup if true)
  {
    path: '',
    component: ForgeAdminLayoutComponent,
    canActivate: [forgeAuthGuard()], // any authenticated user
    children: [
      ...forgeAdminContentRoutes(), // spec 052
      {
        path: 'users',
        component: ForgeUsersWorkspaceComponent,
        canActivate: [forgeAuthGuard({ roles: ['admin'] })] // admin only
      }
    ]
  }
];
```

That's the whole surface a consumer needs to write. `forgeAuthGuard()` awaits `ForgeAuthSession`'s
one-time `/api/auth/me` bootstrap before deciding (so a page refresh never flashes an anonymous
sidebar), redirects an anonymous visitor to `signInPath` (default `/admin/login`) with a `returnUrl`,
and — with `roles` — redirects an authenticated-but-under-privileged visitor to `forbiddenPath`
(default `/admin`). None of this replaces server enforcement; it only avoids a round trip to discover
an action was always going to fail.

**`ForgeAuthSession`** (`providedIn: 'root'`, injectable directly for a custom sign-in form or a
user-menu component) exposes `user`, `status` (`'loading' | 'authenticated' | 'anonymous' | 'error'`),
`authenticated`, `loading`, `error`, and `expired` as signals, plus `login()`/`signup()`/`logout()`
(none of them throw — check `authenticated()`/`error()` after) and `refresh()`. A `401` on _any_ request
while a session is authenticated flips it to `'anonymous'` with `expired: true` automatically — no
polling, and a `403` never touches it.

**Users management** — `ForgeUsersWorkspaceComponent` needs no server route beyond the ones already
described (`GET/POST /api/auth/users`, `PUT/DELETE /api/auth/users/:id` — a host wires these the same
way as `login.post.ts` above): list, create, edit, and delete, including a password reset
(`updateUser(id, { password })`, already policy-checked). It also enforces the **last-admin invariant**
client-side (disabling the sole admin's own delete/demote controls) as a UX mirror of the real
server-side check in `UsersCollectionAuthAdapter` — an installation can never end up with zero admins,
however the change is attempted.

Host apps that predate `forgeAdminAuthRoutes()`'s `/admin/login` convention (an existing top-level
`/login` route, say) can point the shared layout at it instead of migrating the route:

```ts
const config: ForgeAdminConfig = { signInPath: '/login' /* ... */ };
```
