---
'@forge-cms/runtime': patch
'@forge-cms/auth': patch
'@forge-cms/angular': patch
---

Foundation hardening (spec 058): closes several confirmed access-bypass and concurrency gaps in
alternate content paths that did not go through the normal Local API pipeline.

`@forge-cms/runtime`:

- Version history (`listVersions`/`getVersion`) now enforces the owning document's current read
  access, row-level policy, and draft visibility, and projects field-level hidden values out of
  returned snapshots — an untrusted caller could previously enumerate/read the history of a document
  they could not otherwise read or see hidden fields of.
- `restoreVersion` now routes through the same `update()` pipeline as a normal write (access,
  field-write checks, validation, hooks, one labeled version) instead of writing through the adapter
  directly, bypassing all of that.
- `preview()` (Local API and HTTP) now enforces create/update access, field-write access, and
  field-read projection, and forwards caller identity into relation population — previously it read
  the raw stored document and merged caller data with no access enforcement at all. The HTTP
  `handlePreview` handler now delegates to `preview()` instead of duplicating (and independently
  under-enforcing) the same logic; its unused `allowDraftPreview` option is removed.
- Relation/upload population (`depth: 1`) now enforces the _target_ collection's own read/row/draft
  policy, not just field-level projection — a readable parent no longer grants visibility into an
  unreadable or draft target.
- Relation integrity (cascade/set-null on delete) now enforces self-relations (previously silently
  skipped for same-collection relations), routes dependent mutations through the real delete/update
  pipeline (hooks, validation, versions, recursive relation integrity) with cycle protection, uses a
  real database query instead of a full-table scan for many-relation lookups, and rejects a
  `set-null` relation on a `required` field before any mutation instead of deep inside a partial
  cascade.
- Globals now enforce draft visibility on read and support `depth: 1` relation population instead of
  silently ignoring it.

`@forge-cms/auth` (`UsersCollectionAuthAdapter`):

- Sessions are re-validated against the current user row on every request: a demoted or renamed
  user's session reflects the change immediately, and a deleted user's session is invalidated. A
  password change invalidates every session issued before it.
- The first-admin bootstrap race (two concurrent signups both becoming admin) is closed using an
  atomic, unique-index-backed claim, scoped per users-collection.
- The last-admin removal race is narrowed with a post-write re-verification and best-effort
  compensation; this is an explicitly bounded, non-atomic mitigation, not a full fix — see
  `docs/specs/058-foundation-hardening-runtime-policy-consistency.md` §7b for the documented residual
  gap.

`@forge-cms/angular`:

- `ForgeCmsConfig` gains an optional `authBaseUrl` so a host mounted under a custom path can
  configure the auth transport without replacing `CmsApiService` (previously every auth method
  hardcoded `/api/auth/*`, while content methods already honored `baseUrl`).
- `getCollections()` now preserves the server's Forge error code/message instead of throwing a
  generic `Error`.
