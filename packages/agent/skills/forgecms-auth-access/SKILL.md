---
name: forgecms-auth-access
description: Apply ForgeCMS authentication and access control correctly - roles, row and field access, the Local API overrideAccess pitfall, sessions, CSRF, API keys and secrets.
---

# ForgeCMS auth and access

## Two gates

1. **Local API** (`runtime.find/create/update/delete`) is **trusted by default**: `overrideAccess` defaults to `true`. That is for seed scripts and trusted server code.
2. **HTTP** always enforces access (`overrideAccess: false` plus the resolved user).

If you build an endpoint on the Local API that serves a visitor or editor, you **must** pass the caller's context yourself:

```ts
const asVisitor = { overrideAccess: false, user: null } as const;
await runtime.find({ collection: 'services', ...asVisitor });
await runtime.create({ collection: 'posts', data, user, overrideAccess: false });
```

Never use `overrideAccess: true` in a user-facing flow. It is the easiest way to expose everything.

## Rules

- An access rule is a role array (`['admin']`) or a function that returns a boolean **or a query** (row-level access). Prefer row rules for per-owner data.
- Field-level `access` hides or protects individual fields. A field with `access: { read: [], write: [] }` is omitted for everybody.
- Roles live on the users collection (`defineUsersCollection()` from `@forge-cms/auth`, `withAuthFields`). The **first user is an admin** and the **last admin cannot be removed or demoted**.
- Example: editors may write content but only admins manage users: content collections allow `admin` and `editor`; the users workspace route and users collection `create/update/delete` stay `admin`-only.
- A global has `read` and `update` access only; a query rule cannot authorize its first write - seed it from trusted code.

## Sessions, CSRF, keys

- Browser sessions: an `HttpOnly` cookie holding a 24-hour signed token; cookie-authenticated mutations require CSRF. Logout is client-state only (tokens are stateless).
- Machine access: scoped API keys (hashed, shown once) or Bearer tokens.
- `AUTH_SECRET` (>= 32 bytes) signs tokens: server-only, never in source, never in `[vars]`, never in a browser bundle.
- Never log, return or embed secrets, password hashes or `_sessionVersion`.

## Do not

- Do not widen `read` to `() => true` on collections that hold private data.
- Do not trust `req.user` supplied by a client; pass the user the auth adapter resolved.
- Do not disable CSRF or relax cookie flags to make a client work.
