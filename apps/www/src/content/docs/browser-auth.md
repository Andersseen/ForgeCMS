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

// Development mode is an explicit decision — never "the secret is missing". Nitro replaces
// `import.meta.dev` with `true` only under the dev server; every build gets `false`.
const auth = new UsersCollectionAuthAdapter({ devMode: import.meta.dev === true }).init({
  ...env, // AUTH_SECRET: at least 32 bytes in production
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

`handleLogin`/`handleSignup` also accept `throttle` (your login/signup limiter) and `maxBodyBytes` —
see [Production configuration and abuse limits](#production-configuration-and-abuse-limits).

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
malformed Authorization (Basic …, empty Bearer)   →  still a cookie request — checked
```

`Authorization: Bearer` always wins over the cookie, whatever its size: an oversized or invalid Bearer
token is a `401`, and the cookie is not consulted as a fallback. The check compares `Origin` (or
`Referer`) with the request's own origin; there is no CSRF token. It covers logout, every collection,
global and preview mutation, and the first-party `/api/auth/users*` routes. Login and signup are not
CSRF-checked: they carry their own credentials rather than riding on an ambient one.

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

The first administrator is provisioned as **one atomic database write**: the bootstrap claim (a unique row
in the internal `_forge_bootstrap` collection, keyed by the users collection) and the admin user commit
together or not at all. Of several concurrent first signups exactly one becomes admin; a first signup that
fails (a database error, or the same email submitted twice at once) leaves neither user nor claim behind,
so the next valid first signup can still become the administrator. This needs a database whose
`atomicWrite` is real — `UsersCollectionAuthAdapter` refuses to initialise otherwise.

### Recovering a burned claim (databases written before spec 060)

Before spec 060 the claim was written first and the user second, so a failure between them left the claim
consumed with **no administrator** — every later signup became `viewer`. Such a database (claim present,
zero admins) is deliberately **not** auto-repaired: public signup stays `viewer`, because "claim present,
no admin" is also what an intentionally emptied admin set looks like, and repairing it automatically would
hand the next anonymous signup an administrator account. Recover from trusted server code — a seed script
or a one-off route you delete afterwards — with either:

```ts
// no users at all yet, or any state: creates an admin without touching the claim
await auth.createUser({ email: 'you@example.com', password: 'a-real-password', role: 'admin' });

// a viewer already signed up and should be the admin
await auth.updateUser(existingUserId, { role: 'admin' });
```

Neither is reachable over HTTP without an existing admin. Once any admin exists, ordinary rules apply.

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
for a malformed email, a name over 256 characters (`invalid-name`) or a password outside the policy
(8 to 1024 characters by default, configurable via
`new UsersCollectionAuthAdapter({ passwordPolicy: { minLength: 12, maxLength: 256 } })`), `409` for a
duplicate email. None of it leaks adapter or database internals. The full status table is below.

Signup's `409` for a duplicate email tells the caller that the address is registered. That is the
product contract, not an oversight: signup is opt-in, and a host that cannot accept it should keep
signup off (or throttle it). Login never reveals it — an unknown email and a wrong password get the same
`401`, the same body and the same single password verification.

## Production configuration and abuse limits

**Signing secret.** `AUTH_SECRET` must be at least 32 bytes (UTF-8) — `openssl rand -base64 48` gives
one. Without `devMode: true` a missing or shorter secret makes `init()` throw, and the error never
contains the secret. `devMode: true` is a local-development opt-in: with no secret it signs with Forge's
built-in dev secret, which is **public** — anyone can mint an admin session with it. Never compute
`devMode` from the secret's absence (`devMode: !env.AUTH_SECRET` turns a forgotten production secret
into that public one). On Analog/Nitro use `import.meta.dev === true`, which is `true` only under the dev
server and `false` in every build, including a local `wrangler pages dev` preview — give that one a
`.dev.vars` with `AUTH_SECRET`. Rotating the secret signs everybody out.

**Input bounds** (all refused before any expensive work):

| Input                                  | Bound                                            | Over the bound                            |
| -------------------------------------- | ------------------------------------------------ | ----------------------------------------- |
| Login/signup JSON body                 | 8 KiB (`maxBodyBytes`, up to 1 MiB)              | `413 PAYLOAD_TOO_LARGE`                   |
| Password                               | 8–1024 characters (`passwordPolicy`, max ≤ 4096) | signup/create/update: `400`; login: `401` |
| Email                                  | 254 characters                                   | `400 invalid-email`                       |
| Name                                   | 256 characters                                   | `400 invalid-name`                        |
| Forge session token (Bearer or cookie) | 8192 characters                                  | `401`, no HMAC                            |
| API key after `<prefix>_`              | 128 characters                                   | `401`, no database lookup                 |

The body bound is enforced on the stream: a missing or wrong `Content-Length` cannot get past it, and
reading stops as soon as it is crossed. A host that buffers the whole request before Forge sees it —
Nitro 2's Cloudflare entries do, for example — is bounded by the platform's own request limit first;
Forge's bound still decides what reaches JSON parsing and password hashing. Password length is the
JavaScript string length for both bounds; passwords are never truncated. Raise `maxBodyBytes` together
with `passwordPolicy.maxLength` if you raise the latter. Lowering `maxLength` below a password someone
already has locks them out until `updateUser(id, { password })` sets a new one. Users created before
these bounds with a name of thousands of characters get a session token Forge then refuses; shorten the
name with `updateUser(id, { name })`.

**Login/signup throttling is the host's job**, through one optional hook. Forge keeps no counters:

```ts
import type { AuthAttemptThrottle } from '@forge-cms/runtime';

// Called once per attempt: after the body is parsed, before any lookup or password hashing,
// with the same arguments whether or not the account exists.
type AuthAttemptThrottle = (attempt: {
  action: 'login' | 'signup';
  identifier: string; // the submitted email, trimmed + lower-cased
  request: Request; // for your own keys: a client address, a tenant header…
}) => Promise<{ allowed: true } | { allowed: false; retryAfterSeconds?: number }>;

return handleLogin(context, { runtime, throttle });
```

A denial is `429 { "error": { "code": "RATE_LIMITED", "message": "Too many authentication attempts" } }`
— nothing about the account, the bucket or the remaining budget — plus `Retry-After` when you return a
finite positive `retryAfterSeconds` (rounded up, capped at one day). A throttle that throws or returns
anything else fails closed as `500`. Logout, `me` and ordinary authenticated requests (API keys
included) never call it. You choose the key: the identifier, the client, a tenant, or several
independent checks combined.

_Choosing keys._ A limit keyed only on the submitted email lets anyone who knows an address keep that
account throttled — a targeted lockout. Key login on the client **and** the identifier, with the
identifier bucket more generous than the client one, and key signup on the client (a spammer picks a new
email every time). Forge passes `request`, so the client key is your choice: a platform header, a proxy
header you trust, a tenant.

_Cloudflare Workers_ — [Rate Limiting bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/),
one per limit (`period` is 10 or 60 seconds):

```jsonc
// wrangler.jsonc
"ratelimits": [
  { "name": "AUTH_CLIENT_LIMITER", "namespace_id": "1001", "simple": { "limit": 10, "period": 60 } },
  { "name": "AUTH_ACCOUNT_LIMITER", "namespace_id": "1002", "simple": { "limit": 30, "period": 60 } }
]
```

```ts
function cloudflareAuthThrottle(env: Env): AuthAttemptThrottle {
  return async ({ action, identifier, request }) => {
    const client = request.headers.get('cf-connecting-ip') ?? 'unknown';
    const checks = [env.AUTH_CLIENT_LIMITER.limit({ key: `${action}:client:${client}` })];
    if (action === 'login') {
      checks.push(env.AUTH_ACCOUNT_LIMITER.limit({ key: `login:account:${identifier}` }));
    }
    const results = await Promise.all(checks);
    return results.every((r) => r.success)
      ? { allowed: true }
      : { allowed: false, retryAfterSeconds: 60 };
  };
}

return handleLogin(context, { runtime, throttle: cloudflareAuthThrottle(env) });
```

Cloudflare documents these counters as local to each location and eventually consistent — a brake, not
an exact count — and warns that IP addresses can be shared by many users; a per-client limit that is
too tight throttles a whole office. Pages Functions do not list this binding; a Pages project can put a
[WAF rate limiting rule](https://developers.cloudflare.com/waf/rate-limiting-rules/) on
`/api/auth/login` and `/api/auth/signup` at the edge (per IP on the Free and Pro plans), or route auth
through a Worker that has the binding.

_Portable hosts_ — a reverse proxy or ingress limit (nginx `limit_req`, a load balancer rule) in front of
the auth routes, framework middleware, or an external limiter service behind the same hook:

```ts
const throttle: AuthAttemptThrottle = async ({ action, identifier, request }) => {
  const client = clientKeyFrom(request); // e.g. the address your trusted proxy forwards
  const keys = [`${action}:client:${client}`];
  if (action === 'login') keys.push(`login:account:${identifier}`);
  const result = await limiterService.consumeAll(keys); // Redis, Upstash, your API…
  return result.ok ? { allowed: true } : { allowed: false, retryAfterSeconds: result.retryAfter };
};
```

Do not rely on an in-process counter in production: it is per instance and forgets on restart.

**Failure statuses** (every body is the `{ "error": { "code", "message" } }` envelope):

| Scenario                                                   | Status | Code                |
| ---------------------------------------------------------- | -----: | ------------------- |
| Wrong password or unknown email                            |    401 | `UNAUTHORIZED`      |
| Malformed JSON, non-object body, missing email/password    |    400 | `INVALID_INPUT`     |
| Body over the bound                                        |    413 | `PAYLOAD_TOO_LARGE` |
| Signup: invalid email, name or password outside the policy |    400 | `INVALID_INPUT`     |
| Signup: email already registered                           |    409 | `UNIQUE_CONSTRAINT` |
| Throttled login or signup                                  |    429 | `RATE_LIMITED`      |
| Signup disabled or unsupported                             |    404 | `NOT_FOUND`         |
| Cross-site cookie mutation (logout included)               |    403 | `FORBIDDEN`         |
| `me` with no, an invalid or an expired session             |    401 | `UNAUTHORIZED`      |
| Database, adapter or throttle failure                      |    500 | `INTERNAL_ERROR`    |

**Logs.** Expected failures are never logged. An unexpected one is logged as
`Unexpected error in auth handler { operation, error }`, where `error` is only the error's class name,
because an adapter's or driver's message can quote a password, a token or a cookie. The same applies to
an auth failure behind a content route (`AuthResolutionError`).

**Session cookie.** `forge_session` is `HttpOnly; SameSite=Lax; Path=/; Secure` with `Max-Age` equal to
the 24-hour token lifetime; logout sends the same attributes with `Max-Age=0`. Only an explicit
`cookie: { secure: false }` drops `Secure`, for local `http://` development. Cross-site cookies are not
supported.

**Password hashing.** PBKDF2-HMAC-SHA256, 100,000 iterations, 16-byte salt — about 7 ms of CPU per
verification (measured in Node 22). That is below OWASP's current 600,000 recommendation; it is kept for 1.0 because every
login pays it in CPU time (Workers' Free plan allows 10 ms of CPU per request), and raising it needs a
versioned hash format with rehash-on-login, which is planned after 1.0. Throttling is what bounds
guessing.

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
  providers: [provideForgeCms({ baseUrl: '/api/v1' })] // + authBaseUrl / credentials as needed
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
(default `/admin`). Mounted somewhere other than `/admin`? Pass both options (and `basePath` to
`forgeAdminAuthRoutes()` / `ForgeAdminConfig`) — see [Admin UI](/docs/admin-ui). The sign-in page
returns only to paths under the mount root, so a crafted `returnUrl` can never leave the admin. None of this replaces server enforcement; it only avoids a round trip to discover
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
server-side check in `UsersCollectionAuthAdapter` — a users collection can never end up with zero admins
through it, however the change is attempted, **including two admins removing each other at the same
moment**: the check is a single conditional database write (`updateIf`/`deleteIf`), not a count followed
by a write, so exactly one of two conflicting requests succeeds and the other gets the `last-admin`
refusal. This holds across independent Workers on D1 and libSQL.

**The users collection is not editable through the generic content API.** The collection
`UsersCollectionAuthAdapter` manages is _owned_ by the adapter: `POST/PUT/PATCH/DELETE /api/v1/users`
and `runtime.create/update/delete({ collection: 'users', … })` are refused with
`403 { "error": { "code": "AUTH_MANAGED_COLLECTION", … } }` — for every caller, including trusted
server code whose `overrideAccess` defaults to `true`, because a generic write would bypass everything
above (first-admin provisioning, the last-admin invariant, password hashing, email normalisation,
session versioning). Use `createUser` / `updateUser` / `deleteUser` / `signup` and the
`/api/auth/users*` routes instead. Reads (`GET /api/v1/users`, `runtime.find`, relation population) work
as before, with the same read access, and never return `passwordHash` or the internal `_sessionVersion`.
The rule follows the adapter's `collection` option (`'members'`, `'accounts'`, …), not the name `users`,
and it does not touch any other collection. Two consequences to know about: extra non-auth fields you
add to the users collection (`avatar`, `jobTitle`, …) are read-only through Forge's generic surface, and
direct `DatabaseAdapter` access (`runtime.adapters.database.update(…)`) is trusted low-level
infrastructure that bypasses runtime and auth guarantees alike — like raw SQL under an ORM.

**A user that content references cannot be deleted.** If a post's `author`, a `many` reviewers list or
a global's relation still points at a user, `deleteUser` throws `UserMutationError` with reason
`'referenced'`, and `DELETE /api/auth/users/:id` answers `409` with a message giving only how many
references remain. Re-point or remove those references, then delete the user. Forge never cascades
or clears them for you. The reference check, the last-admin check and the delete commit as one database
batch, so a reference written by another request at the same moment makes the delete fail; the two can
never both succeed. `ForgeCmsRuntime` sets this up automatically for the adapter you pass it; a
`UsersCollectionAuthAdapter` used on its own, without a runtime, does not know the content schema and
deletes as before.

Host apps that predate `forgeAdminAuthRoutes()`'s `/admin/login` convention (an existing top-level
`/login` route, say) can point the shared layout at it instead of migrating the route:

```ts
const config: ForgeAdminConfig = { signInPath: '/login' /* ... */ };
```
