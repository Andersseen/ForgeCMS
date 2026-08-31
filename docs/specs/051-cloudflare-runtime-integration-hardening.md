# 051 — Cloudflare runtime integration hardening

- **Status:** done
- **Author:** agent draft (maintainer-scoped brief)
- **Date:** 2026-08-31
- **Branch:** feature/cloudflare-runtime-integration-hardening
- **Affected packages/apps:** @forge-cms/cloudflare, @forge-cms/runtime, @forge-cms/db (test-only reuse),
  apps/www (docs only), .github/workflows/ci.yml

## Context / Why

Spec 049 hardened auth/runtime error semantics; spec 050 hardened query completeness and proved adapter
parity across InMemory, real libSQL, and a hand-rolled D1 mock. Every "D1"/"R2" test in this repo today
— including the shared `runDatabaseAdapterQueryContractTests`/`runDatabaseAdapterConstraintContractTests`
suites — runs exclusively against `packages/cloudflare/src/d1.adapter.test.ts`'s hand-written
`MockD1Database` (a regex-shaped SQL recognizer, not a SQLite engine) and `r2.adapter.test.ts`'s
`MockR2Bucket`. `docs/STATE.md` and spec 050's own Outcome section both carry the caveat forward
unresolved: D1's `containsValue`/nested-SQL is "SQLite-compatible by construction" but "not
smoke-tested against a live D1 binding," and the demo/production deploy has "never been verified
end-to-end against real Cloudflare bindings." This is the next stabilization step for the `0.1.x`
line — closing that gap for functionality ForgeCMS already claims to support, not adding new
capability.

## Goal

The Cloudflare-specific behavior ForgeCMS already claims to support — D1 schema sync, compound unique
indexes, nested query semantics (including the empty-OR deny-all security fix), `containsValue`, JSON
round-tripping, machine auth, one HTTP request/response path, R2 storage, additive migration, and
failure/binding-validation semantics — is proven against a real local Cloudflare Workers runtime (D1 +
R2 bindings via Miniflare/workerd), not only against hand-written mocks, with any genuine parity bugs
found fixed and regression-tested.

## Non-goals

Everything in the brief's NON-GOALS list: Glossa, SSR/hydration, an Analog package, GraphQL, Postgres,
MongoDB, a plugin system, a CLI, migration history/down migrations, image resizing/thumbnails/direct
uploads, queues, a caching layer, Durable Objects, Cloudflare production deployment automation, new auth
features, new query operators, an admin redesign. Also: no real/remote Cloudflare account, credentials,
D1, or R2 — everything here runs locally and in CI with zero secrets. No rewrite of an adapter that the
new integration tests prove already behaves correctly.

## Audit findings (step 1)

