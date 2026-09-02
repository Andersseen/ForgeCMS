# 053 — Browser auth foundation

- **Status:** done
- **Author:** maintainer direction (Andrii), drafted by agent
- **Date:** 2026-09-02
- **Branch:** feature/browser-auth-foundation
- **Affected packages/apps:** `@forge-cms/auth`, `@forge-cms/runtime`, `@forge-cms/cloudflare`, `apps/www`, `apps/demo-aesthetics`

## Context / Why

Every human-facing auth path today (`UsersCollectionAuthAdapter`) issues a signed HMAC token the
client must fetch, store (`apps/www` puts it in `localStorage`), and re-attach as
`Authorization: Bearer` on every request. There is no cookie session, so there is no way to bootstrap
"who is logged in" on a page refresh without client JS re-sending a stored token, no CSRF concern
(because there's nothing ambient to forge), but also no path to the browser-native session model a
real Angular admin needs. Alongside that, an audit of the existing human-auth surface (`login`,
`createUser` on `UsersCollectionAuthAdapter`, the app-local `/api/auth/*` routes in `apps/www`) found
several real gaps: email comparison is case-sensitive with no normalization, there is no password
policy, there is no way to safely bootstrap the first admin account outside the demo seed script, the
"trusted admin creates a user" path (`createUser`) is the only creation path (no distinguishable public
signup, so nothing stops a future signup form from smuggling a `role` field), and `ExternalAuthAdapter`
duplicates a weaker token-parsing regex and treats a validation-service outage the same as an explicit
rejection. This is a server-only stabilization-plus-feature branch (same shape as spec 049): fix the
audited gaps and add cookie sessions, CSRF protection, and login/signup/logout/me handlers as reusable
`@forge-cms/auth`/`@forge-cms/runtime` primitives. It is the prerequisite for a future Angular/admin
auth UI (not part of this branch — see Non-goals).

## Goal

`@forge-cms/auth`'s `UsersCollectionAuthAdapter` and `@forge-cms/runtime`'s new auth handlers give any
consumer a working, hardened browser auth flow — HttpOnly cookie sessions with Bearer compatibility,
CSRF-safe mutations, a first-user-becomes-admin bootstrap, a password policy, normalized email lookups,
and an explicit, role-escalation-proof public signup path — reachable through thin `apps/www` routes
that prove the primitives work end to end, with zero change to any existing HTTP response shape.

## Non-goals

- Any Angular/admin UI, client SDK auth methods, or route guards (a follow-up spec, working from this
  one's server contract).
- Password reset, email verification, OAuth/social login, MFA, passkeys, magic links.
- A generic users-management HTTP API (list/edit/delete other users, role changes) — `users` stays a
  normal collection reachable through the existing generic `/api/v1/users*` collection routes; a
  dedicated admin workspace for it is a future spec.
- The "last admin can't demote/delete themselves" invariant — flagged here as a known gap (the new
  first-admin bootstrap does not prevent it later), left for whichever spec first builds user-management
  UX, per this repo's SDD process.
- Session revocation / server-side session storage — tokens stay stateless HMAC; logout clears the
  client's cookie only (documented behavior, not silently pretended otherwise).
- Changing `ApiKeyAuthAdapter` (machine auth) — it keeps its own independent, Bearer-only
  `extractToken`, deliberately untouched.
- GraphQL, plugins, Postgres/Mongo, billing, teams/organizations, CLI, S3.

## Design

### 1. Session cookie primitives — `packages/auth/src/cookie.ts` (new)

```ts
export const SESSION_COOKIE_NAME = 'forge_session';

export function parseCookieToken(request: Request, name?: string): string | null;

export interface SessionCookieOptions {
  /** Omit `Secure` — only for local http:// dev. Defaults to true. */
  secure?: boolean;
  /** Defaults to 24h, matching the signed-token TTL. */
  maxAgeSeconds?: number;
}

export function buildSessionCookie(token: string, options?: SessionCookieOptions): string; // Set-Cookie value: HttpOnly; SameSite=Lax; Path=/; Max-Age=...; [Secure]
export function buildLogoutCookie(options?: { secure?: boolean }): string; // same attrs, Max-Age=0, empty value
```

`token-signer.ts`'s `extractToken(request)` (shared by `UsersCollectionAuthAdapter` and
`SignedTokenAuthAdapter`) tries `Authorization: Bearer` first, then falls back to
`parseCookieToken(request)`. `ApiKeyAuthAdapter` keeps its own separate, header-only `extractToken` —
unaffected, machine auth stays Bearer-only by construction, not by a conditional.

### 2. `AuthActionResult` and optional adapter methods — `packages/auth/src/index.ts`

```ts
export type AuthFailureReason =
  | 'invalid-credentials'
  | 'email-in-use'
  | 'weak-password'
  | 'invalid-email';

export type AuthActionResult<TUser extends AuthUser = AuthUser> =
  | { ok: true; token: string; user: TUser }
  | { ok: false; reason: AuthFailureReason };

export interface AuthAdapter<TUser extends AuthUser = AuthUser> {
  // ...existing members unchanged...
  /** Optional: adapters that support password login implement this. */
  login?(email: string, password: string): Promise<AuthActionResult<TUser>>;
  /** Optional: adapters that support public self-service signup implement this. */
  signup?(input: {
    email: string;
    password: string;
    name?: string;
  }): Promise<AuthActionResult<TUser>>;
}
```

Both are optional and additive, same convention as `syncSchema?`/`canHandleToken?` — an adapter that
omits them behaves exactly as before. `packages/runtime`'s new handlers feature-detect them; they never
import `UsersCollectionAuthAdapter` concretely (dependency direction stays runtime → auth abstraction
only, unchanged).

### 3. `UsersCollectionAuthAdapter` hardening — `packages/auth/src/users-collection.adapter.ts`

- **Email normalization:** a private `normalizeEmail(email) => email.trim().toLowerCase()` used for
  every lookup (`login`, `createUser`, `signup`) and for the value actually stored.
- **Password policy:** new constructor option `passwordPolicy?: { minLength?: number }` (default `8`).
  `createUser`/`signup` reject a too-short password before touching the DB. `login` is deliberately
  exempt — enforcing it there would lock out any account created before this policy existed (or under
  a stricter `minLength` than when it was created).
- **First-admin bootstrap:** a private `isFirstUser(db)` (`(await db.findMany({ collection, limit: 1 })).length === 0`).
  Both `createUser` and `signup` force `role: 'admin'` when true, regardless of the requested role —
  a fresh install can never end up with a non-admin as its only user.
- **New `signup(input: { email, password, name? })`:** the public self-service path. Unlike
  `createUser`, its input type has no `role` field at all — a client cannot smuggle a role through the
  server API, not just through a UI that happens to hide the field. Assigns `'admin'` only via the
  first-user bootstrap above, `'viewer'` otherwise.
- **Race-safe duplicate email:** keep the existing `findMany`-based pre-check (fast path, works even
  without a unique index), and additionally catch `UniqueConstraintError` (from `@forge-cms/db`) around
  `db.create()`, mapping it to `{ ok: false, reason: 'email-in-use' }` — race-safe when the collection
  declares `email: { unique: true }` (see `defineUsersCollection()` below), a strict improvement when
  it doesn't. `isUniqueConstraintError` is a **value** import, not `import type` — `@forge-cms/db` was
  previously only a `devDependency` of `@forge-cms/auth` (fine when every reference was type-only, and
  erased at compile time); it must move to `dependencies`, or the published `@forge-cms/auth` package
  breaks for any real consumer that doesn't separately install `@forge-cms/db` (`ERR_MODULE_NOT_FOUND`
  on the very first `import '@forge-cms/auth'`) — caught by review, not by `pnpm release:verify`, whose
  `assertRuntimeImportsDeclared` check itself accepted `devDependencies` as satisfying a runtime import;
  fixed alongside this (see Implementation plan).
