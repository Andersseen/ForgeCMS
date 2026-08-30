# 049 — Auth & runtime hardening

- **Status:** done
- **Author:** maintainer direction (Andrii), drafted by agent
- **Date:** 2026-08-30
- **Branch:** (current branch)
- **Affected packages/apps:** `@forge-cms/auth`, `@forge-cms/db`, `@forge-cms/core`, `@forge-cms/runtime`, `@forge-cms/cloudflare`, `@forge-cms/testing`, root `scripts/verify-release.mjs`, `apps/www` docs

## Context / Why

Spec 048 shipped machine auth (`ApiKeyAuthAdapter`, `CompositeAuthAdapter`) as a primitive. ForgeCMS now
has a broad-enough surface (human auth, machine auth, RBAC, row/field access, drafts, versions,
localization, relation integrity, compound indexes) that the next priority is not another feature but
making the existing 0.1.x foundation reliable for real external consumers — auth error semantics, the
401/403/500 HTTP boundary, API-key lifecycle correctness, and DB-adapter schema-sync safety when human
and machine auth share one database. This is a stabilization branch: audit first, fix proven gaps only.

## Goal

Composite auth never masks an unexpected internal failure as an authentication rejection; the HTTP
boundary keeps 401/403/500 distinct; the API-key lifecycle (creation, revocation, deletion, expiry,
scopes) is deterministic and input-validated; schema sync is safe and idempotent when
`ApiKeyAuthAdapter` shares a `DatabaseAdapter` with the main runtime; and machine principals are proven
to reach real collection/field/row-level access through the actual runtime and HTTP pipeline, not just
in isolation.

## Non-goals

GraphQL, plugins, Postgres/Mongo, more field types, billing, teams/organizations, OAuth/SSO/MFA/passkeys,
API-key rotation service, audit-log platform, admin UI for API keys, Angular auth redesign, scope
hierarchies/wildcards, "Typed API v2". No Glossa/domain-specific concepts.

## Design — audit findings

Classified per the branch brief. Only items with a real fix are listed with a design; everything else
is `NO CHANGE NEEDED`.

### BUGs found

1. **DB adapters wipe their collection registry on every `syncSchema()` call** (`InMemoryDatabaseAdapter`,
   `LibSqlDatabaseAdapter`, `D1DatabaseAdapter` all called `this.collections.clear()` before
   re-populating). `ForgeCmsRuntime.syncSchema()` calls `database.syncSchema(config.collections)` and
   then `auth.syncSchema?.()` — when `ApiKeyAuthAdapter` is configured with the **same** `DatabaseAdapter**
instance as the main runtime (the documented, tested wiring: `apiKeyDatabase: database`), its
`syncSchema()`calls`db.syncSchema([_forge_api_keys])`on that shared instance **second**, which
cleared every consumer collection just registered. Effect: D1/libSQL throw`Collection 'X' not
   registered`on the next request; InMemory silently stops enforcing unique constraints. **Fix:** drop`this.collections.clear()`in all three adapters —`syncSchema` upserts by slug instead of replacing
   wholesale. Nothing in the codebase ever relied on "unregister a collection", and this matches the
   existing additive-only migration model.
2. **`handlers.ts`'s `authorize()`/`resolveOptionalUser()`/`handlePreview()` catch _any_ error from
   `auth.requireAuth()`** and convert it to a generic `401` (or silent anonymous fallback), which would
   have defeated a correct `CompositeAuthAdapter` fix at the one boundary that matters most — a real
   consumer talks to the HTTP layer, not the adapter directly. **Fix:** catch only `ForgeAuthError`; let
   any other error propagate to the outer handler `try/catch`, which already maps a non-`ForgeError` to
   `500`.
3. **`CompositeAuthAdapter.requireAuth()` swallows every exception** from a child adapter
   (`try { … } catch { /* always try next */ }`), exactly the dangerous pattern the brief calls out — a
   real DB outage inside one strategy silently becomes a misleading `401`. **Fix:** only continue to the
   next adapter on `ForgeAuthError`; rethrow anything else. (`validateSession()` was already correct —
   no try/catch there, so it already propagates.)

### Security hardening

4. **Reserved internal namespace not enforced.** `_forge_api_keys` is a real internal system collection,
   documented as "never registered in a consumer's `config.collections`" but nothing stopped a consumer
   from doing exactly that (a valid identifier, `_forge_*` included). **Fix:** `defineCollection`/
   `defineGlobal` reject a slug starting with the reserved `_forge_` prefix.
5. **`lastUsedAt` write amplification.** Every successful API-key auth wrote `lastUsedAt`, unconditionally
   — expensive on D1/remote DBs at volume. **Fix:** only write when the stored timestamp is missing or
   older than a conservative default throttle window (5 minutes, configurable via adapter option);
   failure to write never fails authentication (already true, preserved).
6. **`revokeApiKey` was not idempotent.** Calling it twice slid `revokedAt` forward each time. **Fix:**
   no-op (preserve the original timestamp) if already revoked.
7. **`createApiKey` had no input validation.** Empty/whitespace `name`, an already-past or unparseable
   `expiresAt`, and duplicate/empty scope strings were all accepted silently. **Fix:** reject empty
   names, reject invalid or non-future `expiresAt`, normalize scopes (trim, drop empty, dedupe,
   preserve first-seen order).
8. **Credential routing always ran every strategy.** No way for a cheap format check to skip a strategy
   that obviously doesn't own a token (an API-key-shaped token still needlessly attempted against
   signed-token HMAC verify, and vice versa). **Fix:** add an **optional** `canHandleToken?(token):
