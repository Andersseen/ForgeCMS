---
'@forge-cms/db': patch
'@forge-cms/runtime': patch
'@forge-cms/cloudflare': patch
---

fix: real-Cloudflare-runtime integration testing surfaces and fixes two production-parity bugs (spec 051)

- **`@forge-cms/cloudflare`** gains a real-local-Cloudflare-Workers-runtime integration suite
  (`pnpm test:cloudflare`, `@cloudflare/vitest-plugin` — Miniflare/workerd, real D1 + R2 bindings, no
  account/credentials/remote resources), kept separate from the existing fast mock-based `pnpm test`.
  It proves — against real bindings, not only the hand-rolled mock — D1 schema sync (incl. idempotent
  repeat calls and the spec-049 shared-`ApiKeyAuthAdapter`-instance coexistence guarantee), compound
  unique indexes, the full nested `and`/`or`/multi-sort/`containsValue` query contract (reusing the
  existing shared contract suites, not duplicating them), the spec-050 empty-OR access-constraint
  deny-all fix, JSON/relation/API-key-scope round-tripping, `ApiKeyAuthAdapter`'s full lifecycle,
  `CompositeAuthAdapter` correctly propagating a real D1 failure instead of downgrading it to a 401,
  one full real-Worker-runtime HTTP request/response path, additive schema evolution, and
  binding-validation error messages against a real Miniflare `env` shape — plus the `StorageAdapter`
  contract and specifics against a real local R2 binding.
- **Bug fix (`@forge-cms/db`):** real D1's raw unique-constraint error message carries a trailing
  diagnostic suffix (`table.col1, table.col2: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)`)
  that the D1 test mock never reproduced. `parseSqliteUniqueConstraintMessage` naively split on `.`/`,`
  without stripping it, corrupting the last column's name in a compound-unique conflict — which would
  have leaked that diagnostic text into `UniqueConstraintError.fields` and the public HTTP error
  response's `details`. Fixed, with a new dedicated unit test file, and fed back into the D1 mock so
  this bug class is now caught by the fast unit suite too.
- **Bug fix (`@forge-cms/runtime`):** deleting an upload-enabled document's underlying storage object
  used to happen only in `handlers.ts` (the HTTP layer) — a direct Local API caller (server code, a
  hook, a seed script) orphaned the object. Moved into `operations.ts`'s `deleteDocument` itself
  (storage deleted only after the database delete succeeds, never on a denied/failed delete,
  best-effort/log-only on cleanup failure); `handlers.ts`'s `handleDelete` dropped its now-duplicate
  copy.
- **Packaging fix (`@forge-cms/cloudflare`):** `@forge-cms/storage` was missing from `dependencies`
  even though `r2.adapter.ts` imports its types (it only worked via pnpm hoisting) — added. Removed the
  unused `drizzle-orm` devDependency (the adapter hand-builds SQL).
