# 058 — Foundation Hardening / Runtime Policy Consistency

- **Status:** done
- **Author:** agent draft (explicit maintainer directive to execute a Foundation Hardening phase)
- **Date:** 2026-09-18
- **Branch:** (implemented directly on the working tree per maintainer instruction)
- **Affected packages/apps:** @forge-cms/runtime, @forge-cms/auth, @forge-cms/angular, @forge-cms/db,
  @forge-cms/testing, apps/tiny-project, apps/demo-aesthetics, apps/www, CI, docs

## Context / Why

`docs/roadmap/v1/AUDIT.md` (2026-09-06/07) and `docs/roadmap/v1/0.5-contract-baseline.md` /
`0.6-auth-data-integrity.md` documented findings F04–F11: ordinary CRUD in
`packages/runtime/src/operations.ts` has a real access/hooks/validation/versioning pipeline, but
several **alternate content paths** — version history, preview, relation population, cascade/set-null,
auth session freshness, and admin-count concurrency — do not run through it and can bypass guarantees
ordinary reads/writes already enforce. This spec re-verifies every finding against current `main`
(commit series ending `255febb`) before changing anything, and fixes the confirmed ones by
**consolidating alternate paths onto the existing Local API pipeline** rather than adding a second,
parallel enforcement mechanism per feature (CLAUDE.md's core rule: business logic lives in the Local
API, and existing alternate content paths must not bypass guarantees ordinary CRUD already provides).

This is explicitly a hardening pass, not a feature sprint: no new field kinds, adapters, or product
surfaces. See the maintainer's brief (§14 "What NOT to do") for the full non-goal list.

## Goal

Every content path in `packages/runtime` — versions, preview, population, relation integrity — enforces
the same collection/row/field/draft access policy as `find`/`findByID`/`create`/`update`/`delete`, using
shared, extracted policy primitives instead of duplicated logic; `UsersCollectionAuthAdapter` sessions
reflect role/deletion changes without waiting for token TTL; the most dangerous auth-provisioning race
(public signup racing to become the first admin) is closed with a real atomic primitive; and the
Angular SDK's auth transport is as configurable as its content transport.

## Non-goals

- No new field kinds, adapters (Postgres/Mongo/S3), GraphQL, plugin system, OAuth/MFA, or admin redesign
  (maintainer brief §14).
- No generic distributed-transaction engine. Where the current `DatabaseAdapter` contract cannot express
  a required atomic guarantee (specifically: "N admins never drops to 0" under two independent
  concurrent writers), this spec implements the best available non-atomic mitigation and documents the
  residual gap explicitly rather than claiming atomicity it cannot provide (§7 below).
- No new public `DatabaseAdapter` contract method. The one concurrency fix that needs an atomic
  primitive (first-admin bootstrap) reuses the **existing** unique-constraint-on-`create()` guarantee
  (already proven across InMemory/libSQL/D1 by spec 046) instead of adding one.
- No preview tokens, live iframe, or visual editor (existing roadmap non-goal, A02).
- No expansion of relation `depth` beyond the currently supported 0/1.
- No real npm publish, no production deployment, no destructive git operations.
- Does not re-litigate or reopen already-completed specs (049–057); only fixes what is demonstrably
  still true in current source.

## Design

### 1. Shared read-policy extraction (the core refactor)

`operations.ts` privately defined `checkAccess()` (collection/row access decision) and
`statusConstraint()` (draft/published visibility). Both move to a new module,
**`packages/runtime/src/read-policy.ts`**, with no behavior change, so `versions.ts` and `populate.ts`
can reuse the exact same policy `find`/`findByID` already use, without creating an import cycle
(`operations.ts` → `read-policy.ts`; `versions.ts` → `read-policy.ts`; neither imports `operations.ts`
except where noted in §2). This is the "extract internal policy primitives" consolidation the brief
asks for in §1.

### 2. Versions and restore (`versions.ts`, `operations.ts`)

Current bug (confirmed in source): `listVersions`/`getVersion` accept `user`/`overrideAccess` but never
use them — any caller who can reach the HTTP version routes can enumerate/read history regardless of
whether they could read the owning document, with no field projection. `restoreVersion` calls
`ctx.adapters.database.update()` directly, bypassing access, field-write checks, validation, and hooks.

Fix:

- `listVersions`/`getVersion` (untrusted callers, `overrideAccess !== true`): load the owning document;
  if missing → `NotFoundError` (a version list for a deleted/never-existed owner does not exist, from an
  untrusted caller's point of view). Run the **same** `checkAccess(collection, 'read', ...)` and
  `statusConstraint(...)` (`defaultStatus: 'all'`, matching `findByID`'s "known id" reasoning) the normal
  single-document read uses: collection-level denial → `403`; row-level/draft mismatch → `404` (never
  leaks existence, matching `findByID`'s existing convention). Each returned version's `data` is passed
  through `filterReadableFields` so a hidden field on the live document stays hidden in its history too.
  Trusted Local API calls (`overrideAccess: true`, the default) are unaffected — this is what "trusted
  Local API calls with overrideAccess: true" retaining full access means in practice.
- `restoreVersion` **moves into `operations.ts`** (it becomes a thin wrapper that fetches the raw,
  unfiltered version snapshot, then calls the module's own `update()` — no cross-file cycle, since it's
  the same file) instead of writing through the adapter directly. This means restore automatically gets:
  update access + row-level policy, field-write access (`assertWritableFields` runs over every field the
  snapshot would change), the full validation pipeline, hooks, and — via a new optional
  `UpdateArgs.versionLabel` (backward-compatible additive field) — exactly one new version is created
  with the label `Restored from version N`, not two. A forbidden/invalid restore throws before any
  adapter write, so current content and history are provably unchanged (regression-tested).
  `RestoreVersionArgs` stays exported from `versions.ts`; `restoreVersion` is re-exported from the
  package's public surface at the same name, sourced from `operations.ts` — no consumer-visible change.
- Read access to the owning document is **not** separately re-checked inside restore: the authoritative
  gate is `update()`'s own existing-document + update-access check, exactly like calling `update()`
  directly on stale data would behave. This mirrors how ordinary CRUD already allows update-without-read
  combinations when an access rule is written that way — versions does not invent a stricter rule CRUD
  doesn't have.

### 3. Preview (`runtime.ts::preview`, `handlers.ts::handlePreview`)

Current bug (confirmed): `ForgeCmsRuntime.preview()`'s `TypedPreviewArgs` has no `user`/`overrideAccess`
field at all — it always reads the raw adapter row and merges caller data with **zero** access
enforcement, for any caller. Separately, `handlers.ts::handlePreview` **duplicates** preview end-to-end
(second, diverging implementation of the exact bug) instead of calling `runtime.preview()` — the "second
parallel mechanism" the brief's §1 explicitly warns against.

Fix:

- Add `user?: CmsUser | null` and `overrideAccess?: boolean` to preview args (both the untyped shape and
  `TypedPreviewArgs`), defaulting `overrideAccess` to `true` like every other Local API method (no
  behavior change for existing trusted callers/tests).
- Existing-document preview (`overrideAccess === false`): reuse `checkAccess(collection, 'update', ...)`
  and the row/draft visibility used by a normal read, so a document the caller cannot see or cannot edit
  produces the same `404`/`403` a real `findByID`/`update` would. `assertWritableFields` runs over the
  merged `data` (the same check `create`/`update` already run) so a forbidden field cannot be smuggled
  into a preview merely because it isn't persisted. Output is projected through `filterReadableFields`.
- New-document preview: reuse `checkAccess(collection, 'create', ...)` and `assertWritableFields`.
- Population (`depth: 1`) forwards the resolved `user`/`overrideAccess` into `populateRecord`, so preview
  gets exactly the target-visibility fix in §4, not a separate bypass.
- Zero adapter writes, zero version creation, zero committed-mutation hooks remain true (no change —
  preview never called `create()`/`update()`/`createVersion()` and still doesn't). Full document
  `validateCollection()` is deliberately **not** run in preview (existing behavior, unchanged): preview
  must be able to render an intentionally-incomplete draft. This is a conscious scope decision, not an
  oversight — recorded here so it isn't "fixed" by surprise later.
- `handlers.ts::handlePreview` is rewritten to resolve the caller via the same `resolveRequest()`-style
  auth/CSRF/role gate every other collection route uses, then delegate to `runtime.preview()` with
  `overrideAccess: false` — deleting the duplicated raw-row logic. The `allowDraftPreview` escape hatch
  (never wired into any app route — verified by repo-wide grep) is removed: it existed to let an
  unauthenticated caller bypass auth entirely for "preview tokens," a feature this spec explicitly does
  not add (non-goals). Real anonymous preview access is still possible the same way it's possible for a
  real create/update: only if the collection's own `access.create`/`access.update` rule allows it.

### 4. Relation/upload population visibility (`populate.ts`)

Current bug (confirmed): `populateRecords` queries target rows with only `{ id: { in: [...] } }` — no
collection-level access, no row-level predicate, no draft-visibility constraint on the **target**
collection. Field-level projection (`filterReadableFields`, spec 055's fix) still runs, but that's not
enough: a field a caller _is_ allowed to read can still name a document they have no business seeing.

Fix: when `overrideAccess === false`, resolve the target collection's read access decision and draft
status constraint via the same `read-policy.ts` primitives as §1/§2, and merge them into the
`findMany({ where: ... })` call that fetches related documents — so an inaccessible or draft-and-hidden
target is filtered out **at the query**, not fetched and then discarded. A collection-level total denial
(`allowed: false`) skips the query for that field entirely. Whatever comes back still goes through
`filterReadableFields` (unchanged). A target that doesn't come back (denied, draft-hidden, or genuinely
missing) is indistinguishable in the response — reusing the existing "dangling reference" code path:
single relation → `null`, many relation → entry omitted. This satisfies "do not reveal whether a target
is missing versus inaccessible" for free, since both cases now produce the exact same shape. Batching is
preserved (still one `findMany` per relation field, not per record); no depth expansion.

### 5. Relation integrity lifecycle (`relation-integrity.ts`, `operations.ts`)

Current bugs (confirmed):

1. Same-collection relations are **skipped entirely** (`if (collection.slug === targetCollection.slug)
continue`) — a self-relation's `onDelete` is silently never enforced, for restrict, cascade, or
   set-null alike.
2. Cascade/set-null call `ctx.adapters.database.delete()`/`.update()` directly — dependent mutations get
   no access check, no validation, no hooks, no version snapshot, and do not themselves recurse through
   relation integrity (a second-level cascade is invisible).
3. `findReferencingDocuments`'s many-relation branch does an unconditional full-table scan
   (`findMany({ collection })` with no `where`) and filters in JavaScript.
4. No cycle protection: a self-relation or a reference cycle across collections can revisit the same
   document, and (once (2) is fixed to recurse through real delete/update) could otherwise recurse
   forever.

Fixes:

- Remove the same-collection skip. Self-relations are now checked and enforced like any other relation.
- `findReferencingDocuments`'s many-relation branch uses `where: { [fieldName]: { containsValue: id } }`
  (the exact-membership operator already implemented on every adapter since spec 050) instead of a full
  scan.
- Cascade delete and set-null route their dependent mutation through the **same** `deleteDocument`/
  `update` functions in `operations.ts` (dependency-injected as a small structural `RelationMutator`
  interface — `{ deleteDocument(args), update(args) }` — so `relation-integrity.ts` never imports
  `operations.ts` and no cycle is introduced), with `overrideAccess: true`: a cascade/set-null is a
  _consequence_ of an already-authorized delete, the same way a database's own `ON DELETE CASCADE`
  doesn't re-run application-level ACL per cascaded row — this is a deliberate, documented choice, not
  an oversight. Because the mutator _is_ `deleteDocument` itself, cascade now recurses through the full
  pipeline automatically (hooks, versions-if-enabled, and its own nested relation-integrity check) —
  "relation integrity recursively" from the brief.
- A `visited: Set<"collection:id">` is threaded through the whole cascade/set-null traversal from the
  top-level `deleteDocument` call (seeded with the document being deleted) so a cycle or self-relation
  chain cannot revisit — and therefore cannot infinitely recurse — a document already processed in this
  operation.
- `set-null` on a `required: true` relation field is rejected **before any mutation happens** (extended
  into the existing pre-flight `checkDeleteRestrictions` pass, which already runs before any write) —
  a null value can never satisfy a required field, so this is treated the same as `restrict` when a
  live reference exists, rather than failing deep inside a partially-completed cascade with a generic
  validation error.
- **Explicit, documented limitation (no atomicity claim):** cascade across multiple documents is not
  transactional. If a later step in a multi-document cascade fails (a second-level `restrict`, a hook
  throwing, a DB error), documents already deleted/updated by earlier steps remain deleted/updated. This
  matches D01's guidance to state exactly this rather than pretend otherwise; it is not a regression —
  the pre-existing code had the identical property, just silently.

### 6. Auth session freshness (`packages/auth`)

Current bug (confirmed): `UsersCollectionAuthAdapter.validateSession()` delegates to the stateless
`token-signer.ts::validateSession`, which only checks the HMAC signature and `exp` — the embedded
`role`/`email`/`name` are exactly what was true **at login time** and are never revalidated against the
current row. A demoted, deleted, or password-reset user keeps working access for the full 24h TTL.

Fix, scoped to `UsersCollectionAuthAdapter` only (it already holds a live `DatabaseAdapter` handle;
`SignedTokenAuthAdapter`/`ExternalAuthAdapter` are deliberately stateless per their own contracts and are
**not** converted — that boundary from the roadmap is preserved and documented):

- After the signature/`exp` check succeeds, `UsersCollectionAuthAdapter.validateSession()` re-reads the
  user row by the token's `sub` (id). Missing row → session invalid (deleted user). Row's current
  `role`/`email`/`name` replace the token's stale embedded copy (role changes take effect on the very
  next request, no re-login required).
- A new persisted field, `_sessionVersion` (a monotonically-incrementing integer, defaulting to `0` for
  existing rows with no migration required — `undefined`/`0` compare equal), is bumped by
  `updateUser()` whenever `password` changes, and is embedded in the token at issue time. A mismatch
  between the token's embedded version and the row's current version invalidates the session — this is
  what makes a password change invalidate every previously-issued token for that user (all sessions,
  since there is no per-session store to invalidate just one — documented below).
- `logout()` remains cookie-only (clears the current browser's cookie; does not and cannot revoke a
  Bearer token held elsewhere) — unchanged from spec 053, and now explicitly documented as the
  intentional scope: **logout invalidates the current browser session's cookie; it does not bump
  `_sessionVersion`.** A user who wants to invalidate every outstanding session (e.g. a stolen token)
  should change their password, which does bump it. This is the "narrow, robust mechanism" the brief
  asks for instead of building a session store.
- A dependency (network/DB) failure while re-validating must surface as `500` via the existing
  "unexpected error propagates" convention (`CompositeAuthAdapter`/HTTP boundary already do this for
  every other adapter call) — not be downgraded to a misleading `401`.
- API keys (`ApiKeyAuthAdapter`) are untouched — already have their own independent revocation
  (`revokedAt`) and lifecycle, unaffected by this change.

### 7. Auth concurrency (`packages/auth`)

Two distinct invariants, two different levels of fix:

**7a. First-admin bootstrap race (fixable atomically with existing primitives).** Current bug: both
`createUser()` and `signup()` decide the role with `(await hasAnyUser(db)) ? role : 'admin'` —
check-then-act. Two concurrent calls (e.g. two people hitting a freshly-enabled public `/api/auth/signup`
at once) can both observe `hasAnyUser() === false` and both be granted `admin`. Fix: a new internal
system collection `_forge_bootstrap` (same pattern as `_forge_api_keys`, reserved-prefix, deny-all
access, provisioned via a new `UsersCollectionAuthAdapter.syncSchema()`) holds a single marker row with a
fixed id. Claiming it is `db.create('_forge_bootstrap', { id: 'first-admin' })`: every adapter
(InMemory/libSQL/D1) already enforces primary-key/id uniqueness atomically (proven by spec 046's
constraint contract suite), so of any number of concurrent callers, **exactly one** `create()` call can
ever succeed, permanently. `hasAnyUser()` remains a fast-path guard (skip attempting the claim once users
already exist, avoiding a redundant write on every ordinary signup after bootstrap) — the actual
correctness comes from the atomic claim, not the guard. This closes the "accidentally open public race"
finding without any `DatabaseAdapter` contract change.

**7b. Last-admin removal race (cannot be made atomic without a contract change — explicit limitation).**
`updateUser`/`deleteUser`'s `countAdmins(db) <= 1` pre-check is check-then-act with no way to make it a
single atomic conditional write under the current `update(collection, id, data)`/`delete(collection,
id)` contract (no compare-and-swap, no SQL-expression `WHERE`). A genuine fix needs a new
conditional-write primitive across all three adapters plus contract tests — out of scope for this
hardening pass per the non-goals (no speculative contract change without reproducing the exact need
first, and this is squarely H01's own future packet). Implemented instead: a **post-write
re-verification with best-effort compensation** — after the mutation, re-count admins; if it dropped to
zero, revert (recreate the deleted user / restore the demoted role) and raise `UserMutationError`. This
closes the common real-world race (two concurrent last-admin removals whose pre-checks both ran before
either write landed) but has a proven residual gap: if both operations' _post-write rechecks_ also both
run before the other's write is visible, both can conclude "still fine" and the invariant can still be
violated. This is documented explicitly as a known, bounded limitation (§ Explicit limitations below),
not claimed as fixed. A regression test demonstrates the common case is now caught.

### 8. Global access/draft consistency (`globals.ts`)

Verification against current source: `globals.ts` already calls `checkGlobalAccess` (collection-level),
`filterReadableFields`, `assertWritableFields`, and the full hook pipeline — **F11's "accepts `depth`
without population" and "no draft visibility" are still true** (confirmed): `GetGlobalArgs.depth` is
declared but never read anywhere in `getGlobal`, and a `drafts: true` global's `_status` is written
(`data._status = 'draft'` default) but never enforced on read — an anonymous caller reading a draft
global gets the draft content. Fix: `getGlobal` applies the same `statusConstraint`-style draft gate a
collection single-read uses (a global has exactly one document, addressed by fixed id, so this is a
`documentMatches` check against the loaded record, mirroring `findByID`'s row/draft check) — an
anonymous caller reading a global whose current document is `draft` gets `404`. `depth` is either wired
to real population (global fields can contain `relation`/`upload` fields, same as a collection) using
the §4-hardened `populateRecord`, or — if wiring it turns out to need more than a small, safe addition —
explicitly rejected (`InvalidQueryError`) rather than silently ignored, so there is no "accepted but
inert" configuration left. (Resolved in favor of wiring real population — it's a direct reuse of the
already-hardened `populateRecord`, not a new mechanism.)

### 9. Angular SDK configuration and errors (`@forge-cms/angular`)

Current bug (confirmed): `CmsApiService` hardcodes `/api/auth/me`, `/api/auth/login`, `/api/auth/signup`,
`/api/auth/logout`, `/api/auth/users*` while `getDocuments`/etc. honor a configurable `baseUrl`. Also
`getCollections()` throws a bare `new Error(...)` on failure instead of routing through the existing
`toApiError()` helper that preserves Forge error codes/details.

Fix: `ForgeCmsConfig` gains an optional `authBaseUrl?: string` (defaults to `'/api/auth'`, matching
every hardcoded literal today — fully backward compatible for every existing consumer that doesn't set
it). Every auth-endpoint call site is rewritten to `` `${this.authBase}/...` ``. `getCollections()` is
rewritten to use `toApiError()` like every other content method. No transport abstraction, no retry
logic, no new HTTP client — purely a config surface + one bug fix, per the brief's explicit scope limit.

### 10. Peer dependency audit (verification, not a change)

Re-verified against current source: `packages/angular/package.json` and `packages/admin/package.json`
already pin `@angular/*` peers to the exact `21.2.10` used by every consumer's `devDependencies`
(`apps/www`, `apps/demo-aesthetics`, `apps/tiny-project`) — this was fixed on `main` at commit `255febb`
(2026-09-17, "dedupe Angular peer versions to stop a null PlatformLocation crash in prod"), the day
before this hardening pass started. The exact-pin (not a caret range) is not incidental: it is the
direct fix for a real production bug where a narrower/wider peer range let pnpm install two copies of
`@angular/common`. **Conclusion: no change.** Widening the range now would risk reintroducing the exact
bug that was just fixed, with no new packed-consumer evidence to justify it. This finding (F16/B02) is
closed as "verified current, correct as-is," not as "already fixed, ignore" — the distinction matters
because a future PR must not "helpfully" loosen these pins without re-running `pnpm release:verify`
against real consumer installs first.

### 11. CI evidence gates

`.github/workflows/ci.yml`'s `checks` job runs lint/typecheck/test/build/`test:cloudflare`/
`release:verify`/`e2e:www`, but **not** `pnpm test:libsql`, `pnpm e2e:tiny-project`, or `pnpm e2e:demo` —
confirmed by reading the workflow file; these three exist as scripts (`package.json`) but are not
release-gating. Fix: add three steps to the existing `checks` job (after the existing `test:cloudflare`
step, before `release:verify`) running `pnpm test:libsql`, and after `e2e:www`, running
`pnpm --filter @forge-cms/tiny-project exec playwright install --with-deps chromium` +
`pnpm e2e:tiny-project`, and the same pattern for `pnpm e2e:demo`. All three become required (the
`release`/`deploy`/`deploy-demo` jobs already `needs: checks`, so making `checks` fail on these failures
already blocks publish/deploy with no further wiring). No new job, no change to docs-only-change cost
beyond the existing single `checks` job's runtime (already accepted by the brief: "do not make docs-only
changes unnecessarily expensive" is about not adding _new conditional jobs_, not about skipping existing
required suites).

### 12. Coverage and public-surface baseline

`vitest.config.ts` configures coverage _reporters_ but no provider/thresholds — coverage is not actually
enforced anywhere. Fix: add `provider: 'v8'` and conservative non-regression thresholds scoped to actual
production source (`packages/*/src/**/*.ts`, excluding `*.test.ts` and `dist/`), plus a `test:coverage`
script. Thresholds are set at (or just below) the measured baseline, not an aspirational number — the
goal is "a regression becomes visible," not a vanity percentage. Public-surface diff: a small script
(`scripts/check-public-api.mjs`) that snapshots each package's `dist/index.d.ts` export names after
build and diffs against a committed baseline (`api-baseline/*.d.ts` snapshot of exported symbol names,
not full type signatures — deliberately lightweight, no API-extractor dependency), failing with a clear
diff if a symbol is removed/renamed without the baseline being deliberately updated in the same PR.

### 13. Documentation reconciliation

- `README.md` still says `0.0.1` in its warning banner and its package table; every package manifest is
  actually `0.4.0` (verified: `grep '"version"' packages/*/package.json`). Fix the banner and table.
- `README.md`'s "What `0.0.1` Promises" section and package table are updated to the current version
  number; the underlying claims (schema DSL, CRUD, HTTP handlers, validation, access/hooks, relations,
  adapters, contract tests) are re-verified against `docs/STATE.md` and left as-is where still accurate.
- `STATE.md` gets a new dated entry for this spec once implementation is verified (per its own
  maintenance header), not a rewrite of prior entries.
- No historical spec is rewritten.

## Implementation plan

- [x] Write this spec.
- [x] `read-policy.ts`: extract `checkAccess`/`statusConstraint` from `operations.ts` (no behavior change).
- [x] `versions.ts`: gate `listVersions`/`getVersion` on owner read policy + field projection; regression tests.
- [x] `operations.ts`: move `restoreVersion` in, route it through `update()`, add `versionLabel`; regression tests.
- [x] `runtime.ts`/`typed-api.ts`: add `user`/`overrideAccess` to preview; gate existing/new-document preview.
- [x] `handlers.ts`: rewrite `handlePreview` to delegate to `runtime.preview()`; remove `allowDraftPreview`.
- [x] `populate.ts`: merge target read/draft policy into the batched `findMany`; tests (anonymous/authenticated/row-restricted/draft/hidden-field/upload/preview-depth/trusted).
- [x] `relation-integrity.ts` + `operations.ts`: remove same-collection skip, `containsValue` for many-relation lookups, DI mutator, recursion via real `deleteDocument`/`update`, visited-set cycle guard, required+set-null pre-flight rejection; tests (self-relation, cycle, nested-in-array, required-set-null-rejected, cascade-through-hooks).
- [x] `packages/auth`: `UsersCollectionAuthAdapter` session freshness (`_sessionVersion`, live role re-read); tests.
- [x] `packages/auth`: `_forge_bootstrap` atomic first-admin claim; tests (deterministic concurrent signup).
- [x] `packages/auth`: last-admin post-write compensation; deterministic regression test + documented residual gap.
- [x] `globals.ts`: draft visibility on read; `depth` wired to real population.
- [x] `packages/angular`: `authBaseUrl` config + `getCollections` error handling; tests.
- [x] CI: add `test:libsql`/`e2e:tiny-project`/`e2e:demo` to the required `checks` job.
- [x] `vitest.config.ts` + `scripts/check-public-api.mjs`: coverage thresholds + surface-diff baseline.
- [x] `README.md`: version/table reconciliation.
- [x] Changesets for every touched `packages/*`.
- [x] `docs/STATE.md` entry.
- [x] Full quality gates + report.

## Test plan

- `packages/runtime`: new/extended `versions.test.ts`, `preview.test.ts`, `populate.test.ts`,
  `relation-integrity.test.ts`, `globals.test.ts`, `handlers.test.ts` covering every access matrix cell
  listed in the maintainer brief §16 (versions-cannot-bypass-read, restore-cannot-bypass-update,
  preview-cannot-bypass-create/update/field-access, populated-private/draft-targets-stay-hidden,
  self-relation/cycle-bounded-recursion, forbidden-restore-leaves-state-unchanged).
- `packages/auth`: extended `users-collection.adapter.test.ts` (+ `.db-parity.test.ts` for libSQL/D1
  parity) covering role/deletion/password-change session freshness, deterministic concurrent-signup
  bootstrap race, deterministic concurrent last-admin race (documented expected outcome).
- `packages/angular`: extended `api.service` tests for `authBaseUrl` + error metadata.
- Full repository gates: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`,
  plus `pnpm test:cloudflare`, `pnpm test:libsql`, `pnpm release:verify`. E2E (`e2e:www`,
  `e2e:tiny-project`, `e2e:demo`) run where a local dev-server/browser can actually be driven in this
  environment; recorded honestly if not.

## Acceptance criteria

1. Every scenario in maintainer brief §16 has a passing regression test.
2. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.
3. No new import cycle (`import/no-cycle` stays clean).
4. No public API/behavior change ships without a changeset under the affected `packages/*`.
5. Every explicit limitation (§7b, non-atomic cascade) is stated in this spec's Outcome and in
   `docs/STATE.md`, not silently dropped.

## Open questions

(none — resolved during design above)

## Outcome

Implemented as designed, with two deviations both discovered by real backend/consumer tests rather
than by inspection alone:

1. **First-admin bootstrap claim scoping.** The design's `_forge_bootstrap` marker initially used a
   single fixed `slot` value. Real local-D1 tests (`packages/cloudflare/test/workers/human-auth.test.ts`)
   run three `UsersCollectionAuthAdapter` instances with different `collection` names against what
   turned out to be a shared underlying Miniflare D1 binding across the file's `it()` blocks — the
   fixed slot value made the _second_ users-collection's "first" signup lose a bootstrap race against
   the _first_ users-collection's already-claimed slot. Fixed by keying the slot on `this.collection`
   (each users-collection's "first admin" is a property of its own table, not the database as a
   whole) — see the adapter's doc comment.
2. **Cycle-guard semantics in cascade delete.** The first cut marked a referencing document's key as
   visited _before_ invoking the recursive delete mutator, which caused `deleteDocumentInternal`'s own
   entry-time visited check to treat "the caller just claimed this key" as "already fully deleted" and
   skip the real adapter delete — a genuine regression, caught immediately by the pre-existing
   `relation-integrity.test.ts` cascade test. Fixed by removing the self-check at function entry
   entirely: cycle/diamond protection lives solely in the caller-side (`handleCascadeDelete`/
   `handleSetNullOnDelete`) pre-checks, which is sufficient (traced by hand for both a linear cascade
   and a genuine A↔B cycle) and is now what the code and its comments describe.

Also found by real backend/consumer evidence, not by inspection: `apps/tiny-project`'s real-D1 and
real-libSQL lifecycle tests and `scripts/verify-release.mjs`'s packed-consumer check all asserted an
**anonymous** caller could see a populated `post.author -> users` relation's `email` —
`defineUsersCollection()`'s own default `access.read` (`user !== null`) already said an anonymous
caller cannot read a `users` row at all, so this was exactly the population-bypass bug §4 fixes,
caught the moment the fix landed rather than by static review. All three fixtures were corrected to
assert `null` for anonymous and a populated author for an authenticated caller — see STATE.md's
2026-09-18 entry for the full list.

No divergence from the plan otherwise. Full outcome, verification, and remaining-roadmap assessment
are in the chat-facing report delivered alongside this spec (not duplicated here to avoid drift
between the two); the acceptance criteria above are met except where explicitly marked as a documented
limitation (§7b) or as unverified due to this environment lacking Playwright browser binaries
(`pnpm e2e:www`/`e2e:tiny-project`/`e2e:demo` — CI wiring added, not executed here).