boolean` to `AuthAdapter`; `CompositeAuthAdapter.requireAuth()` consults it when present (extracting
   the token via the adapter's own `extractToken()` first) and skips the adapter's `requireAuth()`
   entirely when it returns false. Adapters without the method are tried exactly as before — fully
   backward compatible, no consumer-specific prefixes encoded.

### No change needed (verified, not touched)

- `AuthUser`/`CmsUser` are already structurally identical (`scopes`, `metadata`, `role`) — added a
  regression test proving a machine principal reaches a real `access` function through the runtime and
  HTTP pipeline, not just `hasScope()` in isolation.
- `hasScope`/`hasAnyScope`/`hasAllScopes` semantics were already sound (`hasAllScopes(user, [])` is
  vacuously `true`, matching common access-control convention) — documented explicitly and locked in
  with tests rather than changed.
- API-key secret handling already correct end-to-end (plaintext only in the `createApiKey` return value;
  `secretHash` never serialized into any public/list/get/error/log surface) — added explicit regression
  tests rather than relying on visual inspection.
- Timing-safe comparison already sound for the actual value shape it compares (fixed-length SHA-256 hex
  digests) — added negative tests (truncated/extra-separator/wrong-prefix/malformed secrets).
- Delete-of-missing-id / update-of-missing-id conventions were already consistent across all three DB
  adapters (delete = silent no-op, update = throws) — `ApiKeyAuthAdapter.deleteApiKey`/`revokeApiKey`
  already follow this; documented and covered by regression tests instead of changed.

## Implementation plan

- [x] `packages/db`: remove `this.collections.clear()` from `InMemoryDatabaseAdapter`,
      `LibSqlDatabaseAdapter`; `packages/cloudflare`: same for `D1DatabaseAdapter`; regression test at
      the `ForgeCmsRuntime` level proving a shared-adapter `CompositeAuthAdapter` + `ApiKeyAuthAdapter`
      setup keeps consumer collections usable after `syncSchema()`.
- [x] `packages/runtime/src/handlers.ts`: narrow `authorize`/`resolveOptionalUser`/`handlePreview`'s
      catch clauses to `ForgeAuthError` only; tests proving a non-auth error from the adapter surfaces
      as `500`, not `401`.
- [x] `packages/auth/src/composite.adapter.ts`: narrow `requireAuth`'s catch to `ForgeAuthError`; add
      `canHandleToken` consultation; tests for both.
- [x] `packages/auth/src/index.ts`: add optional `canHandleToken?(token: string): boolean` to
      `AuthAdapter`.
- [x] `packages/auth/src/api-key.adapter.ts`: `canHandleToken`, creation validation (name, `expiresAt`,
      scope normalization), idempotent `revokeApiKey`, throttled `lastUsedAt`.
- [x] `packages/auth/src/token-signer.ts` + `signed-token.adapter.ts` / `users-collection.adapter.ts`:
      shared `canHandleToken` for the signed-token format.
- [x] `packages/core/src/identifiers.ts`: reject consumer collection/global slugs starting with
      `_forge_`.
- [x] Regression tests: composite error propagation, HTTP 401/403/500 boundary, api-key lifecycle edge
      cases, access-control integration (boolean/row-level/field-level) through the real runtime/HTTP
      pipeline with a machine principal, scope-helper semantics, reserved-slug rejection, adapter parity
      (InMemory + libSQL + D1) for machine auth.
- [x] Docs: security section in `apps/www/src/content/docs/machine-auth.md`; `docs/STATE.md` updated.
- [x] Changeset for `packages/*` changes.

## Test plan

- `packages/db`, `packages/cloudflare`: existing adapter suites stay green; new test proves calling
  `syncSchema` twice with different collection sets keeps both usable (not just idempotent on the same
  set, which was already tested).
- `packages/auth`: new tests in `composite.adapter.test.ts`, `api-key.adapter.test.ts`, `scopes.test.ts`.
- `packages/runtime`: new tests in `handlers.test.ts` for the 401/403/500 boundary, and a new
  access-control-integration test exercising a machine principal through `operations.find`/`handleList`.
- `packages/testing/src/contracts`: extend/reuse the existing contract runner for API-key auth against
  InMemory + libSQL (+ D1 mock where practical).
- `pnpm --filter <pkg> test` after each package's changes; full gates at the end.

## Acceptance criteria

Matches the 16 acceptance criteria in the branch brief (composite error propagation, credential routing,
creation validation, expiration/revocation determinism, no secret/hash leakage, idempotent schema
lifecycle, machine principals reaching access control, stable 401/403/500, human auth unaffected,
DB-adapter parity, reserved internal slugs, log redaction, security regression tests, packed
external-consumer verification green, docs/state accurate, no unrelated feature expansion).
`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build` green, plus
`pnpm release:verify` (external consumer verification).

## Open questions

None — scope and acceptance criteria were fully specified by the branch brief.

## Outcome

Shipped as planned, no divergence. The most consequential fix was the one found during audit rather
than named in the brief up front: `syncSchema()` clearing (not upserting) each adapter's collection
registry, which broke every subsequent operation once `ApiKeyAuthAdapter` shared a `DatabaseAdapter`
with the main runtime — the documented, tested wiring. All 16 acceptance criteria verified:
`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build` green (726 tests, zero
failures, across all 13 packages/apps), plus `pnpm release:verify` (packed external-consumer
verification, including the machine-auth path) green. See the STATE.md entry dated 2026-08-30 for the
full findings/fixes summary.

## Outcome

<!-- filled at close-out -->
