# 006 — Auth: login + protected writes

- **Status:** done
- **Author:** agent draft
- **Date:** 2026-07-07
- **Branch:** main
- **Affected packages/apps:** @forge-cms/auth, @forge-cms/angular, apps/www

## Context / Why

PLAN.md P2-2. Today the demo API is intentionally open — no adapter provides real login, and no write
route enforces auth. This spec adds a real, edge-compatible `AuthAdapter` (signed tokens, not a fake
one), a login page with visible demo credentials (this is a public demo — showing the credentials
that unlock write access is the intended, standard pattern, same as e.g. Payload's own hosted demos),
and protects the three write routes.

## Goal

A visitor can log in with published demo credentials on a login page; after logging in, create/edit/
delete operations succeed; without logging in, they return 401. Read/browse stays open to everyone
(unchanged) — only writes are protected.

## Non-goals

- Real user management (signup, password reset, multiple accounts) — one hardcoded demo user.
- Roles/permissions beyond "authenticated or not" — no per-field or per-collection access control.
- Refresh tokens / session renewal — a single fixed-expiry token (24h), re-login after that.
- Hiding or disabling the New/Edit/Delete buttons in the UI when logged out — non-goal for this spec;
  attempting a write while logged out gets a 401 from the server, and the client redirects to
  `/login`. A nicer "logged out" UI state is a reasonable future improvement, not required here.
- `users` collection integration (STATE.md already lists this as a known gap or `@forge-cms/auth`) —
  the demo user is not a document in the `users` collection; it's config baked into the adapter.
- Rate-limiting / brute-force protection on the login endpoint.

## Design

### 1. `SignedTokenAuthAdapter` (`@forge-cms/auth`, new file `signed-token.adapter.ts`)

A minimal HS256-JWT-like adapter using only the Web Crypto API (`crypto.subtle`) — no `jsonwebtoken`/
`jose` dependency, consistent with CONVENTIONS.md's near-zero-runtime-deps rule and edge compatibility
(Web Crypto works identically in Node 18+ and Workers).

```ts
export interface SignedTokenEnv {
  AUTH_SECRET?: string; // falls back to a fixed dev secret if absent (demo only, documented as such)
}

export interface DemoCredentials {
  email: string;
  password: string; // plaintext, published on the login page — intentional for a public demo
}

export class SignedTokenAuthAdapter implements AuthAdapter {
  readonly name = 'signed-token';

  init(env?: unknown): this; // reads AUTH_SECRET from env, else a fixed dev-only fallback constant
  extractToken(request: Request): string | null; // same Bearer-header parsing as the other adapters
  validateSession(token: string): Promise<AuthSession | null>; // verifies signature + exp via crypto.subtle.verify
  requireAuth(request: Request): Promise<AuthUser>; // same shape as the other adapters

  /** Validates email/password against the one hardcoded demo user; returns a signed token + user, or null. */
  async login(email: string, password: string): Promise<{ token: string; user: AuthUser } | null>;

  /** Signs a token for a given user directly — used by `login()` and by the contract test's authenticated-request setup. */
  async issueToken(user: AuthUser): Promise<string>;
}
```

Token payload: `{ sub: user.id, email, roles, exp }` (exp = now + 24h). The demo password is compared
by hashing the submitted value with SHA-256 (`crypto.subtle.digest`) and comparing against a
precomputed hash constant — avoids a plaintext credential sitting in the adapter's source, even though
the same credential is intentionally displayed on the login page.

Demo credential (published on the login page, not secret): `demo@forgecms.dev` / `forgecms-demo`.

Must pass `runAuthAdapterContractTests` — needs `issueToken()` as the contract test's
`setupAuthenticatedRequest` hook (mirrors `InMemoryAuthAdapter.registerSession`'s role in its own
contract test file).

### 2. `apps/www` wiring

- `apps/www/src/server/api/runtime.ts`: swap `auth: new InMemoryAuthAdapter()` →
  `auth: new SignedTokenAuthAdapter()`. This also flips `GET /api/status`'s `auth.configured` to
  `true` (QW-2's fix: `configured: runtime.adapters.auth.name !== 'in-memory'`) — the status route
  finally reports something real.
- New `apps/www/src/server/routes/api/auth/login.post.ts`: reads `{ email, password }`, calls
  `serverRuntime.adapters.auth.login(email, password)` (adapter-specific method, cast/access via the
  concrete adapter type since it's not part of the shared `AuthAdapter` contract — same pattern
  `InMemoryAuthAdapter.registerSession` already uses outside the contract), returns
  `{ data: { token, user } }` on success, 401 on failure.
- **Revised during implementation (2026-07-08):** by the time this spec was implemented, PLAN.md
  P2-1.5 had already landed (spec 007) — the three write routes now delegate to
  `@forge-cms/runtime`'s `handleCreate`/`handleUpdate`/`handleDelete`, which already implement exactly
  this gate via `HandlerOptions.requireAuth` (calls `runtime.adapters.auth.requireAuth(context.request)`,
  returns a 401 `Response` on failure). So no bespoke `require-write-auth.ts` helper was written —
  each write route instead just passes `requireAuth: true` in its call to the matching handler. Same
  observable behavior as originally designed, less duplicated code. GET routes (`list`, `read`,
  `collections`) are untouched — reads stay open.

### 3. `@forge-cms/angular` changes

- New `ApiAuthError extends Error` (parallel to spec 004's `ApiValidationError`) thrown by
  `CmsApiService` methods when a response is `401`, so the UI can distinguish "not logged in" from
  other failures.
- New `CmsApiService.login(email, password): Promise<{ token: string; user: AuthUser }>` calling
  `POST /api/auth/login`, throwing on failure.
- `createDocument`/`updateDocument`/`deleteDocument` updated so a `401` throws `ApiAuthError` (reusing
  the same `toApiError`-style helper from spec 004, extended with a status-code branch).

### 4. Login page (`apps/www`)

- New top-level route `path: 'login'` in `app.routes.ts` (sibling of `admin`, not nested inside
  `AdminLayout` — a login screen shouldn't show the dashboard chrome).
- New `apps/www/src/app/pages/login/login.page.ts`: email/password inputs (`VoltInput`), a submit
  button, a visible hint block with the demo credentials, and an error message on failed login. On
  success: store the token (`localStorage.setItem('forge-auth-token', token)`), navigate to
  `/admin/collections`.
- `apps/www/src/app/app.config.ts`: wire `provideForgeCms({ authToken: () =>
localStorage.getItem('forge-auth-token') })` so `CmsApiService` automatically attaches the stored
  token to every request (already-supported config shape — no `@forge-cms/angular` change needed for
  this part).
- `collection-detail.page.ts`'s `onSave`/`deleteDoc` catch blocks: when `err instanceof ApiAuthError`,
  navigate to `/login` instead of the existing generic `window.alert` fallback.
- Small addition to `admin.layout.ts`: a "Log in" / "Log out" link in the header (log in → `/login`;
  log out → clear the stored token and reload). Minimal — no attempt to reactively track auth state
  beyond checking `localStorage` at render time.

## Implementation plan

- [x] `packages/auth/src/signed-token.adapter.ts`: `SignedTokenAuthAdapter` (Design §1)
- [x] `packages/auth/src/signed-token.adapter.test.ts`: contract tests + login/issueToken/expiry tests
- [x] `packages/auth/src/index.ts`: export the new adapter
- [x] Changeset (minor, `@forge-cms/auth`)
- [x] `apps/www`: swap the auth adapter, add `login.post.ts`, wire `requireAuth: true` into the three
      write routes' handler calls (Design §2, revised)
- [x] `packages/angular/src/index.ts`: `ApiAuthError`, `CmsApiService.login()`, 401 handling in
      create/update/delete (Design §3)
- [x] Changeset (minor, `@forge-cms/angular`)
- [x] New login page + route + `app.config.ts` wiring + admin layout login/logout link (Design §4)
- [x] Manual verification: attempt a create while logged out → 401; log in with the published demo
      credentials via curl and via a real browser pass → retry → succeeds; reads unaffected
- [x] Update STATE.md (`@forge-cms/auth` row: real adapter exists; `apps/www` row: writes protected)
- [x] Full gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

## Test plan

- `packages/auth`: contract suite via `runAuthAdapterContractTests`; adapter-specific tests for
  `login()` (correct/incorrect password), token expiry (a token signed with `exp` in the past fails
  `validateSession`), and tampered-token rejection (flip a character in the signature, expect `null`).
- Manual, `pnpm dev:www`: the flow described in the Implementation plan's verification step.
- This composes with P1-4's e2e spec — flag there that it may need a login step added once this spec
  ships (not this spec's job to update that file, just noting the dependency).

## Acceptance criteria

1. `POST /api/v1/posts` (or any write) without a token returns 401.
2. `POST /api/auth/login` with the published demo credentials returns a token; using that token as a
   Bearer header makes the same write succeed.
3. `GET /api/v1/posts` (and other reads) work with no token, unchanged.
4. The login page shows the demo credentials in plain sight and logs the user in on submit.
5. `GET /api/status` reports `auth.configured: true` once `SignedTokenAuthAdapter` is wired in.
6. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.

## Open questions

None — ready for approval as written. (Unlike spec 005, nothing here requires provisioning real cloud
infrastructure; `AUTH_SECRET` can be left unset to use the documented dev-only fallback for the demo,
or set as a Cloudflare secret later without any code change.)

## Outcome

Shipped as designed, with the Design §2 revision noted above (reuse `HandlerOptions.requireAuth`
instead of a bespoke helper, since spec 007 landed first). Verified end-to-end: 401 without a token,
successful login + authenticated write via curl, and a real Playwright-driven browser pass of the
login page (renders, submits, redirects to `/admin/collections`, stores the token, "Log out" appears
in the header).
