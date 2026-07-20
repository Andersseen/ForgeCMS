# 009 — Add real users-collection auth

- **Status:** completed
- **Author:** agent draft
- **Date:** 2026-07-19
- **Branch:** feature/009-real-auth-with-users-collection
- **Affected packages/apps:** `@forge-cms/auth`, `@forge-cms/angular`, `@forge-cms/admin`, `apps/www`

## Context / Why

Today's auth is a single hardcoded demo user baked into `SignedTokenAuthAdapter`. That blocks any real multi-user use case and makes the demo feel like a toy. `STATE.md` lists "users collection integration for auth" as the next priority. This spec replaces the hardcoded user with a real `users` collection stored in the configured database (D1 in production, in-memory in local dev).

## Goal

Users can log in with real credentials stored in the `users` collection, and admins can create/edit/delete other users from the admin UI.

## Non-goals

- Public self-signup (only admins create users for now).
- Role-based access control enforcement beyond "authenticated or not" (roles are stored but not enforced yet).
- Password reset / email flows.
- OAuth or external identity providers.
- Moving the `users` collection out of the normal database schema.

## Design

### New auth adapter

Add `UsersCollectionAuthAdapter` in `@forge-cms/auth`.

```ts
// packages/auth/src/users-collection.adapter.ts
import type { DatabaseAdapter, DatabaseRecord } from '@forge-cms/db';
import type { AuthAdapter, AuthSession, AuthUser } from './index.js';

export interface UsersCollectionAuthEnv {
  AUTH_SECRET: string;
  userDatabase: DatabaseAdapter;
}

export interface CreateUserInput {
  email: string;
  password: string;
  name?: string;
  role?: 'admin' | 'editor' | 'viewer';
}

export class UsersCollectionAuthAdapter implements AuthAdapter {
  readonly name = 'users-collection';

  init(env?: UsersCollectionAuthEnv): this;

  // AuthAdapter contract
  extractToken(request: Request): string | null;
  validateSession(token: string): Promise<AuthSession | null>;
  requireAuth(request: Request): Promise<AuthUser>;

  // Users-specific API
  login(email: string, password: string): Promise<{ token: string; user: AuthUser } | null>;
  createUser(input: CreateUserInput): Promise<{ token: string; user: AuthUser } | null>;
  listUsers(): Promise<AuthUser[]>;
  updateUser(id: string, input: Partial<CreateUserInput>): Promise<AuthUser | null>;
  deleteUser(id: string): Promise<void>;
}
```

Implementation details:

- Passwords are hashed with Web Crypto PBKDF2 (edge/Worker compatible, no Node-only deps). Stored as a single base64url string containing salt + derived key.
- `login()` finds the user by email, verifies the password, and issues a signed token via the existing token logic extracted from `SignedTokenAuthAdapter`.
- `createUser()` hashes the password and stores `{ email, name, role, passwordHash }` in the `users` collection.
- `listUsers()` returns users without `passwordHash`.
- `updateUser()` re-hashes the password only when a new one is provided.
- `deleteUser()` removes the user record.

### Token helper

Extract the token signing/verification helpers from `SignedTokenAuthAdapter` into an internal reusable module so both adapters share the same token format and `AUTH_SECRET` handling. The public API of `SignedTokenAuthAdapter` remains unchanged.

### Demo seed

In `apps/www/src/server/api/runtime.ts`, after schema sync, seed the `users` collection with a single demo admin if it is empty:

```ts
{
  email: 'demo@forgecms.dev',
  name: 'Demo Admin',
  role: 'admin',
  passwordHash: '<hash of "forgecms-demo">'
}
```

The existing demo login page credentials continue to work, but now against real stored data.

### Server routes

Keep the existing `/api/auth/me` and `/api/auth/login` routes, but switch `apps/www` to use `UsersCollectionAuthAdapter` and call `auth.login()`.

Add new routes under `/api/auth/users` (auth-protected):

- `GET /api/auth/users` — list users (no password hashes).
- `POST /api/auth/users` — create user.
- `PUT /api/auth/users/:id` — update user.
- `DELETE /api/auth/users/:id` — delete user.

These routes live next to the auth routes and are thin wrappers around `serverRuntime.adapters.auth`.

Important: do **not** expose users through `/api/v1/users` until the runtime supports hidden/sensitive fields. That avoids leaking `passwordHash` through the generic CRUD API.

