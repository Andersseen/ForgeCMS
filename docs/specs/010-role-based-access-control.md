# 010 — Role-based access control

- **Status:** done
- **Author:** agent draft
- **Date:** 2026-07-20
- **Branch:** feature/010-role-based-access-control
- **Affected packages/apps:** `@forge-cms/auth`, `@forge-cms/runtime`, `@forge-cms/angular`, `@forge-cms/admin`, `apps/www`

## Context / Why

Spec 009 added real users with `role: 'admin' | 'editor' | 'viewer'`, but the runtime and UI still
treat every authenticated user as an admin. `STATE.md` lists this as the next priority:
roles exist on the model but are not enforced anywhere yet.

## Goal

Enforce role-based permissions in the backend and reflect them in the admin UI, so admins manage
users, editors manage content, and viewers can only read.

## Non-goals

- Field-level or collection-level access control beyond the global role matrix.
- Public self-signup or user invitations.
- Role inheritance, custom roles, or permissions stored in the database.
- Preventing an admin from deleting their own account (out of scope for this spec).
- Changing the auth adapter contract (`AuthAdapter.requireAuth` signature stays unchanged).

## Design

### Roles and permission matrix

```ts
export type UserRole = 'admin' | 'editor' | 'viewer';
```

| Action                                                         | admin | editor | viewer |
| -------------------------------------------------------------- | ----- | ------ | ------ |
| Read any collection (`GET /api/v1/*`)                          | ✅    | ✅     | ✅     |
| Create/update/delete documents (`POST/PUT/DELETE /api/v1/*`)   | ✅    | ✅     | ❌     |
| List/read users (`GET /api/auth/users`, `/api/auth/me`)        | ✅    | ✅\*   | ✅\*   |
| Create/update/delete users (`POST/PUT/DELETE /api/auth/users`) | ✅    | ❌     | ❌     |
| Change user roles                                              | ✅    | ❌     | ❌     |
| Access `/admin/users` UI                                       | ✅    | ❌     | ❌     |

\* `/api/auth/me` always returns the calling user regardless of role. Other user routes are
admin-only.

### Backend authorization

#### `@forge-cms/auth`

Export role utilities from `packages/auth/src/index.ts`:

```ts
export type { UserRole } from './roles.js';
export {
  USER_ROLES,
  userRole,
  hasRole,
  hasAnyRole,
  isAdmin,
  canWriteContent,
  canManageUsers
} from './roles.js';
```

`packages/auth/src/roles.ts`:

```ts
import type { AuthUser } from './index.js';

export type UserRole = 'admin' | 'editor' | 'viewer';
export const USER_ROLES: UserRole[] = ['admin', 'editor', 'viewer'];

export function userRole(user: AuthUser | null | undefined): UserRole;
export function hasRole(user: AuthUser | null | undefined, role: UserRole): boolean;
export function hasAnyRole(user: AuthUser | null | undefined, roles: UserRole[]): boolean;
export function isAdmin(user: AuthUser | null | undefined): boolean;
export function canWriteContent(user: AuthUser | null | undefined): boolean;
export function canManageUsers(user: AuthUser | null | undefined): boolean;
```

Add role-aware helpers to `UsersCollectionAuthAdapter`:

```ts
async requireRole(request: Request, role: UserRole): Promise<AuthUser>;
async requireAnyRole(request: Request, roles: UserRole[]): Promise<AuthUser>;
```

Both validate the token, then throw `ForgeAuthError('Forbidden', 'forbidden')` if the user's role
is insufficient. `requireAuth` remains backwards-compatible (any authenticated user).

#### `@forge-cms/runtime`

Extend `HandlerOptions`:

```ts
export interface HandlerOptions<TEnv = unknown> {
  runtime: ForgeCmsRuntime<TEnv>;
  requireAuth?: boolean;
  allowedRoles?: UserRole[];
}
```

When `allowedRoles` is provided, handlers:

1. Extract the current user via `runtime.adapters.auth.requireAuth(context.request)`.
2. Return `401` if there is no valid session.
3. Return `403` if the user's role is not in `allowedRoles`.

`requireAuth: true` without `allowedRoles` keeps the existing behaviour (any authenticated user).

#### `apps/www` server routes

Keep routes thin. Use the new runtime option or adapter helpers.

- `GET /api/v1/[collection]` and `GET /api/v1/[collection]/[id]` — public (no auth).
- `POST /api/v1/[collection]`, `PUT /api/v1/[collection]/[id]`, `DELETE /api/v1/[collection]/[id]`
  — `allowedRoles: ['admin', 'editor']`.
- `GET /api/auth/users` — `requireRole('admin')`.
- `POST /api/auth/users` — `requireRole('admin')`.
- `PUT /api/auth/users/:id` — `requireRole('admin')`.
- `DELETE /api/auth/users/:id` — `requireRole('admin')`.
- `GET /api/auth/me` — unchanged (any authenticated user).

### Angular SDK / UI

#### `@forge-cms/angular`

Add role helpers that mirror the backend semantics so the UI does not depend on `@forge-cms/auth`
directly:

