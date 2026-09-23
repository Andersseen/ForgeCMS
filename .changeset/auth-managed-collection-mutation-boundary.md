---
'@forge-cms/auth': minor
'@forge-cms/runtime': minor
---

Auth-managed collections can no longer be mutated through generic collection CRUD (spec 061). This
closes the last open part of roadmap H02: the users collection could still be created into, updated and
deleted through `runtime.create/update/delete` and `POST/PUT/PATCH/DELETE /api/v1/users`, bypassing
everything `UsersCollectionAuthAdapter` enforces — the last-admin invariant, first-admin provisioning,
password hashing, email normalisation and session versioning. A trusted `runtime.delete({ collection:
'users', id })` removed the only administrator; a hand-rolled `withAuthFields` users collection let an
editor promote themselves to admin.

**Behaviour change (breaking for anyone who wrote users through the generic content API).**
`AuthAdapter` gains one optional method, `managesCollection?(slug): boolean`. Adapters that keep users
in a Forge collection declare it: `UsersCollectionAuthAdapter` claims exactly its configured
`collection` (not the literal `'users'`), and `CompositeAuthAdapter` claims whatever any child claims.
`@forge-cms/runtime` then refuses every `create`/`update`/`delete` of a claimed collection — Local API
with `overrideAccess` `true` (the default) or `false`, and HTTP — with the new
`AuthManagedCollectionError`: HTTP `403`, code `AUTH_MANAGED_COLLECTION`, the same message for every
caller and for a document that does not exist. The refusal happens before hooks, access checks and any
read or write, so it has no side effects. `restoreVersion` and relation cascade/set-null are covered too;
deleting a document that a managed collection references with `onDelete: 'cascade' | 'set-null'` is now
rejected up front (`400`) instead of writing into it. Reads, other collections and adapters that omit
`managesCollection` (`ExternalAuthAdapter`, `SignedTokenAuthAdapter`, `ApiKeyAuthAdapter`,
`InMemoryAuthAdapter`, custom adapters) are unaffected. Use `createUser` / `updateUser` / `deleteUser` /
`signup` (and the host's `/api/auth/users*` routes) for user lifecycle. Custom non-auth fields on a
managed collection (`avatar`, `jobTitle`, …) are therefore read-only through Forge's generic surface.
Direct `DatabaseAdapter` access is trusted low-level infrastructure and remains below this guarantee.

**Also fixed (found while auditing auth-owned fields).** `updateUser(id, { password })` threw `Unknown
column '_sessionVersion'` on libSQL and D1 — the session-freshness counter was written but never
declared, so a password change did not work on any SQL backend, and InMemory returned the counter on
every read. `AUTH_USER_FIELDS` now declares `_sessionVersion` (number, unreadable and unwritable by every
role) next to `passwordHash`, so `withAuthFields()` / `defineUsersCollection()` create the column, the
additive `syncSchema` migration adds it to existing tables, and it is hidden from reads. Existing rows
need no backfill (a missing value means `0`). `withAuthFields()` now lets an explicit declaration win
per field.
