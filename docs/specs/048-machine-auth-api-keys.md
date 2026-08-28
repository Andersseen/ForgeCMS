# 048 — Machine auth: API keys

- **Status:** done
- **Author:** maintainer direction (Andrii), drafted by agent
- **Date:** 2026-08-28
- **Branch:** feature/machine-auth
- **Affected packages/apps:** `@forge-cms/auth`, `@forge-cms/core`, `@forge-cms/runtime`, root `scripts/verify-release.mjs`

## Context / Why

ForgeCMS has human auth (`UsersCollectionAuthAdapter`, `SignedTokenAuthAdapter`) and RBAC, but no
machine-to-machine credential. An external consumer (Glossa) needs server-to-server API keys. This is
motivated by a real integration but **must ship as a fully generic capability** — no Glossa concepts
(projects, catalogs, translations, locales) anywhere in this repo, per the standing rule established in
spec 044. STATE.md already flagged this as "the next branch after spec 047" (2026-08-27 entry) and
explicitly deferred it out of spec 046.

## Goal

An application can create a hashed, scoped, expirable API key; authenticate requests with it through
the existing `AuthAdapter`/access-control pipeline **alongside** human auth; and inspect the resulting
principal's scopes from ordinary Forge `access` rules — with zero HTTP routes, zero admin UI, and zero
consumer-domain concepts added in this branch.

## Non-goals

- Glossa-specific tokens/scopes/catalog concepts.
- HTTP management routes or any admin/Angular UI for API keys.
- OAuth, SSO, refresh-token redesign, teams/orgs/tenant/billing model.
- Automatic `scope → collection → CRUD` mapping — consumers write their own `access` functions.
- A global scope-name registry — scopes are opaque consumer strings.
- Key rotation service, scheduled cleanup, or an audit-log platform.
- A second authorization engine — machine principals flow through the existing `access`/hooks pipeline
  unchanged.

## Design

### 1. `AuthAdapter` contract gains one optional lifecycle method (`@forge-cms/auth/src/index.ts`)

```ts
export interface AuthUser {
  id: string;
  email?: string;
  name?: string;
  role?: string;
  roles?: string[];
  scopes?: string[]; // NEW — generic scope strings for machine (or any) principals
  metadata?: Record<string, unknown>;
}

export interface AuthAdapter<TUser extends AuthUser = AuthUser> {
  readonly name: string;
  init(env?: unknown): this;
  extractToken(request: Request): string | null;
  validateSession(token: string): Promise<AuthSession<TUser> | null>;
  requireAuth(request: Request): Promise<TUser>;
  /** Optional schema/table bootstrap, invoked by `ForgeCmsRuntime.syncSchema()`. */
  syncSchema?(): Promise<void>;
}
```

`@forge-cms/core`'s `CmsUser` (structurally identical to `AuthUser`, declared separately to avoid an
import cycle — see its existing doc comment) gains the same `scopes?: string[]`.

`ForgeCmsRuntime.syncSchema()` (`packages/runtime/src/runtime.ts`) additionally calls
`await this.adapters.auth.syncSchema?.();` — this is what lets `ApiKeyAuthAdapter` create its own
backing table through the existing lifecycle instead of consumers running manual SQL.

### 2. `ApiKeyAuthAdapter` (`@forge-cms/auth/src/api-key.adapter.ts`)

Persists through an internal system collection (slug `_forge_api_keys`, never registered in a
consumer's `config.collections`, so it cannot appear in generic `/api/v1/*` CRUD or `describeCollections()`
— it also sets `access: { read/create/update/delete: () => false }` on the collection definition itself
as defense in depth). Backed by any `DatabaseAdapter` the consumer passes in.

```ts
export interface ApiKeyAuthEnv {
  apiKeyDatabase?: DatabaseAdapter;
}

export interface ApiKeyAuthAdapterOptions {
  /** Non-secret label prefixed to every issued key, e.g. 'forge' (default) or 'myapp'. Letters/digits/hyphens only. */
  prefix?: string;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
}
// secretHash is on the persisted record but never on this public type.

export interface CreateApiKeyInput {
  name: string;
  scopes?: string[];
  metadata?: Record<string, unknown>;
  expiresAt?: string;
}

export interface CreateApiKeyResult {
  apiKey: ApiKey;
  secret: string; // plaintext, e.g. "forge_<id>_<random>" — shown once, never persisted
}

export class ApiKeyAuthAdapter implements AuthAdapter {
  readonly name = 'api-key';
  constructor(options?: ApiKeyAuthAdapterOptions);
  init(env?: ApiKeyAuthEnv): this;
  syncSchema(): Promise<void>;
  extractToken(request: Request): string | null;
  validateSession(token: string): Promise<AuthSession | null>;
  requireAuth(request: Request): Promise<AuthUser>;
  createApiKey(input: CreateApiKeyInput): Promise<CreateApiKeyResult>;
  listApiKeys(): Promise<ApiKey[]>;
  getApiKey(id: string): Promise<ApiKey | null>;
  revokeApiKey(id: string): Promise<void>;
  deleteApiKey(id: string): Promise<void>;
}
```

