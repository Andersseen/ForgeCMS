# 107 — Define and test the 1.x session revocation policy; add "sign out everywhere"

- **Status:** in-progress
- **Author:** agent draft (scope approved by the maintainer's 1.1.0 / V2-01 brief, 2026-11-17)
- **Date:** 2026-11-17
- **Branch:** `feat/admin-angular-22` (the single 1.1.0 PR, #127)
- **Affected packages/apps:** `@forge-cms/auth` (optional contract method + implementation), `@forge-cms/runtime` (new handler), docs
- **Release:** part of **1.1.0** (MINOR)

## Context / Why

Sessions are stateless HMAC-signed tokens that last 24 h (`SESSION_TTL_SECONDS`). `UsersCollectionAuthAdapter` embeds the user row's `_sessionVersion` in each token and re-reads the row on every request, and a password change bumps the version (spec 058). LIMITATIONS.md says only "logout cannot revoke a Bearer token; a password change invalidates earlier sessions". It doesn't say what else revokes, how quickly, or what each adapter can do. V2-01 asks to clarify and test this, to add "sign out everywhere" if that can be done compatibly, and to move anything breaking to a 2.0 note.

## Goal

The revocation behaviour of 1.x is stated in one table and pinned by tests. A signed-in user, or an admin through the Local API, can end every session of an account immediately.

## Compatibility impact

**Backward compatible (MINOR).**

- `AuthAdapter` gains an **optional** `revokeSessions?(userId): Promise<boolean>`. Existing custom adapters stay valid, and nothing calls it unless the new handler is mounted.
- `UsersCollectionAuthAdapter.revokeSessions` reuses the existing `_sessionVersion` mechanism, so the token format and the schema are unchanged.
- New export `handleLogoutEverywhere` (`api-baseline/_forge-cms_runtime.json`). `handleLogout` is unchanged.

## Non-goals (→ [2.0 notes](../roadmap/v2/2.0-NOTES.md))

- Revoking one session while keeping the others, or listing sessions: this needs a stored per-session record and a contract change.
- A shorter lifetime or refresh tokens: this changes a documented default.
- An admin-UI button: the server contract comes first. `@forge-cms/angular` does not call the new route yet.

## Design

```ts
// @forge-cms/auth — AuthAdapter (optional)
revokeSessions?(userId: string): Promise<boolean>;

// @forge-cms/runtime
export function handleLogoutEverywhere<TEnv>(context: ApiContext<TEnv>, options: AuthHandlerOptions<TEnv>): Promise<Response>;
```

`handleLogoutEverywhere` checks, in order:

1. The CSRF rule of `handleLogout` (cookie-credentialed cross-site POST → `403`).
2. The adapter has no `revokeSessions` → `404 NOT_FOUND`.
3. No valid session → `401 UNAUTHORIZED`.
4. `revokeSessions(user.id)`, then `204` and the cleared cookie.

`UsersCollectionAuthAdapter.revokeSessions` reads the row (`false` when it is missing) and writes `_sessionVersion + 1`. Two concurrent bumps may both write the same value, which still invalidates every earlier token.

### The 1.x policy (UsersCollectionAuthAdapter)

| Event                                       | Existing sessions                                                  |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `handleLogout`                              | this browser's cookie cleared; copies elsewhere valid until expiry |
| `handleLogoutEverywhere` / `revokeSessions` | all of the user's sessions end on the next request                 |
| password change                             | all end (unchanged)                                                |
| user deleted                                | all end on the next request                                        |
| role change                                 | continue, with the new role on the next request                    |
| rehash on login (spec 105)                  | unaffected                                                         |
| `AUTH_SECRET` rotation                      | every session of every user ends                                   |

`SignedTokenAuthAdapter` and `ExternalAuthAdapter` verify tokens without a lookup and cannot revoke (`404`).

## Implementation plan

- [x] contract method + `UsersCollectionAuthAdapter.revokeSessions`
- [x] `handleLogoutEverywhere` + export + `api-baseline`
- [x] `session-revocation.test.ts` on InMemory and libSQL (plain logout, everywhere via cookie and Bearer, other users untouched, re-login, password change, role change, deletion, 401, CSRF 403, unknown user, a non-revoking adapter → 404)
- [x] docs: browser-auth "Session revocation", LIMITATIONS "Sessions", REFERENCE, `docs/roadmap/v2/2.0-NOTES.md`
- [x] changeset, STATE.md

## Acceptance criteria

1. After `handleLogoutEverywhere`, every token the user held before (cookie and Bearer) gets `401` from `handleMe`; other users' tokens get `200`; a new login works.
2. A plain logout leaves a copied token valid (documented, tested).
3. Password change and deletion end sessions; a role change applies on the next request (tested).
4. Anonymous `401`, cross-site cookie `403`, non-revoking adapter `404`.
5. `api-baseline` gains exactly `handleLogoutEverywhere`; gates green.

## Outcome

<!-- Fill when merged. -->