- **Breaking, in-repo-contained:** `login()` and `createUser()` now return `AuthActionResult` instead of
  `{ token, user } | null`. Every direct call site is updated in this branch: `apps/www`'s
  `login.post.ts`/`users.post.ts`, and `apps/demo-aesthetics`'s independent, hand-rolled equivalents
  (not part of the original "affected apps" list — found by `pnpm typecheck`, not by inspection; see
  Outcome). `SignedTokenAuthAdapter.login()` is also affected (forced by the new `login?` member on
  `AuthAdapter` itself) — no in-repo consumer of that adapter's `login()` exists outside its own test,
  but a real external consumer of the exported `SignedTokenAuthAdapter` would see the same breaking
  change; called out here and in the changeset.

### 4. `defineUsersCollection()` — `packages/auth/src/user-fields.ts`

```ts
export function defineUsersCollection(options?: { slug?: string }): CollectionDefinition<...>;
```

Builds on `withAuthFields`: `email` (required, `unique: true`), `name` (optional text), `role` (select
`admin | editor | viewer`, `defaultValue: 'viewer'`, **`access: { write: ['admin'] }`** — see below),
plus sensible default `access`:

```ts
access: {
  read: ({ user }) => user !== null,
  create: ({ user }) => isAdmin(user),
  update: ({ user }) => (isAdmin(user) ? true : user ? { id: user.id } : false),
  delete: ({ user }) => isAdmin(user)
}
```

