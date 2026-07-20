---
'@forge-cms/auth': minor
'@forge-cms/angular': minor
---

Introduce real users-collection authentication with PBKDF2 password hashing and users CRUD.

- Added `UsersCollectionAuthAdapter` backed by the configured database adapter.
- Added shared token helpers (`token-signer.ts`) used by both adapters.
- Added `/api/auth/users` routes for listing, creating, updating, and deleting users.
- Extended `CmsApiService` with `getUsers`, `createUser`, `updateUser`, and `deleteUser`.
- Rewrote the admin `/users` page with a VoltUI-based inline form.
- Added an E2E test covering the full users CRUD flow.