### Angular SDK

Extend `CmsApiService` in `@forge-cms/angular`:

```ts
async createUser(input: CreateUserInput): Promise<AuthUser>;
async getUsers(): Promise<AuthUser[]>;
async updateUser(id: string, input: Partial<CreateUserInput>): Promise<AuthUser>;
async deleteUser(id: string): Promise<void>;
```

All new methods use `/api/auth/users` and the standard envelopes.

### Admin UI

Make `apps/www/src/app/pages/admin/users/users.page.ts` functional using only `@voltui/components`:

- `VoltCard` for the page container and form.
- `VoltTable` / `VoltTableRow` / etc. for the users list.
- `VoltButton` for "New user", edit, delete.
- `VoltInput`, `VoltLabel`, `VoltError` for the form.
- `VoltNativeSelect` for the role selector.
- Form lives inline in a card or in a `VoltDialog` if it works reliably; otherwise use a dedicated create/edit card in the same page (no custom hand-rolled modals).

Columns: name, email, role, actions (edit/delete). Password is never shown.

## Implementation plan

- [x] Extract shared token signing/verification helpers from `SignedTokenAuthAdapter` into an internal module in `@forge-cms/auth`.
- [x] Implement `UsersCollectionAuthAdapter` with PBKDF2 password hashing and users CRUD.
- [x] Add unit tests for `UsersCollectionAuthAdapter` (login success/failure, createUser, updateUser password rehash, listUsers excludes passwordHash).
- [x] Update `apps/www/src/server/api/runtime.ts` to use `UsersCollectionAuthAdapter` and seed a demo admin user.
- [x] Update `apps/www/src/server/routes/api/auth/login.post.ts` to use the new adapter.
- [x] Add `apps/www/src/server/routes/api/auth/users.get.ts`, `users.post.ts`, `users/[id].put.ts`, `users/[id].delete.ts`.
- [x] Extend `@forge-cms/angular` `CmsApiService` with user-management methods.
- [x] Rewrite `apps/www/src/app/pages/admin/users/users.page.ts` as a functional users manager using VoltUI components.
- [x] Add e2e test: log in with demo credentials → create a new user → verify it appears → delete it.
- [x] Add changesets for `@forge-cms/auth` and `@forge-cms/angular`.
- [x] Update `docs/STATE.md`.
- [x] Run full gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## Test plan

- Unit: `packages/auth/src/users-collection.adapter.test.ts` covers hashing, login, create, update, delete, and passwordHash exclusion.
- Contract: `UsersCollectionAuthAdapter` passes `runAuthAdapterContractTests` with a seeded user.
- Manual: `pnpm dev:www` → `/login` → demo credentials → `/admin/users` → create a user → log out → log in as the new user.
- E2E: extend `apps/www/e2e/admin-crud.spec.ts` (or new `users.spec.ts`) with the create/delete user flow.

## Acceptance criteria

1. `demo@forgecms.dev` / `forgecms-demo` still logs in successfully, but now validates against the `users` collection in the database.
2. `GET /api/auth/me` returns the currently logged-in user from the `users` collection.
3. `POST /api/auth/users` creates a user with a PBKDF2-hashed password.
4. `GET /api/auth/users` never returns `passwordHash`.
5. The admin `/users` page lists users and allows create, edit, and delete using VoltUI components only.
6. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` are green.
7. `docs/STATE.md` is updated.

## Open questions

1. Should the initial demo admin password remain `forgecms-demo` or should it be configurable via env? (Default: keep current demo credentials for continuity.)
2. Do we attempt `VoltDialog` for the create/edit form, or use an inline card to avoid the modal uncertainty noted in spec 008? (Default: try `VoltDialog` first; fall back to inline card if it cannot be verified.)

## Outcome

Spec 009 completed on 2026-07-20. `UsersCollectionAuthAdapter` is now the real auth provider in
`apps/www`, backed by the configured database and PBKDF2 password hashing. The demo admin
(`demo@forgecms.dev` / `forgecms-demo`) is seeded into the `users` collection on first request and
still logs in. Auth-protected `/api/auth/users` routes provide CRUD for user management, and the
admin `/users` page is a functional VoltUI-based manager. An e2e test (`apps/www/e2e/users.spec.ts`)
covers the full create/edit/delete flow. Changesets added for `@forge-cms/auth` and
`@forge-cms/angular`; `docs/STATE.md` updated.