Row-level `update` lets a user edit their own record (name, etc.) without admin rights. **This is
exactly why `role` needs its own field-level `access.write: ['admin']`**: without it, the self-service
grant above would double as a privilege-escalation path — a plain `viewer` could `PATCH` their own
record's `role` to `admin` through the ordinary `/api/v1/users/:id` route, which is precisely what
`signup()`'s role-free input type (§3) exists to prevent one field-write away. (Caught by an
independent review pass during implementation, not present in the original draft of this design —
see Outcome.) The recommended shape, not a forced one: a consumer that already hand-rolls a `users`
collection (like `apps/www`'s demo, which has extra `avatar`/`status`/`lastLogin` fields) is not
required to migrate in this branch — `withAuthFields` keeps working standalone. `apps/www`'s own
collection is left as-is; the new helper is for new consumers.

### 5. `ExternalAuthAdapter` hardening — `packages/auth/src/external.adapter.ts`

- `extractToken` now delegates to the shared `extractToken` from `token-signer.ts` (case-insensitive
  `Bearer`, trims, and gains the cookie fallback) instead of its own `.replace('Bearer ', '')`.
- `validateSession`: a network failure (`fetch` throws) or a `5xx` from the validation service now
  **throws** (propagates to the HTTP boundary's `500`, same rule spec 049 applied to
  `CompositeAuthAdapter`/`handlers.ts`) instead of silently returning `null` — an infrastructure outage
  must not look like "invalid token". A `4xx` (the service explicitly rejects the token) still returns
  `null` → a real `401`. No `canHandleToken` is added — an opaque external token has no reliable format
  check, so this adapter keeps being "always attempted" inside a `CompositeAuthAdapter`, exactly as
  before.

### 6. CSRF / same-origin protection — `packages/runtime/src/csrf.ts` (new) + `errors.ts`

```ts
// errors.ts
export class CsrfError extends ForgeError {
  constructor(message?: string); // 403, code 'FORBIDDEN'
}

// csrf.ts
export function assertCsrfSafe(request: Request): void; // throws CsrfError
```

Logic: a no-op unless the method is `POST`/`PUT`/`PATCH`/`DELETE` **and** the request carries the Forge
session cookie **and no valid `Authorization: Bearer`** (tested via `@forge-cms/auth`'s exported
`extractBearerToken` — the exact same check `extractToken` itself uses to decide whether to even look
at the cookie, not mere presence of an `Authorization` header: a malformed header like `Authorization:
Basic ...` must not make this function think "not a cookie session" while `extractToken` falls through
to the cookie anyway, which would let exactly the forgeable request this check exists for skip it). A
request with a valid Bearer credential can't be forged cross-site by a browser without CORS explicitly
allowing it, so it's exempt — this is what keeps machine/API-key clients and the current Bearer-only
`apps/www` client unaffected. When both are true, the request's `Origin` (falling back to `Referer`)
must be same-origin with the request URL, or it's rejected with `CsrfError`.

**Wiring, corrected during implementation (see Outcome):** the first cut put `assertCsrfSafe` inside
`handlers.ts`'s `authorize()`, called only when a route/collection requires authentication
(`mustAuth`). That misses every mutating request to a collection with its own function-based `access`
(exactly what `defineUsersCollection()` declares) when the route itself doesn't also set
`requireAuth: true` — such a request takes the `resolveOptionalUser` branch instead, which never called
`authorize()`, so CSRF was silently never checked for it. Fixed by moving the `assertCsrfSafe` call to
the top of `resolveRequest`/`resolveGlobalRequest`'s try block, unconditionally — before the `mustAuth`
branch, so it runs for every mutating request reaching a collection/global handler regardless of which
branch resolves the user. Still a no-op for a truly anonymous request (no session cookie at all), so a
public anonymous-write collection (a comment form, a booking widget) is unaffected. `handlePreview` gets
its own explicit `assertCsrfSafe` call for the same reason, since it doesn't go through
`resolveRequest`. `assertCsrfSafe` throws a `ForgeError` subclass; each call site's existing
`catch (err) { return toErrorResponse(err, null); }` already maps any `ForgeError` to its status, so
this needed no new catch/branch. Read operations are unaffected (`GET` is never in the mutating set).

**A second gap, also found by review:** `apps/www`'s (and `apps/demo-aesthetics`'s) admin
user-management routes (`users.post.ts`, `users/[id].put.ts`, `users/[id].delete.ts`) call
`UsersCollectionAuthAdapter.requireRole()` directly against a request built by a local
`createAuthRequest(event)` helper — they never go through `handlers.ts` at all, so the fix above didn't
reach them. Before this spec, `extractToken` was Bearer-only, so these routes were structurally CSRF-immune (a cross-site page cannot attach a custom `Authorization` header). Adding the cookie fallback
made them cookie-reachable without also protecting them. Fixed in both apps: `createAuthRequest` now
carries the real HTTP method through (the `Request` constructor otherwise defaults to `GET`, which
would make `assertCsrfSafe` silently no-op on every call), and a shared `requireAdminAuth(event)`
helper (already existed in `apps/demo-aesthetics`; added to `apps/www`, consolidating its previously
duplicated per-route try/catch — a `pnpm typecheck`-safe simplification, not scope creep) calls
`assertCsrfSafe` before `requireRole`.

