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

An `expiresAt` (ISO string) can be set at creation; an expired or revoked key fails authentication the
same generic way an unrecognized one does — nothing about _why_ a key was rejected is observable from
the outside.

**Security note:** ForgeCMS never stores plaintext API-key secrets. Only a SHA-256 digest of a
256-bit random secret is persisted; the plaintext is generated with Web Crypto
(`crypto.getRandomValues`) and returned exactly once, at creation.

This branch ships the primitive only — there is no admin UI or HTTP management route for API keys yet.
Build one on top of the programmatic API above if your application needs it.