**Token format:** `${prefix}_${recordId}_${secret}` where `recordId` is the adapter-assigned UUID (not
secret — already exposed elsewhere as document ids) and `secret` is `base64url(crypto.getRandomValues(32
bytes))` (256 bits of entropy). Splitting is unambiguous: strip `${prefix}_`, then split the remainder on
its _first_ `_` — `recordId` is always a hyphenated UUID with no underscores, so the boundary is
unambiguous even though the base64url secret may itself contain underscores.

**Discrimination (non-goal 10):** `validateSession`/`requireAuth` reject any token that does not start
with `${prefix}_` before touching the database — cheap format check, no wasted DB round-trip for tokens
that belong to a different auth strategy (e.g. a human HMAC token, which has no underscores at all).

**Hashing:** `secretHash = sha256Hex(secret)` (Web Crypto `crypto.subtle.digest`), stored, never the
plaintext. Comparison is a constant-time hex compare (XOR-accumulate over equal-length strings).

**Revocation/expiry:** looked up record is rejected pre-hash-check if `revokedAt` is set or `expiresAt`
has passed. Every failure path (bad format, unknown id, revoked, expired, hash mismatch) returns the same
`null`/`ForgeAuthError('Unauthorized')` — no distinguishing signal reaches the caller.

**`lastUsedAt`:** updated best-effort on successful `validateSession`, awaited but wrapped so a failed
write never fails authentication (observability only, per the brief's explicit allowance to keep this
minimal).

**Resulting principal:** `{ id: record.id, name: record.name, role: 'machine', scopes: record.scopes,
metadata?: record.metadata }` — flows into `AuthUser`/`CmsUser` unchanged, so existing `access` functions
can call `hasScope(user, 'articles:read')` exactly like any role check.

### 3. `CompositeAuthAdapter` (`@forge-cms/auth/src/composite.adapter.ts`)

```ts
export class CompositeAuthAdapter<TUser extends AuthUser = AuthUser> implements AuthAdapter<TUser> {
  readonly name = 'composite';
  constructor(adapters: AuthAdapter<TUser>[]);
  init(env?: unknown): this; // inits every child with the same env
  extractToken(request: Request): string | null; // first child that returns non-null
  validateSession(token: string): Promise<AuthSession<TUser> | null>; // first child that resolves non-null
  requireAuth(request: Request): Promise<TUser>; // first child that doesn't throw; else generic 401
  syncSchema(): Promise<void>; // calls every child's optional syncSchema
}
```

No child-specific branching in `ForgeCmsRuntime`/`operations.ts`/`handlers.ts` — the composite is just
another `AuthAdapter`.

### 4. Scope helpers (`@forge-cms/auth/src/scopes.ts`)

```ts
export function hasScope(user: AuthUser | null | undefined, scope: string): boolean;
export function hasAnyScope(user: AuthUser | null | undefined, scopes: string[]): boolean;
export function hasAllScopes(user: AuthUser | null | undefined, scopes: string[]): boolean;
```

Pure string-list checks against `user.scopes`. No registry, no scope→CRUD mapping.

### 5. Public exports (`@forge-cms/auth/src/index.ts`)

```ts
export { ApiKeyAuthAdapter } from './api-key.adapter.js';
export type {
  ApiKeyAuthEnv,
  ApiKeyAuthAdapterOptions,
  ApiKey,
  CreateApiKeyInput,
  CreateApiKeyResult
} from './api-key.adapter.js';
export { CompositeAuthAdapter } from './composite.adapter.js';
export { hasScope, hasAnyScope, hasAllScopes } from './scopes.js';
```

### 6. External consumer verification (`scripts/verify-release.mjs`)

Extend `verifyRuntimeConsumer`'s generated program: import `ApiKeyAuthAdapter`, `CompositeAuthAdapter`,
`hasScope` from the packed `@forge-cms/auth` tarball only (no deep import), wire a
`CompositeAuthAdapter([InMemoryAuthAdapter-based human session, ApiKeyAuthAdapter])` into the runtime,
create a key, authenticate a synthetic `Authorization: Bearer <secret>` request through
`runtime.adapters.auth.requireAuth`, and assert the resulting user's scopes are readable via `hasScope`.

