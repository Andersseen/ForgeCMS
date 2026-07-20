---
'@forge-cms/auth': minor
'@forge-cms/runtime': minor
'@forge-cms/angular': minor
'@forge-cms/admin': minor
---

Add role-based access control (RBAC) enforcement across the backend and admin UI.

- Added `UserRole` type and role helpers (`userRole`, `hasRole`, `hasAnyRole`, `isAdmin`,
  `canWriteContent`, `canManageUsers`) to `@forge-cms/auth`.
- Added `requireRole` and `requireAnyRole` to `UsersCollectionAuthAdapter`.
- Fixed signed tokens to preserve `role` and `name` so sessions carry the user's role.
- Extended runtime HTTP handlers with `allowedRoles`, returning `401` for unauthenticated
  requests and `403` for insufficient roles.
- Protected `/api/auth/users` routes for admin-only access.
- Protected `/api/v1/*` write routes so only admins and editors can create, update, or delete
  documents.
- Added matching role helpers to `@forge-cms/angular`.
- Updated `@forge-cms/admin` layout to load and display the current user and hide the Users
  sidebar item for non-admins.
- Added `readOnly` input to `ForgeCollectionListComponent` to hide write actions for viewers.
- Updated `apps/www` admin pages to respect role permissions.
- Added unit tests for role helpers and runtime RBAC, plus an E2E test covering admin, editor,
  and viewer flows.
