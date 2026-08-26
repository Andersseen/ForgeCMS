# 046 — Compound indexes and schema integrity

- **Status:** done
- **Author:** agent draft from maintainer release brief
- **Date:** 2026-08-26
- **Branch:** main
- **Affected packages/apps:** @forge-cms/core, @forge-cms/db, @forge-cms/cloudflare, @forge-cms/runtime,
  @forge-cms/testing, apps/www (docs only)

## Context / Why

ForgeCMS `0.0.1` is published and is being dogfooded by an external consumer (Glossa). Glossa needs a
compound unique constraint — `(project, locale, namespace)` must be unique — which today's schema DSL
cannot express: `unique`/`index` (see `docs/ARCHITECTURE.md`'s Schema DSL section) are single-field
only, and `InMemoryDatabaseAdapter` does not enforce uniqueness at all (STATE.md, spec 044's outcome
note), so a compound-uniqueness bug can pass local dev/tests and only surface against real D1/libSQL.
This is a generic schema-integrity gap, not a Glossa-specific feature.

## Goal

`CollectionDefinition` supports collection-level `indexes` (including compound `unique: true`), D1 and
libSQL generate the matching SQL indexes from one shared `@forge-cms/db` code path, `InMemoryDatabaseAdapter`
enforces the same uniqueness semantics in-process, and every adapter surfaces a conflict as the same
typed `UniqueConstraintError` (`409` over HTTP).

## Non-goals

- API keys, new auth architecture, sessions, OAuth, teams, multi-tenancy — auth is deferred to the next
  branch (see `docs/ROADMAP.md`-adjacent decision recorded in this spec's originating brief).
- Postgres, MongoDB, GraphQL, new field kinds, a plugin system, an admin redesign.
- Any translation-, locale-file-, project-token-, or otherwise Glossa-specific concept in this repo.
- Indexing/uniqueness _inside_ composite (`group`/`array`/`blocks`) JSON columns — out of scope, same
  limitation `ARCHITECTURE.md` already documents for querying composite fields.
- Dropping/retyping indexes, or any migration story beyond `CREATE INDEX IF NOT EXISTS` (matches the
  existing additive-only column migration policy, spec 014).
- A collision-proof index-naming scheme (e.g. hashing) beyond the existing deterministic
  `idx_<collection>_<field...>` convention — field identifiers are already validated, and the
  implementation rejects exact-duplicate index definitions.

## Design

### Schema DSL (`@forge-cms/core`)

```ts
export interface CollectionIndex {
  /** Field order matters: it is the column order in the generated SQL index. */
  fields: string[];
  unique?: boolean;
}

export interface CollectionDefinition<...> {
  // ...existing options...
  indexes?: CollectionIndex[];
}
```

Single-field `unique: true` / `index: true` on a field's `BaseFieldOptions` are unchanged and keep
working exactly as before — `indexes` is additive sugar for the multi-field case, not a replacement.

`validateCollectionIndexes(collection)` (new, `packages/core/src/collection-indexes.ts`) returns
`string[]` errors, following the existing `validateCollectionIdentifiers` pattern, and is wired into
`defineCollection()` so invalid indexes throw at definition time, same UX as bad identifiers:

- an index with an empty `fields` array,
- an index field name not present in `collection.fields`,
- a field repeated within one index's `fields`,
- two `indexes` entries with the exact same `fields` array (order-sensitive, since order is
  semantically meaningful and both would generate the identical index name).

### Index generation (`@forge-cms/db`)

Centralized in `packages/db/src/schema-generator.ts` (alongside `generateCreateTableSql`/
`generateAddColumnSql`, reusing the same identifier-validation guard):

```ts
export interface ResolvedIndex {
  name: string;
  fields: string[];
  unique: boolean;
}

export function resolveCollectionIndexes(collection: CollectionDefinition): ResolvedIndex[];
export function generateIndexSql(collection: CollectionDefinition): string[];
```

`resolveCollectionIndexes` merges single-field `unique`/`index` options and the `indexes` array into one
normalized list, naming every index deterministically as `idx_<collection.slug>_<fields.join('_')>` —
matching the existing single-field convention exactly, so no consumer-visible index name changes for
collections that only use field-level `unique`/`index` today. `generateIndexSql` maps that list to
`CREATE [UNIQUE ]INDEX IF NOT EXISTS "name" ON "table" ("f1"[, "f2", ...])`.

`D1DatabaseAdapter.syncSchema` and `LibSqlDatabaseAdapter.syncSchema` both replace their private
duplicated per-field index loop with `generateIndexSql(collection)`, so D1 and libSQL cannot diverge.

### Constraint errors

`packages/db/src/constraint-error.ts` (new):

```ts
export class UniqueConstraintError extends Error {
  readonly code = 'UNIQUE_CONSTRAINT';
  readonly collection: string;
  readonly fields: string[];
  readonly indexName?: string;
}
export function isUniqueConstraintError(err: unknown): err is UniqueConstraintError;
/** Parses SQLite's "UNIQUE constraint failed: table.col1, table.col2" message, shared by the
 *  libSQL adapter (packages/db) and the D1 adapter (packages/cloudflare, which already depends on
 *  packages/db) so both translate the same underlying SQLite error the same way. */
export function toUniqueConstraintError(
  err: unknown,
  collectionSlug: string
): UniqueConstraintError | null;
```

- `InMemoryDatabaseAdapter` now records collections passed to `syncSchema` (it did not before) and
  constructs `UniqueConstraintError` directly in `create`/`update` after finding a conflict, using
  `resolveCollectionIndexes` — no SQL involved, but the same conflict semantics: a row is only checked
  against a unique index when none of that index's fields are `null`/`undefined` on the incoming row
  (mirroring SQLite's "NULL is never equal to NULL" unique-index behavior), and `update` excludes the
  record being updated from the conflict search.
- `LibSqlDatabaseAdapter.create`/`update` wrap the underlying `db.insert`/`db.update` call and convert a
  caught SQLite unique-constraint error via `toUniqueConstraintError`.
- `D1DatabaseAdapter.create`/`update` do the same around `db.prepare(...).run()`.
- `@forge-cms/runtime`'s `errors.ts` gains a `ForgeError` subclass with the same name, `409`, and code
  `'UNIQUE_CONSTRAINT'`, carrying `collection`/`fields`. `operations.ts`'s `create`/`update` catch the
  `@forge-cms/db`-level error around the adapter call and rethrow the runtime one (`@forge-cms/db` and
  `@forge-cms/cloudflare` do not depend on `@forge-cms/runtime` — see `ARCHITECTURE.md`'s dependency
  graph — so the translation has to happen at the runtime layer, the same place `ValidationFailedError`
  etc. already live). No change is needed in `handlers.ts`: it already maps any `ForgeError` via its
  `status`/`code` generically.

### Contract tests (`@forge-cms/testing`)

`packages/testing/src/contracts/database.ts` gains a second exported suite,
`runDatabaseAdapterConstraintContractTests(createAdapter)`, parameterized like the existing one but
calling `adapter.syncSchema([...])` first with real `defineCollection`/`defineField` fixtures (a
single-field-unique collection and a compound-unique collection), covering: single-field unique reject,
compound-unique reject, two different compound combinations both succeeding, update-into-self is fine,
update-into-another-record's-combination conflicts. It asserts on `isUniqueConstraintError`/`.collection`/
`.fields`, not on adapter-specific error shapes. Run from `packages/db/src/index.test.ts` (in-memory),
`packages/db/src/libsql.adapter.test.ts` (real libSQL against `file::memory:` — genuine SQLite enforcement,
no mocking needed), and `packages/cloudflare/src/d1.adapter.test.ts` (the hand-rolled `MockD1Database`
gains real `CREATE [UNIQUE] INDEX`-aware enforcement in `handleInsert`/`handleUpdate`, throwing a
realistic `UNIQUE constraint failed: table.col1, table.col2` message, so the D1 adapter's real
catch-and-convert code path is exercised, not just re-implemented in the test).

## Implementation plan

- [x] `@forge-cms/core`: `CollectionIndex` type, `indexes?` on `CollectionDefinition`,
      `validateCollectionIndexes`, wired into `defineCollection`, exported from `src/index.ts`.
- [x] `@forge-cms/db`: `resolveCollectionIndexes`/`generateIndexSql` in `schema-generator.ts`
      (`assertValidCollectionSchema` also runs `validateCollectionIndexes`); `constraint-error.ts`;
      `InMemoryDatabaseAdapter` registers collections + enforces uniqueness in `create`/`update`;
      `LibSqlDatabaseAdapter` uses `generateIndexSql` and converts constraint errors; new exports from
      `src/index.ts`.
- [x] `@forge-cms/cloudflare`: `D1DatabaseAdapter` uses `generateIndexSql` and converts constraint
      errors; `MockD1Database` test double enforces unique indexes realistically.
- [x] `@forge-cms/runtime`: `UniqueConstraintError` in `errors.ts`; `operations.ts` create/update convert
      the db-layer error.
- [x] `@forge-cms/testing`: `runDatabaseAdapterConstraintContractTests`, run from all three adapters'
      test files.
- [x] Unit tests: `schema-generator.test.ts` (deterministic names, field order, unique vs not, quoting,
      no regression on existing field-level index tests), `collection-indexes` validation tests in core,
      a runtime-level test proving a `create`/`update` conflict surfaces as `409 UNIQUE_CONSTRAINT` over
      the HTTP handlers.
- [x] `scripts/verify-release.mjs`: extend the runtime-consumer fixture with a compound `unique: true`
      index and a create-conflict assertion, proving the public surface through packed artifacts.
- [x] Docs: `apps/www/src/content/docs/collections.md` gets an "Indexes" section (mirrors the "Drafts"
      section's style); `docs/ARCHITECTURE.md`'s Schema DSL paragraph gets one sentence.
- [x] Changeset (`patch`, since this is additive/non-breaking) + `docs/STATE.md` update + close this spec.

## Test plan

- `pnpm --filter @forge-cms/core test`
- `pnpm --filter @forge-cms/db test`
- `pnpm --filter @forge-cms/cloudflare test`
- `pnpm --filter @forge-cms/runtime test`
- `pnpm --filter @forge-cms/testing test`
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- `pnpm format:check`
- `node scripts/verify-release.mjs` (or the packaged `pnpm release:verify`, budget permitting — see
  Outcome for what actually ran)

## Acceptance criteria

1. `CollectionDefinition` supports compound indexes via `indexes: [{ fields: [...], unique?: boolean }]`.
2. Compound unique constraints work identically on D1, libSQL, and InMemory.
3. D1 creates the compound index via `CREATE UNIQUE INDEX IF NOT EXISTS "idx_..." ON "..." (...)`.
4. libSQL creates the same index via the same shared `@forge-cms/db` code path.
5. `InMemoryDatabaseAdapter` rejects a duplicate single-field or compound-unique combination on create
   and update, while allowing a record to keep its own values and allowing distinct combinations.
6. Existing single-field `unique`/`index` collections generate the exact same index names/SQL as before
   (no regression).
7. Invalid index definitions (`fields: []`, unknown field, duplicate field in one index, duplicate
   equivalent `indexes` entries) throw from `defineCollection` with a clear message.
8. A unique conflict from any of the three adapters surfaces through the Local API as
   `UniqueConstraintError` (`code: 'UNIQUE_CONSTRAINT'`) and through HTTP as `409`.
9. External-consumer packaging fixture in `scripts/verify-release.mjs` compiles and runs a compound
   unique index through the packed `@forge-cms/core`/`@forge-cms/db`/`@forge-cms/runtime` surface with
   no deep imports.
10. `docs/collections.md` documents field-level `index`/`unique` and collection-level `indexes`,
    including that field order matters for compound indexes.
11. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (and `format:check`) all green.

## Open questions

None — this spec transcribes an already-approved maintainer brief; implementation proceeds directly.

## Outcome

Shipped as designed, no divergence. `CollectionDefinition.indexes` + single-field `unique`/`index` both
work; `@forge-cms/db`'s `resolveCollectionIndexes`/`generateIndexSql` are the one shared code path D1
and libSQL both call from `syncSchema`; `InMemoryDatabaseAdapter` now registers collections and
enforces the identical single-field/compound unique semantics in-process (SQLite NULL-exemption
included); every adapter's conflict surfaces as `@forge-cms/db`'s `UniqueConstraintError`, translated
by `operations.ts` into `@forge-cms/runtime`'s own `UniqueConstraintError` (`409`,
`UNIQUE_CONSTRAINT`), with no changes needed to `handlers.ts`'s existing generic `ForgeError` → HTTP
mapping. `@forge-cms/testing/contracts` gained `runDatabaseAdapterConstraintContractTests`, run from
all three adapters (InMemory, a real libSQL `:memory:` database, and a `D1` mock that was extended to
actually enforce `CREATE [UNIQUE] INDEX` rather than being a dumb store, so the D1 adapter's real
catch-and-convert code path is exercised). `docs/collections.md` gained an "Indexes" section;
`docs/ARCHITECTURE.md`'s Schema DSL paragraph got one sentence. `scripts/verify-release.mjs`'s runtime
consumer fixture now declares a compound `unique: true` index and asserts the conflict throws
`UniqueConstraintError` with `status: 409`/`code: 'UNIQUE_CONSTRAINT'` through the packed public API.

A changeset (`patch`, all five touched packages) is in place; `pnpm changeset status` confirms the
fixed public package family — including packages this spec did not touch, e.g. `@forge-cms/auth` —
bumps `0.0.1` → `0.0.2` together. The actual version bump/publish is the existing automated Changesets
Release PR flow in CI on merge to `main` (see `.github/workflows/ci.yml`), not a manual step taken in
this pass — consistent with how every other package change in this repo ships.

Verification actually executed: `pnpm --filter <pkg> build/test` for core, db, cloudflare, runtime,
testing individually while implementing; then `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`,
`pnpm format:check` (all green, whole monorepo, 13/13 or 23/23 tasks depending on the command); then
`pnpm release:verify` (packs all ten public packages, installs them into four isolated external
consumer projects, compiles and runs the runtime-consumer fixture — printed `runtime consumer ok` and
`Release verification passed.`); then `pnpm e2e:www` (12/12 Playwright tests green — unaffected by this
change but run anyway since it's part of the repo's standard CI gate). Auth (API keys etc.) was
deliberately not started, per this spec's non-goals.