### 7. Reusable auth handlers — `packages/runtime/src/auth-handlers.ts` (new)

Transport-only, same shape/conventions as `handlers.ts` (try/catch per handler, `jsonResponse`/
`errorResponse`, no business logic beyond parsing + envelope + cookie header):

```ts
export interface AuthHandlerOptions<TEnv = unknown> {
  runtime: AnyForgeCmsRuntime<TEnv>;
  cookie?: { secure?: boolean }; // default true; caller passes false for local http:// dev
}

export interface SignupHandlerOptions<TEnv = unknown> extends AuthHandlerOptions<TEnv> {
  /** Public signup is opt-in and off unless explicitly enabled — no implicit default-on. */
  enabled: boolean;
}

export async function handleLogin<TEnv>(
  context: ApiContext<TEnv>,
  options: AuthHandlerOptions<TEnv>
): Promise<Response>;
export async function handleSignup<TEnv>(
  context: ApiContext<TEnv>,
  options: SignupHandlerOptions<TEnv>
): Promise<Response>;
export async function handleLogout<TEnv>(
  context: ApiContext<TEnv>,
  options: AuthHandlerOptions<TEnv>
): Promise<Response>;
export async function handleMe<TEnv>(
  context: ApiContext<TEnv>,
  options: AuthHandlerOptions<TEnv>
): Promise<Response>;
```

