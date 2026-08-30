---
title: Machine auth
description: API keys for server-to-server auth — creation, hashing, scopes, and coexisting with human sessions.
group: Server APIs
order: 3
---

Human auth (`UsersCollectionAuthAdapter`, `SignedTokenAuthAdapter`) answers "which person is this?".
Machine auth answers the same question for another **server** — a CI job, a background worker, an
external integration — without a password or a login page.

## The flow

```text
create API key
      ↓
display the secret once
      ↓
send Authorization: Bearer <secret>
      ↓
access rule checks a generic scope
```

```ts
import { ApiKeyAuthAdapter, CompositeAuthAdapter, hasScope } from '@forge-cms/auth';

const apiKeyAuth = new ApiKeyAuthAdapter(); // issues 'forge_<id>_<secret>' keys by default
const auth = new CompositeAuthAdapter([userAuth, apiKeyAuth]); // human + machine, side by side

const runtime = new ForgeCmsRuntime({
  collections: [articles],
  adapters: { database, auth, storage },
  env: { AUTH_SECRET, userDatabase: database, apiKeyDatabase: database }
});

runtime.init();
await runtime.syncSchema(); // provisions the API-key table too — no manual SQL

const { apiKey, secret } = await apiKeyAuth.createApiKey({
  name: 'ci-bot',
  scopes: ['articles:read'],
  metadata: { owner: 'platform-team' }
});
// `secret` is the plaintext key — shown exactly once, right here. It is never persisted or
// returned by createApiKey/listApiKeys/getApiKey again; only `apiKey` (safe metadata) is.
```

A request authenticates the same way whether it carries a human token or an API key — `auth` (the
`CompositeAuthAdapter`) tries each configured strategy in order and returns the first one that
recognizes the credential:

```ts
const user = await auth.requireAuth(request); // works for either kind of Authorization: Bearer …
```

## Checking scopes in access rules

A valid key resolves into an ordinary `AuthUser`/`CmsUser`: `{ id, role: 'machine', scopes, metadata }`.
Existing `access` rules read it exactly like a human role — no separate authorization system:

```ts
const articles = defineCollection({
  slug: 'articles',
  access: {
    read: ({ user }) => hasScope(user, 'articles:read'),
    write: ({ user }) => hasScope(user, 'articles:write')
  },
  fields: {
    /* … */
  }
});
```

`scopes` are plain consumer-defined strings — ForgeCMS does not maintain a registry of valid scope
names, and does not map a scope to a collection or CRUD operation automatically. That policy belongs
in your `access` functions, same as any other rule.

## Managing keys

```ts
await apiKeyAuth.listApiKeys(); // ApiKey[] — never includes the hash or the secret
await apiKeyAuth.getApiKey(id); // ApiKey | null
await apiKeyAuth.revokeApiKey(id); // stops authenticating immediately; the record is kept
await apiKeyAuth.deleteApiKey(id); // removes the record entirely
```

`createApiKey` validates its input: `name` must be non-empty (not just whitespace), and `expiresAt` —
if given — must be a parseable date **in the future**; an already-expired `expiresAt` is rejected at
creation rather than silently accepted. `scopes` are normalized: trimmed, empty strings dropped, and
duplicates removed while preserving the first-seen order.

An `expiresAt` (ISO string) can be set at creation; an expired or revoked key fails authentication the
same generic way an unrecognized one does — nothing about _why_ a key was rejected is observable from
the outside. `revokeApiKey` is idempotent: revoking an already-revoked key is a no-op that keeps the
original `revokedAt`, not a new one. Deleting an already-missing key is a silent no-op; revoking one
throws — the same convention every `DatabaseAdapter.update()`/`delete()` already follows for a missing
record.

`lastUsedAt` is throttled (5 minutes by default, `lastUsedAtThrottleMs` on the constructor to change
it) rather than rewritten on every single authenticated request — the value is observability metadata,
and a write on every request is expensive at volume on a remote DB (D1, libSQL). A failed `lastUsedAt`
write never fails authentication.

## Composing multiple strategies efficiently

`CompositeAuthAdapter` tries each configured adapter's `requireAuth()` in order, but does not blindly
attempt every strategy for every token. An adapter may implement an optional
`canHandleToken(token: string): boolean` — a cheap, synchronous format check — so the composite can
skip a strategy that obviously does not own a given token (an API key never reaches signed-token HMAC
verification, and vice versa) without a wasted DB round-trip or crypto call. Both `ApiKeyAuthAdapter`
and the signed-token-based adapters implement it; a custom `AuthAdapter` that omits it is simply always
attempted, exactly as before this existed — no third-party adapter is required to implement it.

Distinct from routing is error handling: a strategy that rejects a credential as **not mine / invalid**
(a `ForgeAuthError`) causes the composite to fall through to the next strategy, same as always. An
**unexpected** error — a database outage, a misconfigured adapter — propagates instead of being
reinterpreted as "unauthenticated"; the HTTP layer maps it to a `500`, never a misleading `401`.

## Security

- API-key plaintext exists only in the `createApiKey()` return value and the incoming
  `Authorization: Bearer <secret>` header — it is never persisted, logged, or returned by
  `listApiKeys`/`getApiKey`/any error.
- Only a SHA-256 digest of a 256-bit random secret (generated with Web Crypto's
  `crypto.getRandomValues`) is stored; the digest is compared in constant time and never appears in a
  safe/public representation of a key.
- Revoked or expired keys authenticate as invalid — the same generic, non-leaking rejection an unknown
  key gets. Externally, "wrong secret", "expired", "revoked", and "no such key" are indistinguishable.
- Scopes are application-defined strings with no registry and no automatic mapping to CRUD operations —
  authorization is still entirely your `access` functions' responsibility, exactly like a human role
  check (`hasScope(user, 'articles:read')` reads the same way `isAdmin(user)` does).
- `_forge_api_keys` (and any future `_forge_*` internal collection) is a reserved slug:
  `defineCollection`/`defineGlobal` reject a consumer collection or global that collides with it, so it
  cannot be accidentally shadowed or made reachable through generic `/api/v1/*` CRUD.
- The `401`/`403`/`500` boundary is intentionally stable: a missing, invalid, expired, or revoked
  credential is always `401`; a valid identity without the required permission is `403`; an unexpected
  server-side failure (database outage, misconfiguration) is `500` — it is never downgraded to `401`
  or `403`, which would misrepresent an infrastructure problem as an authentication decision.

This branch ships the primitive only — there is no admin UI or HTTP management route for API keys yet.
Build one on top of the programmatic API above if your application needs it.