| Area                                                                        | Finding                                                                                                                                                                                                                                                                                                                                 | Classification                                                                                 |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `packages/cloudflare` test suite                                            | Every D1/R2 test runs against hand-rolled `MockD1Database`/`MockR2Bucket`; zero use of Miniflare/`@cloudflare/vitest-pool-workers`/`@cloudflare/vitest-plugin` anywhere in the repo                                                                                                                                                     | MOCK-ONLY COVERAGE                                                                             |
| `d1.adapter.test.ts` running the shared query/constraint contracts          | D1 is the only SQLite-backed adapter whose contract-test run never touches a real SQLite engine (libSQL's does, via a real `:memory:` client)                                                                                                                                                                                           | MOCK-ONLY COVERAGE                                                                             |
| `operations.test.ts`'s empty-OR deny-all regression (spec 050 security fix) | Loops InMemory + real libSQL; does not include D1 (architecturally can't — `@forge-cms/runtime` can't depend on `@forge-cms/cloudflare`)                                                                                                                                                                                                | REAL RUNTIME GAP — needs a D1-side regression in `packages/cloudflare` itself                  |
| `packages/cloudflare/package.json`                                          | `r2.adapter.ts` imports types from `@forge-cms/storage`, which is **not declared** in `dependencies` (works today only via pnpm hoisting)                                                                                                                                                                                               | ADAPTER BUG (packaging)                                                                        |
| `packages/cloudflare/package.json`                                          | `drizzle-orm` devDependency, zero usage anywhere in `packages/cloudflare/src` (README's "Drizzle-ready" claim is stale — the adapter hand-builds SQL)                                                                                                                                                                                   | DOC GAP / packaging cleanup                                                                    |
| `packages/runtime/src/operations.ts` `deleteDocument`                       | Never touches `ctx.adapters.storage`; upload-object cleanup on delete exists only in `handlers.ts` (HTTP layer), wrapped in explicit "best-effort" comments. Any Local API caller (server code, hooks, seed scripts) orphans the R2/storage object on delete. Not documented anywhere (`docs/DEMO-FINDINGS.md` has no matching finding) | ADAPTER BUG — violates CLAUDE.md's "business logic lives in the Local API, not the HTTP layer" |
| `packages/runtime/src/handlers.ts` `toErrorResponse`                        | Already maps any non-`ForgeError` to a generic 500 with no `err.message` interpolation — infra failures already fail safe by construction                                                                                                                                                                                               | NO CHANGE NEEDED (verify against a real D1 failure, don't rewrite)                             |
| `D1DatabaseAdapter`/`R2StorageAdapter` `init()`                             | Both throw synchronously, naming the exact missing binding, binding name fully configurable                                                                                                                                                                                                                                             | NO CHANGE NEEDED (verify against a real Miniflare env shape)                                   |
| `ForgeCmsRuntime.syncSchema()` / adapter `syncSchema()` on all 3 adapters   | Upsert-by-slug, not clear-then-repopulate — explicitly designed so `ApiKeyAuthAdapter.syncSchema()` sharing one adapter instance doesn't clobber consumer collections (spec 049)                                                                                                                                                        | NO CHANGE NEEDED (prove against real D1, don't rewrite)                                        |
| `CompositeAuthAdapter.requireAuth`                                          | Only a `ForgeAuthError` falls through to the next adapter; any other thrown value propagates (spec 049 fix), covered by unit tests with fake adapters                                                                                                                                                                                   | NO CHANGE NEEDED (prove the same contract holds with a real D1-backed `ApiKeyAuthAdapter`)     |
| CI (`ci.yml`)                                                               | One `checks` job; no step runs Miniflare/`wrangler dev`/any Cloudflare-bindings-aware test                                                                                                                                                                                                                                              | CI GAP                                                                                         |
| Root `vitest.config.ts` / package scripts                                   | No `test:cloudflare` script anywhere; no per-package `vitest.config.ts` in `packages/cloudflare` (falls back to Vitest defaults)                                                                                                                                                                                                        | CI GAP / tooling gap                                                                           |

## Design

### 1. Tooling: `@cloudflare/vitest-plugin`, not `@cloudflare/vitest-pool-workers`

Cloudflare's docs (confirmed live, 2026-08-31) state the older `@cloudflare/vitest-pool-workers` is
superseded: _"Cloudflare recommends using the Workers Vitest integration... If you use
`@cloudflare/vitest-pool-workers`, refer to Migrate to Vitest plugin."_ `@cloudflare/vitest-plugin@1.1.2`
requires `vitest: ^4.1.0` — this repo's pinned catalog version is `vitest: ^4.1.6`, an exact fit,
confirming the brief's "prefer official/current tooling ... if it fits cleanly." It bundles its own
`wrangler`/`miniflare` as dependencies (isolated from this repo's root `wrangler` devDependency, used
only for `pages deploy`) — no separate download, no real Cloudflare account, no credentials.

### 2. New test project, isolated from the default unit-test run

`packages/cloudflare` gets:

- `wrangler.test.jsonc` — a test-only Wrangler config (`d1_databases` binding `DB`, `r2_buckets` binding
  `BUCKET`, no `nodejs_compat` — `packages/auth`'s `ApiKeyAuthAdapter` already uses only Web Crypto
  (`crypto.subtle.digest`, `crypto.getRandomValues`), so nothing here needs it). No `wrangler d1
migrations` — `D1DatabaseAdapter.syncSchema()` already creates tables via `db.exec(CREATE TABLE ...)`
  at runtime, which is exactly what this spec is proving works for real, so tests build schema the same
  way production does.
- `vitest.workers.config.ts` — `cloudflareTest({ wrangler: { configPath: './wrangler.test.jsonc' } })`,
  `test.include: ['test/workers/**/*.test.ts']`.
- `packages/cloudflare/test/workers/*.test.ts` — the new integration suite (not `src/`, so it is never
  swept up by `packages/cloudflare`'s existing `vitest run --dir .` unit-test script, and never needs a
  filename-suffix exclude to stay out of the default Node-pool run).
- `package.json` gains `"test:cloudflare": "vitest run -c vitest.workers.config.ts"`; root `package.json`
  gains `"test:cloudflare": "pnpm --filter @forge-cms/cloudflare test:cloudflare"`. Kept out of `pnpm
test` (which stays fast, per the brief's §15) and run as its own named CI step.
- `@cloudflare/vitest-plugin` added to `packages/cloudflare`'s `devDependencies` only — never a runtime
  `dependency`, so it cannot leak into the published package (brief §21/§18).

### 3. Per-test isolation: real, not assumed

`@cloudflare/vitest-plugin` isolates storage **per test file**, not per `it()` (confirmed against the
Cloudflare team's own fixture: a post created in one `it()` is still visible in the next `it()` in the
same file — state accumulates within a file, resets only between files). The existing shared contracts
(`runDatabaseAdapterConstraintContractTests`/`runDatabaseAdapterQueryContractTests`) assume the opposite:
their own `createAdapter()` factory is called fresh in a `beforeEach` and is expected to hand back an
adapter over an **empty** backing store every time (the D1 mock does this today by constructing `new
MockD1Database()` inside `createAdapter`; libSQL's own test presumably does the same with a fresh
`:memory:` client) — reusing one real, file-scoped D1 binding across many `it()`s would violate that
assumption and fail on the second test's fixed-id insert (`id: 'q1'` etc. already exists). This is
exactly the brief §18 case: _"if those contracts currently assume ... setup incompatible with Workers
bindings, make the smallest generic improvement needed."_ The smallest fix does **not** touch the shared
contract file (no risk to the InMemory/libSQL parity guarantee it already proves) — it resets the two
fixed table names the contracts use (`widgets`, `articles`) in an outer `beforeEach` in the new D1
integration test file, which Vitest/Jest-style hook ordering guarantees runs before the contract's own
inner `beforeEach`:

```ts
import { env } from 'cloudflare:workers';

beforeEach(async () => {
  for (const table of ['widgets', 'articles']) {
    try {
      await env.DB.exec(`DELETE FROM "${table}"`);
    } catch {
      /* table doesn't exist yet on the first run in this file */
    }
  }
});
```

Every other new test in this suite (schema sync, compound indexes, JSON parity, machine auth, HTTP
fixture, R2, additive migration) uses per-test-unique collection slugs or record ids instead, matching
the existing convention in `d1.adapter.test.ts`'s mock-based tests — no reset needed there.

### 4. HTTP integration fixture (brief §10)

No separate deployed Worker is built. `@cloudflare/vitest-plugin` test files run _inside_ workerd with
real bindings already; `env` and `exports` are importable from `cloudflare:workers`. One `main` entry
(`test/workers/fixtures/worker.ts`, referenced by `wrangler.test.jsonc`) wires a minimal `fetch` handler
using `@forge-cms/runtime`'s existing framework-agnostic `handleFind`/`handleCreate`/etc. over a real
`D1DatabaseAdapter` + `ApiKeyAuthAdapter`/`CompositeAuthAdapter`, with one `articles`/`tenant`-shaped
collection (per brief §10's own suggested example) and access rules that require a matching tenant
scope. The one HTTP-integration test file calls `exports.default.fetch(new Request(...))` directly —
proving `Request → handler → machine auth → access → D1 query → Response` end-to-end — for valid
key+scope+tenant (200), valid key without permission (403), invalid key (401), and a simulated DB/config
failure (500, no leaked internals). `@forge-cms/runtime` becomes a `packages/cloudflare` devDependency
for this fixture only (no cycle: `@forge-cms/runtime` does not depend on `@forge-cms/cloudflare`; the
existing devDependency on `@forge-cms/auth` for the mock-based adapter-parity tests is the same pattern
already established in this package).

### 5. Storage lifecycle fix (brief §12) — move Local API delete cleanup down from HTTP

`packages/runtime/src/operations.ts`'s `deleteDocument` gains the same cleanup `handlers.ts`'s
`handleDelete` already does by hand: for an `upload: true` collection, after the database delete
succeeds (never before — a rejected delete must never orphan-delete the object), best-effort delete the
`_storageKey` (or a URL-derived fallback) via `ctx.adapters.storage.delete(...)`, log-and-swallow any
storage-delete failure (the document is already gone; failing the whole operation over cleanup would be
worse). `handlers.ts`'s `handleDelete` then **drops its own duplicate cleanup block** and relies on the
Local API doing it — matching CLAUDE.md's hard rule that business logic (including this lifecycle
invariant) lives in the Local API, HTTP stays transport-only. `handleCreate`'s upload-rollback-on-failure
path is unaffected (it's a multipart-upload-specific rollback, not a delete-lifecycle concern, and
Local API `create()` has no multipart path to roll back). Covered by an InMemory regression test in
`operations.test.ts` (Local API delete on an upload-enabled collection removes the storage object; a
denied/failed delete does not) plus a real R2 integration test in the new Workers suite.

### 6. Packaging fix

`packages/cloudflare/package.json`: add `@forge-cms/storage` to `dependencies` (real fix — it's a
runtime type dependency today resolved only by pnpm hoisting); remove the unused `drizzle-orm`
devDependency and the stale "Drizzle-ready" README claim.

## Implementation plan

- [x] `docs/specs/051-cloudflare-runtime-integration-hardening.md` (this file)
- [ ] `packages/cloudflare/package.json` — `@cloudflare/vitest-plugin` devDependency, `@forge-cms/storage`
      → `dependencies`, drop unused `drizzle-orm`, `test:cloudflare` script
- [ ] `packages/cloudflare/wrangler.test.jsonc`, `packages/cloudflare/vitest.workers.config.ts`
- [ ] `packages/cloudflare/test/workers/fixtures/worker.ts` — minimal `articles`/`tenant` fetch handler
      for the HTTP integration fixture
- [ ] `packages/cloudflare/test/workers/d1-schema.test.ts` — `init()`/`syncSchema()` idempotency across
      text/number/boolean/json/relation/many-relation/draft fields; shared-instance
      `ApiKeyAuthAdapter.syncSchema()` + consumer collections coexistence; compound unique indexes
      (valid/duplicate/update-safe/update-conflict); real timestamps; additive migration (version A → add
      field → sync → old row preserved, new column usable)
- [ ] `packages/cloudflare/test/workers/d1-query.test.ts` — real-D1 run of
      `runDatabaseAdapterConstraintContractTests`/`runDatabaseAdapterQueryContractTests` (with the
      table-reset `beforeEach` from Design §3); a dedicated empty-OR-access-constraint-denies-all
      regression against real D1 (mirroring `operations.test.ts`'s InMemory/libSQL version)
- [ ] `packages/cloudflare/test/workers/d1-json-parity.test.ts` — null/empty object/empty array/booleans/
      numbers/unicode/nested JSON/many-relation/API-key scopes+metadata round-trip through real D1
- [ ] `packages/cloudflare/test/workers/d1-failure-semantics.test.ts` — missing binding (real Miniflare
      env shape), unregistered collection, and a simulated D1 failure never surface as 400/401/403
      through `handlers.ts`'s `toErrorResponse`, and never leak SQL/internals
- [ ] `packages/cloudflare/test/workers/machine-auth.test.ts` — real-D1-backed `ApiKeyAuthAdapter` full
      lifecycle (sync, create, authenticate, scope/metadata reach `AuthUser`, `lastUsedAt`, revoke,
      post-revoke failure) and `CompositeAuthAdapter` not turning a real D1 failure into a 401
- [ ] `packages/cloudflare/test/workers/http-integration.test.ts` — the one fixture from Design §4
- [ ] `packages/cloudflare/test/workers/r2.test.ts` — `runStorageAdapterContractTests` against real R2;
      put/get/delete/list/getPublicUrl
- [ ] `packages/cloudflare/test/workers/storage-lifecycle.test.ts` — real R2 half of Design §5
- [ ] `packages/runtime/src/operations.ts` — `deleteDocument` storage cleanup (Design §5)
- [ ] `packages/runtime/src/handlers.ts` — remove the now-duplicate cleanup block in `handleDelete`
- [ ] `packages/runtime/src/operations.test.ts` — InMemory regression for the moved cleanup logic
- [ ] `.github/workflows/ci.yml` — new step in the `checks` job running `pnpm test:cloudflare`, named
      distinctly from `pnpm test`
- [ ] `apps/www/src/content/docs/deployment.md` — short addition pointing at `pnpm test:cloudflare` and
      clarifying "locally-verified against real Workers bindings" vs. "remote production deploy verified"
- [ ] `docs/STATE.md` — replace the mock-only D1/R2 caveats with precise "local real Workers/D1 binding
      verified" language; keep the "remote production deploy still unconfirmed" caveat distinct and intact
- [ ] Changeset for `packages/cloudflare`/`packages/runtime`
- [ ] Full verification gates + `pnpm test:cloudflare`

## Test plan

- `pnpm --filter @forge-cms/cloudflare test:cloudflare` — the new suite above, against real local D1/R2
  Miniflare bindings, no credentials.
- `pnpm test` — unchanged existing suites stay green, including the moved storage-cleanup regression in
  `packages/runtime/src/operations.test.ts`.
- `pnpm lint && pnpm typecheck && pnpm build && pnpm release:verify` — confirm the new devDependency
  never reaches a published `dependencies` field and the package still builds/packs cleanly.
- `pnpm e2e:www` — unaffected (no UI surface changed); run to confirm no regression.

## Acceptance criteria

1. A reproducible local real-Cloudflare integration test environment exists (`@cloudflare/vitest-plugin`,
   no account/credentials/remote resources).
2. D1 schema sync (`init()` + `syncSchema()`) is proven against a real local D1 binding, including
   repeated `syncSchema()` calls being safe.
3. Shared consumer collections and `ApiKeyAuthAdapter`'s internal schema coexist correctly on the same
   real D1 adapter instance.
4. Compound unique indexes are proven against real D1 (valid/duplicate/update-safe/update-conflict),
   surfacing as the stable `UNIQUE_CONSTRAINT` contract, not a raw D1 error.
5. Nested `and`/`or` queries, multi-field sort, and `findOne()` work against real D1, reusing the
   existing shared contract suites rather than a duplicated test matrix.
6. The empty-OR access-constraint deny-all regression (spec 050's security fix) is proven against real
   D1, not only InMemory/libSQL.
7. `containsValue` is proven against real D1's `json_each` semantics (exact match / substring does not
   match / missing element does not match / empty array does not match).
8. JSON/array/many-relation/API-key-scope/metadata serialization round-trips correctly through real D1.
9. `ApiKeyAuthAdapter`'s full lifecycle works through real D1 persistence, and `CompositeAuthAdapter`
   does not turn a real D1 failure into a 401.
10. One real-Worker-runtime HTTP integration test proves `Request → auth → access → D1 query → Response`
    for the 200/403/401/500 cases.
11. R2 adapter behavior (`put`/`get`/`delete`/`list`/`getPublicUrl`) is proven against a real local R2
    binding via the existing `runStorageAdapterContractTests`.
12. The Local-API storage-orphan-on-delete gap is fixed for upload-enabled collections, with InMemory and
    real-R2 coverage; ordinary (non-upload) document deletion is unaffected; a denied/failed delete never
    deletes the storage object.
13. Additive schema evolution (add a field, sync again, old row preserved, new column usable) is proven
    against real D1.
14. Real D1/R2 infrastructure failures and missing bindings surface as clean, non-leaking errors (500 for
    infra failures, a clear dev-facing message for a missing binding) — verified, not newly built, since
    `toErrorResponse` and adapter `init()` already implement this.
15. Existing mocks/unit tests remain useful and green; `pnpm test` is unaffected in scope or speed.
16. CI runs the new integration suite as its own named step, with zero Cloudflare secrets.
17. `@cloudflare/vitest-plugin` and `@forge-cms/runtime`-for-tests stay `devDependencies` only — never
    leak into `packages/cloudflare`'s published `dependencies`, `exports`, or bundle (`pnpm release:verify`
    stays green).
18. `docs/STATE.md` and `apps/www`'s deployment doc precisely distinguish "locally verified against real
    Workers/D1/R2 bindings" from "remote production deployment verified" (still not claimed).
19. No unrelated feature expansion was introduced (see Non-goals).
20. `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build` green, plus
    `pnpm test:cloudflare`, `pnpm release:verify`, and `pnpm e2e:www`.

## Open questions

None — tooling choice, isolation strategy, and the storage-lifecycle fix's design were the only open
questions, all resolved in Design §1/§3/§5 above by checking current Cloudflare docs and reading the
existing contract-test/handler code directly.

## Outcome

Shipped as designed, plus one real bug found and fixed along the way (not just verified) and two
pre-existing gaps fixed as part of the same audit.

**Tooling.** `@cloudflare/vitest-plugin@1.1.2` (confirmed current-recommended over the older
`@cloudflare/vitest-pool-workers` by checking Cloudflare's live docs — `vitest-pool-workers` is
explicitly deprecated in favor of it), exact peer fit with this repo's pinned `vitest@^4.1.6`. New
project: `packages/cloudflare/vitest.workers.config.ts` + `wrangler.test.jsonc` (D1 binding `DB`, R2
binding `BUCKET`, no `nodejs_compat` — `@forge-cms/auth` already uses only Web Crypto), tests under
`packages/cloudflare/test/workers/`, run via `pnpm test:cloudflare`. `packages/cloudflare/vitest.config.ts`
was added to make the pre-existing default `test`/`test:watch` scripts' `src/`-only scope explicit,
keeping the new suite out of the fast unit run. A real isolation gap between the shared
`runDatabaseAdapterConstraintContractTests`/`runDatabaseAdapterQueryContractTests` suites (which assume
a fresh backing store per test, true for the mock/InMemory/libSQL but not for one real, file-scoped D1
binding reused across many `it()`s) was resolved with a table-reset `beforeEach` in the test file
itself — no changes needed to the shared contract file, so the InMemory/libSQL parity guarantee it
proves was never at risk.

**Real D1 coverage added:** schema sync (idempotent repeat calls; realistic
text/number/boolean/json/relation/many-relation/draft fields; the spec-049 shared-`ApiKeyAuthAdapter`-
instance coexistence guarantee); compound unique indexes (valid/duplicate/update-safe/update-conflict);
the entire `runDatabaseAdapterConstraintContractTests`/`runDatabaseAdapterQueryContractTests` suites
reused unmodified; a dedicated empty-OR-access-constraint-denies-all regression (the spec-050 security
fix); `containsValue` (exact match / substring does not match / missing does not match / empty array
does not match); JSON/array/many-relation/API-key-scope/metadata round-tripping (null, empty
object/array, booleans, numbers, unicode, nested JSON); binding-validation error messages against a
real Miniflare `env` shape; a real "missing table" D1 failure. **No behavioral differences found**
between D1 and libSQL/InMemory for any of this — the adapters already agreed, this was previously
unproven rather than previously wrong, except for the one bug below.

**Real R2 coverage added:** the full `StorageAdapter` contract suite plus put/get(bytes+metadata)/
delete/list/getPublicUrl specifics, and a missing-binding check against the real env shape.

**Real bug found and fixed:** real D1's raw unique-constraint error message carries a trailing
diagnostic suffix — `D1_ERROR: UNIQUE constraint failed: pages.tenant, pages.slug: SQLITE_CONSTRAINT
(extended: SQLITE_CONSTRAINT_UNIQUE)` — that the hand-rolled D1 mock's crafted error strings never
included (confirmed by deliberately provoking a real D1 unique-constraint violation and reading the raw
message). `@forge-cms/db`'s `parseSqliteUniqueConstraintMessage` split each comma-separated segment on
`.` without first stripping that suffix, so on a **compound** unique index the _last_ column's name got
corrupted with the trailing diagnostic text. That corrupted value flows into
`UniqueConstraintError.fields`, which `toApiErrorBody` puts directly into the public HTTP error
response's `details` — a real (if narrow) internal-detail leak, not merely a cosmetic parsing bug.
Fixed by truncating each segment at its own first `:` before parsing; covered by a new
`packages/db/src/constraint-error.test.ts` (both the plain SQLite/libSQL shape and the real D1 shape);
fed back into `d1.adapter.test.ts`'s `MockD1Database` so the mock now reproduces the real message shape
and this bug class is caught by the fast unit suite too, not only `pnpm test:cloudflare`.

**API-key/D1 integration:** full lifecycle proven against real D1 — sync, create, authenticate,
scope/metadata reaching `AuthUser`, `lastUsedAt` throttling _and_ advancing once the window passes,
revoke, post-revoke authentication failure. `CompositeAuthAdapter` correctly propagates a real D1
failure (an unsynced auth table) rather than downgrading it to a 401 — proven with an actual D1 error,
not a fake adapter that throws on command.

**Query/constraint contract result:** identical pass, zero adapter-specific test cases needed beyond
the shared suites plus the empty-OR/`containsValue` specifics above.

**HTTP integration:** one fixture (`test/workers/fixtures/worker.ts`, an `articles`/`tenant` collection
gated by an `articles:read` scope + tenant-scoped row-level access, plus a deliberately-unsynced
`unsynced` collection), one test file calling `exports.default.fetch(...)` from within the real
workerd runtime — all four cases proven: valid key + scope + correct tenant → 200 (rows correctly
scoped to that tenant); valid key without the scope → 403; no/invalid key → 401; the unsynced
collection's real "missing table" D1 failure → 500 with a generic body, no leaked SQL/table name.

**Storage lifecycle decision:** fixed, not deferred — the gap was narrow enough not to need a
transactional abstraction. `operations.ts`'s `deleteDocument` now deletes an upload-enabled document's
storage object after (never before, never on a denied/failed delete) the database delete succeeds,
best-effort/log-only on cleanup failure; `handlers.ts`'s `handleDelete` dropped its now-duplicate copy
(business logic back in the Local API, per CLAUDE.md). Covered by four InMemory cases in
`operations.test.ts` (normal delete, URL-derived-key fallback for a record with no `_storageKey`,
non-upload collections untouched, a denied delete leaves the object alone) and one real-R2 integration
case.

**Additive migration result:** proven — version A synced and seeded, version B (one added field)
synced again, the existing row's data preserved, the new column immediately usable by a new row.

**Packaging fixes found during the audit (not Cloudflare-runtime bugs, but adjacent correctness
issues):** `@forge-cms/storage` was missing from `@forge-cms/cloudflare`'s `dependencies` even though
`r2.adapter.ts` imports its types — it only worked via pnpm hoisting; added. The unused `drizzle-orm`
devDependency (the adapter hand-builds SQL; the README's "Drizzle-ready" claim was stale) was removed.
`pnpm release:verify` confirms the packed `@forge-cms/cloudflare` consumer still installs and
typechecks cleanly, with only the real `@forge-cms/*` packages in its dependency tree — no test-only
tooling (`@cloudflare/vitest-plugin`, the test-only `@forge-cms/runtime` devDependency) leaked in.

**CI changes:** one new named step in the existing `checks` job, `pnpm test:cloudflare`, after the
build step (workspace packages resolve through `dist/`). No new secrets; `wrangler.test.jsonc` needs
none. `pnpm test` is unaffected in scope or runtime.

**Docs/STATE updates:** `docs/STATE.md`'s spec-050-carried-forward `containsValue`/D1-mock caveat is
closed, replaced with a precise "locally verified against a real D1/R2 binding" claim, kept explicitly
distinct from the still-open "remote production deployment unconfirmed" note (both the package-table
row and the final unconfirmed-items note were reworded, not just appended to).
`apps/www/src/content/docs/deployment.md` gained a short section pointing at `pnpm test:cloudflare` and
stating the same local-vs-remote distinction for consumers.

**Exact commands executed, all green:** `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build`, `pnpm test:cloudflare`, `pnpm release:verify`, `pnpm e2e:www` (12/12, unaffected — no UI
surface changed).

**What still requires a real remote Cloudflare deployment:** everything this branch deliberately did
not touch — a real Cloudflare account's D1 database, R2 bucket, and Pages deployment; network
latency/cold-start behavior; Cloudflare account-level quotas/limits; `wrangler.toml`'s actual
`database_id`/bucket binding against a live account. The existing manual check
(`curl https://<deployed>/api/status`, `deployment.md` §7) remains the only way to confirm that, and
this branch did not attempt to automate or replace it — per the brief's explicit non-goal.

**No unrelated feature expansion:** no Glossa, SSR/Analog package, GraphQL, new auth features, new
query operators, admin redesign, migration history, image processing, or Cloudflare deployment
automation was introduced. The only production-code changes were the two bug fixes above (constraint-
error parsing, storage lifecycle) and one packaging fix (`@forge-cms/storage` dependency) — everything
else is new test infrastructure and docs.