- **`handleLogin`** — 404 if `auth.login` is undefined (adapter doesn't support it). Parses
  `{ email, password }`, 400 if missing. On success: `200 { data: { user, token } }` (unchanged shape —
  `apps/www`'s `@forge-cms/angular` client already expects exactly this) **plus** a `Set-Cookie` header.
  On failure: reason-mapped response (below).
- **`handleSignup`** — 404 if `options.enabled` is false, or if `auth.signup` is undefined. Parses
  `{ email, password, name? }` — any other body field (e.g. a smuggled `role`) is never read. On
  success: `201 { data: { user, token } }` + `Set-Cookie`. On failure: reason-mapped response.
- **`handleLogout`** — runs `assertCsrfSafe` first (mapped via the same `toErrorResponse` pattern), then
  always returns `204` with a clearing `Set-Cookie` — idempotent, no auth required (clearing a cookie
  that isn't there is harmless), and does not claim server-side revocation (see Non-goals).
- **`handleMe`** — `requireAuth`; `200 { data: user }` or `401`. No new behavior beyond reusing
  `requireAuth` the same way every other handler does.

Reason → response mapping (`authFailureResponse(reason)`, exported from `@forge-cms/runtime` so any
host route calling `auth.createUser()`/`auth.login()`/`auth.signup()` directly — as `apps/www`'s and
`apps/demo-aesthetics`'s admin-trusted `users.post.ts` do — maps the same failure reasons the same way
instead of re-implementing this switch per route):

| reason                | status | message                               |
| --------------------- | ------ | ------------------------------------- |
| `invalid-credentials` | 401    | `Invalid email or password`           |
| `invalid-email`       | 400    | `Invalid email address`               |
| `weak-password`       | 400    | `Password does not meet requirements` |
| `email-in-use`        | 409    | `Email is already in use`             |

### 8. `apps/www` dogfooding (minimal, no client changes)

- `login.post.ts` and `me.get.ts` become thin wrappers delegating to `handleLogin`/`handleMe` (same
  `toWebRequest(event)` pattern already used by `[collection].post.ts`), passing
  `cookie: { secure: !!event.context.cloudflare?.env }` (secure only on a real Cloudflare/HTTPS
  deployment, same heuristic `runtime.ts` already uses for `devMode`).
- New `logout.post.ts` wraps `handleLogout` the same way. Nothing in the UI calls it yet (that's the
  next spec) — it exists as a working, tested primitive.
- `users.post.ts`/`users.get.ts`/`users/[id].put.ts`/`users/[id].delete.ts` (admin-trusted user
  management) are updated for `createUser`'s new `AuthActionResult` return shape, and their previously
  per-route-duplicated `requireRole` try/catch is consolidated into a new shared `requireAdminAuth()`
  in `auth-request.ts` (matching a helper `apps/demo-aesthetics` already had) — needed to add the CSRF
  fix above in one place rather than four. Their URLs and admin-gating are otherwise unchanged.
  Public signup is **not** mounted as a live route in `apps/www` — the demo doesn't want it — but
  `handleSignup`/`auth.signup()` are fully implemented and tested at the package level.
- No change to `login.page.ts`, `app.config.ts`, or any `localStorage`/`Authorization` client code —
  the existing Bearer/localStorage flow keeps working unmodified; the cookie is strictly additive.

### API envelope impact

Every success response shape is unchanged; the only addition there is a `Set-Cookie` response header
on login/signup/logout, which no existing client reads or is broken by. Two **error**-path shapes did
change, harmlessly: `apps/www`'s `login.post.ts` and `me.get.ts` previously threw h3's `createError`
(`{ statusCode, statusMessage, ... }`) on failure; as thin wrappers over `handleLogin`/`handleMe` they
now return the standard Forge envelope (`{ error: { code, message } }`) instead. `@forge-cms/angular`'s
`CmsApiService` only branches on `response.status` for these two calls (never parses the error body),
and `login.page.ts` shows one fixed message regardless — verified with all 13 `apps/www` e2e specs
green, but noted here since "no envelope impact" was too strong a claim for the original draft.

## Implementation plan

- [x] `packages/auth`: `cookie.ts` (`SESSION_COOKIE_NAME`, `parseCookieToken`, `buildSessionCookie`,
      `buildLogoutCookie`); `token-signer.ts`'s `extractToken` gains the cookie fallback; re-export from
      `index.ts`.
- [x] `packages/auth`: `AuthActionResult`/`AuthFailureReason` types; optional `login?`/`signup?` on
      `AuthAdapter`.
- [x] `packages/auth/users-collection.adapter.ts`: email normalization, password policy option,
      first-user-becomes-admin bootstrap, new `signup()`, `login`/`createUser` return `AuthActionResult`,
      race-safe duplicate-email handling.
- [x] `packages/auth/user-fields.ts`: `defineUsersCollection()`.
- [x] `packages/auth/external.adapter.ts`: shared `extractToken`; network/5xx throws instead of
      swallowing to `null`.
- [x] `packages/runtime`: `csrf.ts` (`assertCsrfSafe`) + `errors.ts`'s `CsrfError`; wired
      unconditionally into `resolveRequest`/`resolveGlobalRequest` (not gated on `mustAuth` — see
      Design §6's "Wiring, corrected during implementation") and `handlePreview`.
- [x] `packages/runtime`: `auth-handlers.ts` (`handleLogin`, `handleSignup`, `handleLogout`, `handleMe`,
      `authFailureResponse`); export from `index.ts`.
- [x] `packages/auth`: move `@forge-cms/db` from `devDependencies` to `dependencies` (now a value
      import, not type-only); `scripts/verify-release.mjs`'s `assertRuntimeImportsDeclared` no longer
      accepts a `devDependency` as satisfying a runtime import (it never should have).
- [x] `packages/auth/user-fields.ts`: `role` field gains `access: { write: ['admin'] }` — the
      privilege-escalation fix in Design §4.
- [x] `apps/www`: rewrite `login.post.ts`/`me.get.ts` as thin wrappers; add `logout.post.ts`; add
      `requireAdminAuth()` to `auth-request.ts` (CSRF-checked, real HTTP method preserved) and use it
      from all four `users.*` routes, replacing their duplicated try/catch; fix `createUser`'s new
      return shape.
- [x] `apps/demo-aesthetics`: same `createAuthRequest`/`requireAdminAuth` CSRF fix (it already had the
      shared helper; apps/www didn't); fix its independent `login.post.ts`/`users.post.ts` for the new
      return shapes (found by `pnpm typecheck`, not in the original "affected apps" list).
- [x] Tests: `users-collection.adapter.test.ts` additions (normalization, password policy, bootstrap,
      signup role-escalation-proof, race-safe duplicate email); new
      `users-collection.adapter.db-parity.test.ts` (InMemory + libSQL, mirrors
      `api-key.adapter.db-parity.test.ts`); `external.adapter.test.ts` additions (shared extractToken,
      network/5xx vs 4xx); `packages/runtime`: new `browser-auth-integration.test.ts` (login/signup/
      logout/me end to end, cookie set/clear, CSRF pass/reject, disabled-signup 404, role-escalation
      rejected via `handleUpdate`, CSRF rejected on `defineUsersCollection()`'s optional-auth route);
      new `packages/cloudflare/test/workers/human-auth.test.ts` (real D1 via Miniflare:
      `defineUsersCollection()` schema sync creates the `passwordHash` column and unique email index;
      signup/login round trip).
- [x] Docs: new `apps/www/src/content/docs/browser-auth.md`; update `docs/ARCHITECTURE.md`'s
      `AuthAdapter` contract section for the two new optional methods.
- [x] Changesets: `@forge-cms/auth` (minor — new exports, `login`/`createUser` return-shape change,
      `SignedTokenAuthAdapter.login()` also affected), `@forge-cms/runtime` (minor — new handlers +
      CSRF), `@forge-cms/cloudflare` (patch — test-only).
- [x] `docs/STATE.md` / `docs/ROADMAP.md` updated; spec status and outcome note reflect actual
      commit/merge state (see Outcome) rather than assuming `done` means "on `main`".

## Test plan

- `pnpm --filter @forge-cms/auth test` — all new/updated unit tests above green.
- `pnpm --filter @forge-cms/runtime test` — `browser-auth-integration.test.ts` plus existing suites
  (`handlers.test.ts`, `machine-auth-integration.test.ts`) unaffected.
- `pnpm test:cloudflare` — new `human-auth.test.ts` green alongside the existing `machine-auth.test.ts`.
- Manual: `pnpm dev:www` → log in at `/login` → confirm (via browser devtools) a `forge_session`
  `HttpOnly` cookie is set → existing e2e (`admin-crud.spec.ts`, `users.spec.ts`, `rbac.spec.ts`, which
  drive the app through the unchanged Bearer/localStorage path) stay green, proving the change is
  additive.
- Full gates: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`, plus
  `pnpm test:cloudflare` and `pnpm release:verify`.

## Acceptance criteria

1. `UsersCollectionAuthAdapter.login`/`signup` normalize email (case/whitespace-insensitive lookup).
2. A password under the configured minimum (default 8) is rejected by `createUser` and `signup` with
   `{ ok: false, reason: 'weak-password' }`.
3. The first user ever created via `createUser` or `signup` always gets `role: 'admin'`, regardless of
   requested role; the second gets the requested/default role.
4. `signup()`'s input type has no `role` field; a `role` key present in an HTTP signup request body is
   never applied.
5. Two concurrent `signup()` calls with the same (normalized) email: exactly one succeeds, the other
   gets `{ ok: false, reason: 'email-in-use' }` — proven against a collection using
   `defineUsersCollection()` (unique index present).
6. `handleLogin` sets an `HttpOnly; SameSite=Lax` `forge_session` cookie on success and still returns
   `{ data: { user, token } }` in the body (Bearer compatibility unchanged).
7. `handleMe` resolves the user from the cookie alone (no `Authorization` header) after `handleLogin`.
8. `handleLogout` clears the cookie and returns `204`.
9. A cross-origin mutating request carrying only the session cookie (no valid `Authorization: Bearer`)
   is rejected `403` — proven against **both** a collection gated by static `allowedRoles` and one
   with its own function-based `access` (i.e. `defineUsersCollection()` itself, which takes the
   `resolveOptionalUser` code path, not `authorize()`'s), and against the admin-only
   `apps/www`/`apps/demo-aesthetics` user-management routes that bypass `handlers.ts` entirely. The
   identical request with a same-origin `Origin`/`Referer` succeeds; the identical request carrying a
   valid `Authorization: Bearer <token>` instead of relying on the cookie is **not** subject to the
   check. A plain viewer additionally cannot use this same self-service `update` grant to write their
   own `role` field, even same-origin with a valid session (field-level access, not CSRF).
10. `handleSignup` returns `404` when `enabled: false` (or the adapter lacks `signup`), never silently
    succeeding.
11. `ExternalAuthAdapter.validateSession` throws (surfaces as `500` through the HTTP boundary) on a
    network failure or `5xx` from the validation service, and returns `null` (→ `401`) on an explicit
    `4xx` rejection.
12. `pnpm test:cloudflare`'s new `human-auth.test.ts` proves `defineUsersCollection()` + real D1 signup/
    login works end to end (column + unique index actually created and enforced).
13. Every existing `apps/www` e2e spec (`admin-crud`, `users`, `rbac`) stays green, unmodified — proof
    the cookie addition is non-breaking to the current Bearer/localStorage client.
14. `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build` green, plus
    `pnpm test:cloudflare` and `pnpm release:verify`.
15. Changesets present for `@forge-cms/auth`, `@forge-cms/runtime`, `@forge-cms/cloudflare`;
    `docs/STATE.md`/`docs/ROADMAP.md` updated; no unrelated feature expansion (no Angular/client code
    touched).

## Open questions

None — scope was derived directly from an audit of the existing human-auth code plus the maintainer's
explicit list of assumed-foundation primitives for the follow-up Angular/admin auth spec.

## Outcome

Implementation complete and independently re-verified on `feature/browser-auth-foundation`; committed
on that branch but **not yet pushed or merged** as of this writing (per SDD.md's literal lifecycle,
"done" means merged, so treat this status as "implementation verified, committed, awaiting PR/merge"
until a later note says otherwise).

Two rounds of independent review (a ForgeCMS-hard-rules pass and a spec-vs-diff pass, both run against
the finished branch before any commit) found real defects the original implementation and its own
Design text missed. Both are now fixed, with regression tests. Recorded here in full because they are
exactly the kind of thing a future reader needs to know happened, not just that the outcome looks green
today:

1. **Privilege escalation (critical).** The first draft of `defineUsersCollection()` (Design §4) gave
   `role` no field-level `access.write` restriction. Combined with the collection's own self-service
   `update` grant (`{ id: user.id }` for a non-admin), any authenticated `viewer` — including one who
   just went through the brand-new, role-free `signup()` — could `PATCH` their own record's `role` to
   `admin` through the ordinary generic collection route. This directly contradicted the spec's own
   stated goal for `signup()`. **Fixed:** `role: defineField.select({ ..., access: { write: ['admin'] } })`.
   Regression tests in `browser-auth-integration.test.ts` prove a viewer's self-`role`-write is rejected
   (while a self-`name`-write still succeeds) and that an admin can still change another user's role.
2. **CSRF coverage gap, two parts (critical).** (a) `assertCsrfSafe` was originally called only inside
   `handlers.ts`'s `authorize()`, which only runs when a route/collection statically requires auth. A
   collection with its own function-based `access` — `defineUsersCollection()` itself — takes the
   `resolveOptionalUser` branch instead, which never called `authorize()`, so CSRF was never checked
   for it: a cross-site cookie-only mutation against `/api/v1/users/:id` was **not** rejected. **Fixed**
   by moving the check to the top of `resolveRequest`/`resolveGlobalRequest`, unconditionally, so it
   covers every mutating request regardless of which branch resolves the user (still a no-op for a
   session with no cookie at all, so anonymous-write collections are unaffected). (b) `apps/www`'s and
   `apps/demo-aesthetics`'s admin user-management routes call `requireRole()` directly against a request
   built by a local `createAuthRequest(event)` helper, bypassing `handlers.ts` (and thus the fix above)
   entirely. Before this spec these routes were Bearer-only and so structurally CSRF-immune; the new
   cookie fallback made them cookie-reachable without protecting them — a cross-site cookie-only
   `POST /api/auth/users` with `role: "admin"` in the body would have succeeded. **Fixed:**
   `createAuthRequest` now preserves the real HTTP method (the `Request` constructor otherwise silently
   defaults to `GET`, which would have made `assertCsrfSafe` a permanent no-op here even after adding
   the call), and a `requireAdminAuth()` helper (already existed in `apps/demo-aesthetics`; added to
   `apps/www`, which had been duplicating the same try/catch across four route files) now runs
   `assertCsrfSafe` before `requireRole` in both apps. Regression tests for (a) in
   `browser-auth-integration.test.ts`; (b) is covered by the full `apps/www` e2e suite passing against
   the corrected routes (a unit test would need an h3 event fixture this repo doesn't otherwise use).
3. **Missing runtime dependency (real break for external consumers, not just this repo).**
   `packages/auth/src/users-collection.adapter.ts` gained a **value** import of `isUniqueConstraintError`
   from `@forge-cms/db` (previously only `import type`, erased at compile time). `@forge-cms/auth`'s
   `package.json` still listed `@forge-cms/db` under `devDependencies` — invisible locally (pnpm hoists
   devDeps into `node_modules`) but would break `import '@forge-cms/auth'` for any real external
   consumer who doesn't separately install `@forge-cms/db` (e.g. one using only `ExternalAuthAdapter`).
   **Fixed:** moved to `dependencies`. Also fixed the tooling that should have caught this and didn't:
   `scripts/verify-release.mjs`'s `assertRuntimeImportsDeclared` treated `devDependencies` as
   satisfying a runtime-import check — `dependencySections()` no longer includes it.
4. **Duplicated reason→status mapping (quality).** Two `users.post.ts` routes (`apps/www`,
   `apps/demo-aesthetics`) re-implemented `authFailureResponse`'s reason→status ladder inline, with a
   redundant `? 400 : 400` branch. **Fixed:** exported `authFailureResponse` from `@forge-cms/runtime`
   and had both routes call it.
5. **CSRF/Bearer-detection inconsistency (defense-in-depth, not currently exploitable).** `csrf.ts`'s
   `usesCookieCredential` treated _any_ `Authorization` header as "not a cookie session," while
   `extractToken` only excludes the cookie fallback for a _well-formed_ Bearer header — a request with
   e.g. `Authorization: Basic ...` plus a valid session cookie would authenticate via the cookie while
   skipping the CSRF check. Not reachable from a real browser today (no CORS configuration exists to
   approve the preflight a custom header would need), but cheap to close properly: extracted
   `extractBearerToken` as its own exported function in `token-signer.ts`/`index.ts`, used by both
   `extractToken` and `csrf.ts`'s `usesCookieCredential`, so the two can't drift again.
6. **Documentation drift, not a code defect.** The original Design text overclaimed in three places,
   now corrected in place: `login()` was never intended to enforce the password policy (would lock out
   pre-existing accounts) but §3 implied it did; `@forge-cms/db` was described as "already a dependency"
   when it needed to move sections (item 3 above); "API envelope impact: None" ignored two error-path
   shape changes in `apps/www`'s `login.post.ts`/`me.get.ts` (h3's `createError` shape → the Forge
   envelope) — harmless in practice (verified by e2e) but a real, if small, change.

Also found, unrelated to security: `apps/demo-aesthetics` has its own independent `/api/auth/login` and
`/api/auth/users` routes (not in the original "Affected apps" list) that call
`UsersCollectionAuthAdapter.login`/`createUser` directly — `pnpm typecheck` caught the breaking
`AuthActionResult` return-shape change there. Fixed the same minimal way as `apps/www`'s equivalents.
And: `defineUsersCollection({ slug })` let a consumer rename the collection, but
`UsersCollectionAuthAdapter` had no way to target anything but the hardcoded `'users'` slug — added a
matching `collection` constructor option, needed to give `human-auth.test.ts`'s three D1 sub-tests
isolated tables on the shared real-D1 binding.

All 15 acceptance criteria (as corrected above) verified after every fix: `pnpm format:check &&
pnpm lint && pnpm typecheck && pnpm test && pnpm build` green across all 23 package/app tasks (auth 173
tests, runtime 286 tests including 4 new security-regression tests);
`pnpm test:cloudflare` green (72 tests, including the 3 real-D1 `human-auth.test.ts` cases);
`pnpm release:verify` green — the packed `@forge-cms/runtime`/`@forge-cms/auth` consumer fixture was
extended with a real signup→login→me→CSRF-reject→CSRF-allow→logout sequence through
`defineUsersCollection()` + `UsersCollectionAuthAdapter` + `handleSignup`/`handleLogin`/`handleMe`/
`handleLogout`, all through the packed public surface only. All 13 pre-existing `apps/www` e2e specs
pass against a freshly started dev server (a stale reused Playwright `webServer` process masked the
`authFailureResponse` export briefly during this fixing pass — not a product bug, noted here only so a
future "it passed for me" is read with the right skepticism about server reuse). No Angular/client code
was touched, per the non-goals.
