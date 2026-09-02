---
'@forge-cms/auth': minor
'@forge-cms/runtime': minor
'@forge-cms/cloudflare': patch
---

feat: browser auth foundation — cookie sessions, login/signup/logout/me, CSRF protection (spec 053)

- **Cookie sessions.** `UsersCollectionAuthAdapter` and `SignedTokenAuthAdapter`'s shared
  `extractToken` now falls back to a `forge_session` HttpOnly cookie (`@forge-cms/auth`'s new
  `cookie.ts`: `SESSION_COOKIE_NAME`, `parseCookieToken`, `buildSessionCookie`, `buildLogoutCookie`)
  when no `Authorization` header is present — a page refresh authenticates from the cookie alone, no
  client JS required. `ApiKeyAuthAdapter` (machine auth) keeps its own independent, Bearer-only
  `extractToken`, unaffected.
- **`@forge-cms/runtime` gains reusable `handleLogin`/`handleSignup`/`handleLogout`/`handleMe`**
  (`auth-handlers.ts`) — transport-only handlers with the same envelope/error-mapping conventions as
  every other handler. `handleLogin`/`handleSignup` return `{ data: { user, token } }` (unchanged,
  Bearer-compatible) plus a `Set-Cookie`. `handleSignup` is opt-in (`enabled: boolean`) and 404s
  otherwise. `handleLogout` clears the cookie (`204`, idempotent, client-state-only — tokens are
  stateless).
- **CSRF protection.** New `assertCsrfSafe`/`CsrfError`, wired unconditionally into
  `resolveRequest`/`resolveGlobalRequest` (so every mutating collection/global request is covered —
  including a collection with its own function-based `access`, like `defineUsersCollection()` itself,
  not just routes gated by static roles — and not just the new auth endpoints) and `handlePreview`.
  Rejects a `POST`/`PUT`/`PATCH`/`DELETE` authenticated only by the ambient session cookie (no valid
  `Authorization: Bearer`) whose `Origin`/`Referer` doesn't match the request's own host. A request
  authenticated via `Authorization: Bearer` is never subject to the check. `apps/www`'s and
  `apps/demo-aesthetics`'s admin user-management routes (which call the auth adapter directly, bypassing
  `handlers.ts`) get the same protection via a new/consolidated `requireAdminAuth()` helper.
- **`UsersCollectionAuthAdapter` hardening:** email lookups/storage are normalized (trim + lowercase);
  a configurable password policy (`passwordPolicy: { minLength }`, default 8) is enforced on
  `createUser`/the new `signup()`; the very first user ever created — via either method — is always
  bootstrapped to `admin`, so a fresh install can never end up with a non-admin as its only user;
  duplicate-email rejection is now race-safe (catches the database's `UniqueConstraintError`, not just
  an in-process pre-check); a `collection` constructor option lets the adapter target a renamed `users`
  collection. **Breaking:** `login()` and `createUser()` now return
  `AuthActionResult` (`{ ok: true, token, user } | { ok: false, reason }`) instead of
  `{ token, user } | null` — `reason` is one of `invalid-credentials` / `invalid-email` /
  `weak-password` / `email-in-use`, which `handleLogin`/`handleSignup` map to distinct HTTP statuses.
  **`SignedTokenAuthAdapter.login()` is also affected** by the same `AuthActionResult` change (forced
  by the new optional `login?` member on `AuthAdapter` itself) — any consumer calling it directly needs
  the same `{ ok: true/false }` handling.
- **New `signup(input: PublicSignupInput)`** for public self-service signup — `PublicSignupInput` has
  no `role` field at all, so a client cannot smuggle a role through the server API, not just through a
  UI that hides the field.
- **New `defineUsersCollection()`** (`@forge-cms/auth`) — the recommended `users` collection shape:
  required+unique `email`, a `role` select defaulting to `viewer` (write-restricted to
  `access: { write: ['admin'] }` — without this a self-service `viewer` could write their own `role` to
  `admin` through the generic collection route), `passwordHash` via the existing `withAuthFields()`, and
  sensible default `access` (any authenticated user reads/updates their own record; only an admin
  creates, updates any record, or deletes). Opinionated, not mandatory — `withAuthFields()` still works
  standalone for a hand-rolled `users` collection.
- **`@forge-cms/auth` package fix:** `@forge-cms/db` moves from `devDependencies` to `dependencies` — a
  real (not type-only) import of it was added for race-safe duplicate-email handling, and a
  `devDependency` is never installed for a published package's real consumers.
- **`ExternalAuthAdapter` hardening:** `extractToken` now reuses the shared, cookie-aware parser
  instead of its own weaker regex. A network failure or a `5xx` from the validation service now throws
  (surfaces as `500`) instead of silently returning `null` (which would have looked like an ordinary
  `401`) — same "don't mask an outage as unauthenticated" rule spec 049 applied elsewhere. An explicit
  `4xx` still returns `null`.
- `@forge-cms/cloudflare`: new `test/workers/human-auth.test.ts` proves `defineUsersCollection()` +
  `UsersCollectionAuthAdapter` against a real local D1 binding — the generated `passwordHash` column
  and unique `email` index actually work, not just against a mock.
- No behavior change to machine auth (`ApiKeyAuthAdapter`), the typed Local API, or any success-response
  envelope shape. `apps/www`'s existing Bearer/`localStorage` client and all its e2e specs are
  unaffected — the cookie is strictly additive. (`apps/www`'s `login.post.ts`/`me.get.ts` error
  responses move from an ad hoc h3 shape to the standard Forge error envelope as a side effect of
  becoming thin wrappers — harmless in practice, since the client only checks `response.status` there.)