```ts
export type UserRole = 'admin' | 'editor' | 'viewer';

export function userRole(user: AuthUser | null | undefined): UserRole;
export function isAdmin(user: AuthUser | null | undefined): boolean;
export function canWriteContent(user: AuthUser | null | undefined): boolean;
export function canManageUsers(user: AuthUser | null | undefined): boolean;
```

#### `@forge-cms/admin`

`ForgeAdminLayoutComponent` fetches the current user via `CmsApiService.getCurrentUser()` and:

- Shows the real name, email, and role in the footer.
- Only renders the **Users** sidebar item when the user is an admin.
- Keeps logout behaviour.

`ForgeCollectionListComponent` gets a new `readOnly` input. When `true`, the **New** button and the
edit/delete action buttons are hidden.

`ForgeCollectionFormComponent` is only rendered by the parent for users who can write content, so no
behaviour change is required inside the form itself.

#### `apps/www` pages

- `collection-detail.page.ts`:
  - Loads current user on init.
  - Passes `[readOnly]="!canWriteContent(user())"` to `<forge-collection-list>`.
  - Only renders `<forge-collection-form>` for admins and editors.
  - On save/delete, if the API returns `403`, shows an alert and does not redirect.
- `users.page.ts`:
  - Loads current user on init.
  - If the user is not an admin, shows an error state with "You don't have permission to manage
    users." instead of the form/table.
- `collections.page.ts`:
  - Hides the non-functional "New Collection" button for viewers (already non-functional, but now
    permission-aware).
- `dashboard.page.ts`:
  - No functional changes; dashboard remains accessible to all authenticated users.

### Seeding

The demo admin seeded in `apps/www/src/server/api/runtime.ts` keeps `role: 'admin'`.

## Implementation plan

- [ ] Add `packages/auth/src/roles.ts` with role types and helpers; re-export from `index.ts`.
- [ ] Add `requireRole` / `requireAnyRole` to `UsersCollectionAuthAdapter`.
- [ ] Update `packages/runtime/src/handlers.ts` to support `allowedRoles` and return 401/403.
- [ ] Update `apps/www` server routes:
  - `/api/v1/*` write routes use `allowedRoles: ['admin', 'editor']`.
  - `/api/auth/users/*` routes use `requireRole('admin')`.
- [ ] Add role helpers to `packages/angular/src/index.ts`.
- [ ] Update `@forge-cms/admin` layout to load current user and conditionally show Users nav item.
- [ ] Add `readOnly` input to `ForgeCollectionListComponent` and hide write actions when true.
- [ ] Update `apps/www` pages (collection-detail, users, collections) to respect role.
- [ ] Add unit tests for `roles.ts` and role-aware runtime handlers.
- [ ] Extend E2E test with editor and viewer flows.
- [ ] Add changesets for `@forge-cms/auth`, `@forge-cms/runtime`, `@forge-cms/angular`, and
      `@forge-cms/admin`.
- [ ] Update `docs/STATE.md`.
- [ ] Run full gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm format:check`.

## Test plan

- Unit: `packages/auth/src/roles.test.ts` covers `userRole`, `hasRole`, `hasAnyRole`,
  `canWriteContent`, `canManageUsers`, and the new adapter `requireRole` / `requireAnyRole` methods.
- Unit: `packages/runtime/src/handlers.test.ts` covers 401 for unauthenticated and 403 for viewers
  hitting write handlers; editors are allowed to write.
- Manual: `pnpm dev:www` → log in as demo admin → verify `/admin/users` works; create an editor and
  a viewer; log in as each and verify content write is allowed for editor, blocked for viewer;
  verify users page is inaccessible for non-admins.
- E2E: extend `apps/www/e2e/users.spec.ts` (or add a new `rbac.spec.ts`) with:
  - Admin creates an editor user.
  - Editor logs in, creates a document, and cannot access `/admin/users`.
  - Viewer logs in and cannot create a document or access `/admin/users`.

## Acceptance criteria

1. `POST /api/v1/posts` returns `403` for a viewer and `201` for an editor or admin.
2. `POST /api/auth/users` returns `403` for editors and viewers, `201` (or item envelope) for admins.
3. `GET /api/auth/users` returns `403` for non-admins.
4. `/admin/users` is hidden from and inaccessible to non-admins in the UI.
5. Viewers see collection documents but cannot open create/edit forms or delete.
6. The admin layout displays the current user's real name, email, and role.
7. All existing tests still pass; new unit + e2e tests cover RBAC.
8. `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm format:check` are green.
9. `docs/STATE.md` is updated.

## Open questions

None — approved for implementation.

## Outcome

Spec 010 completed on 2026-07-20. Roles are enforced end-to-end: `/api/auth/users` is admin-only,
`/api/v1/*` writes require admin or editor, the admin layout shows the current user and hides the
Users nav item for non-admins, and collection/users pages disable write UI for viewers. Unit tests
cover role helpers and runtime RBAC; a new E2E test verifies admin/editor/viewer flows. The only
divergence from the draft: the signed token was updated to preserve `role` and `name` so session
validation returns the user's role (a necessary fix discovered during implementation).
