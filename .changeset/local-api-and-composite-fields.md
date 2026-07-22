---
'@forge-cms/runtime': minor
'@forge-cms/core': minor
'@forge-cms/admin': minor
'@forge-cms/angular': minor
'@forge-cms/auth': minor
'@forge-cms/db': minor
'@forge-cms/cloudflare': minor
'@forge-cms/testing': minor
---

Phase 1 of the roadmap: a Local API, function-based access control, a complete hook pipeline, and
composite fields.

**Local API (spec 019).** `ForgeCmsRuntime` now exposes `find`/`findByID`/`create`/`update`/`delete`/
`count`, running the full pipeline — hooks, access, drafts, relation population, validation — with no
HTTP hop and no `Request` to fabricate. This is the intended way to use ForgeCMS from an Analog.js
server route or a seed script. Access control is skipped by default for these direct calls
(`overrideAccess` defaults to `true`); the HTTP handlers always pass `false` plus the resolved user.
The handlers are now a thin transport layer, and operations throw typed errors (`NotFoundError`,
`ValidationFailedError`, `AccessDeniedError`, …) that carry the status the HTTP layer maps to.

**Access control as functions (spec 020).** `access.read`/`create`/`update`/`delete` and field-level
`access.read`/`write` accept a function as well as a role array. Returning a query constraint instead
of a boolean grants access only to matching documents, which is what makes row-level rules ("an
author may only edit their own posts") expressible. Role arrays behave exactly as before.

**Full hook pipeline (spec 021).** Adds `beforeOperation`, `beforeValidate`, `beforeRead`,
`afterRead`, `beforeDelete`, `afterDelete` and `afterOperation` to the existing `beforeChange`/
`afterChange`, plus field-level `beforeValidate`/`beforeChange`/`afterRead` hooks. Before-hooks may
reject an operation (400); after-hooks are logged and never fail an already-committed write.

**Composite fields (spec 022).** New `group`, `array` and `blocks` field kinds, with recursive type
inference, recursive validation reporting dotted error paths (`sections.1.body`), JSON-column
storage, and a recursive admin form control that renders arbitrary nesting.

**Fixes (spec 018).** `withAuthFields()` adds the `passwordHash` column `UsersCollectionAuthAdapter`
writes to, fixing `D1_ERROR: table users has no column named passwordHash` on the D1 path.
`DatabaseAdapter.count` accepts a `where`, and list responses carry real pagination metadata
(`totalDocs`, `page`, `totalPages`, `hasNextPage`, `hasPrevPage`).

Breaking changes:

- `DatabaseAdapter.count(collection, where?)` — adapters outside this repo must accept the new
  optional parameter.
- `filterReadableFields` and `assertWritableFields` are now async and take a `CmsUser | null` instead
  of a role string.
- `DELETE` of a document that does not exist returns 404 instead of 204.