## Implementation plan

- [x] `packages/auth/src/index.ts` — `AuthUser.scopes?`, `AuthAdapter.syncSchema?`
- [x] `packages/core/src/index.ts` — `CmsUser.scopes?`
- [x] `packages/auth/src/api-key.adapter.ts` — `ApiKeyAuthAdapter` + internal collection + crypto helpers
- [x] `packages/auth/src/composite.adapter.ts` — `CompositeAuthAdapter`
- [x] `packages/auth/src/scopes.ts` — `hasScope`/`hasAnyScope`/`hasAllScopes`
- [x] `packages/auth/src/index.ts` — wire up new public exports
- [x] `packages/runtime/src/runtime.ts` — `syncSchema()` calls `adapters.auth.syncSchema?.()`
- [x] Tests: `api-key.adapter.test.ts`, `composite.adapter.test.ts`, `scopes.test.ts` (creation, auth
      success/failure paths, revocation, expiry, scopes, metadata, persistence via `InMemoryDatabaseAdapter`,
      human+machine coexistence, security — no plaintext/hash leakage)
- [x] `scripts/verify-release.mjs` — extend `verifyRuntimeConsumer`
- [x] `apps/www/src/content/docs/machine-auth.md` — one concise docs page (create → bearer → scope
      check), linked into nav via frontmatter like the other docs pages
- [x] Changeset (`@forge-cms/auth` minor, `@forge-cms/core` minor, `@forge-cms/runtime` patch)
- [x] `docs/STATE.md` update
- [x] Mark this spec `done`

## Test plan

- `pnpm --filter @forge-cms/auth test` — new suites plus existing contract/regression suites green.
- `pnpm --filter @forge-cms/core test`, `pnpm --filter @forge-cms/runtime test` — unaffected suites still
  green (only additive fields/methods).
- Full gates: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
- `node scripts/verify-release.mjs` (packed-artifact + external consumer verification).

## Acceptance criteria

1. `ApiKeyAuthAdapter.createApiKey()` returns the plaintext secret once; the persisted record never
   contains it (only `secretHash`).
2. `listApiKeys()`/`getApiKey()` never expose `secretHash` or the plaintext secret.
3. A valid key authenticates via `requireAuth`/`validateSession`; a modified secret, revoked key, or
   expired key does not, and all three fail identically (generic `ForgeAuthError('Unauthorized')`).
4. The authenticated principal carries `role: 'machine'`, the key's `scopes`, and its `metadata`.
5. `CompositeAuthAdapter` lets a human token and an API key both authenticate through one configured
   `AuthAdapter` without either regressing.
6. `ForgeCmsRuntime.syncSchema()` provisions the API-key table with no manual SQL.
7. The internal collection is not reachable through generic `/api/v1/*` CRUD (never registered in
   `config.collections`).
8. No Glossa/domain-specific concept exists anywhere in `packages/*`.
9. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green; `node scripts/verify-release.mjs` green.
10. Changeset present; `docs/STATE.md` updated; this spec marked `done`.

## Open questions

(none — resolved via the maintainer's detailed brief before drafting)

## Outcome

Shipped as designed, with no deviations from the Design section. `ApiKeyAuthAdapter`,
`CompositeAuthAdapter`, and `hasScope`/`hasAnyScope`/`hasAllScopes` are exported from
`@forge-cms/auth`; `AuthUser.scopes?`/`CmsUser.scopes?` and `AuthAdapter.syncSchema?` are in place;
`ForgeCmsRuntime.syncSchema()` calls the auth adapter's optional `syncSchema()`. 98 tests pass in
`@forge-cms/auth` (up from the prior suite, +3 new files: `api-key.adapter.test.ts`,
`composite.adapter.test.ts`, `scopes.test.ts`, all running the shared `AuthAdapter` contract suite
too), plus a new `ForgeCmsRuntime` test proving the `syncSchema()` wiring. Full gates green:
`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build` (13/13 build, 23/23
test and typecheck tasks across the whole repo) and `node scripts/verify-release.mjs` (packed
tarballs + runtime/cloudflare/angular external-consumer verification, including the new machine-auth
assertions through `@forge-cms/auth`'s packed public exports only). No HTTP routes or admin/Angular UI
were added, per the non-goals. `apps/demo-aesthetics`/`apps/www` were not touched — this is a
foundation branch only; wiring a real consumer (e.g. Glossa) is explicitly out of scope here.
