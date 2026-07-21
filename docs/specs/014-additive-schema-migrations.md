# 014 — Additive schema migrations (auto `ALTER TABLE ADD COLUMN`)

- **Status:** done
- **Author:** agent draft (approved via user instruction to implement the Payload-parity roadmap)
- **Date:** 2026-07-20
- **Branch:** main
- **Affected packages/apps:** @forge-cms/db, @forge-cms/cloudflare

## Context / Why

`syncSchema` only runs `CREATE TABLE IF NOT EXISTS` — if a collection already has a table (from a previous
deploy) and a new field is added to its `defineCollection` fields, the column never gets created. The
first write touching that field fails with a raw SQL error (`no such column`) instead of anything
resembling ForgeCMS's usual validation/error envelope, and existing rows are simply never migrated.
STATE.md calls this out as "only `CREATE TABLE IF NOT EXISTS` sync" under `@forge-cms/db`'s known gaps.

## Goal

`syncSchema` detects fields present in a collection's definition but missing from its existing table and
adds them via `ALTER TABLE ... ADD COLUMN`, on both `LibSqlDatabaseAdapter` and `D1DatabaseAdapter`.

## Non-goals

- Dropping columns for fields removed from the definition (orphan columns are left alone — destructive
  migrations are out of scope and out of character for an auto-sync-on-boot model).
- Renaming or retyping existing columns (SQLite's `ALTER TABLE` support for this is limited/version-gated;
  not attempted).
- A migration history/version table, a CLI, or down-migrations — this stays an idempotent "sync toward the
  current definition" step run on every `syncSchema()` call, matching the existing `CREATE TABLE IF NOT
  EXISTS` model, not a versioned migration system.
- Backfilling the new column's `defaultValue` into existing rows (new columns are added as SQL `NULL` for
  existing rows, same as raw SQLite `ADD COLUMN` behavior; validation on read/write of old rows is
  unaffected since `validateField`/`validateCollection` already treat `undefined`/`null` per the field's
  own `required` flag).

## Design

### `@forge-cms/db` — `packages/db/src/schema-generator.ts`

```ts
export function generateAddColumnSql(
  collection: CollectionDefinition,
  existingColumns: Iterable<string>
): string[];
```

Returns one `ALTER TABLE "<slug>" ADD COLUMN "<field>" <SQL type>` string per field in
`collection.fields` that isn't in `existingColumns` (using the same `fieldKindToSqlType` mapping
`generateCreateTableSql` already uses). Empty array when nothing is missing (the common case on every
sync after the first).

### Adapters — introspect via `PRAGMA table_info`

Both `LibSqlDatabaseAdapter.syncSchema` and `D1DatabaseAdapter.syncSchema`, after their existing `CREATE
TABLE IF NOT EXISTS`, run `PRAGMA table_info("<slug>")` (supported by SQLite, libsql, and D1 alike),
collect the returned `name` column into a `Set<string>`, and execute each statement from
`generateAddColumnSql` before the existing index-creation loop (so a newly-added column can also be
indexed in the same sync pass if it declares `index`/`unique`).

## Implementation plan

- [x] `packages/db/src/schema-generator.ts`: `generateAddColumnSql`.
- [x] `packages/db/src/libsql.adapter.ts`: introspect via `this.client.execute('PRAGMA table_info(...)')`;
      run missing `ALTER TABLE` statements before index creation.
- [x] `packages/cloudflare/src/d1.adapter.ts`: introspect via `db.prepare('PRAGMA table_info(...)').all()`;
      same ordering.
- [x] `packages/cloudflare/src/d1.adapter.test.ts`'s `MockD1Database`: track per-table column sets from
      `CREATE TABLE`/`ALTER TABLE` statements passed to `exec()`, and answer `PRAGMA table_info` queries
      from that state (today's mock doesn't enforce a schema at all, so this is necessary for the new
      behavior to be meaningfully testable, not just a nice-to-have).
- [x] Tests: `schema-generator.test.ts` (`generateAddColumnSql`); `libsql.adapter.test.ts` (real SQLite —
      sync a collection, add a field to its definition, re-sync, confirm the column exists and is usable);
      `d1.adapter.test.ts` (same scenario against the extended mock).
- [x] `docs/ARCHITECTURE.md` / `docs/STATE.md`: document additive migrations; update `@forge-cms/db` row;
      mark the migrations gap (partially) done — note the explicit non-goals so it's clear this isn't a
      full migration system.
- [x] Changeset: `@forge-cms/db`, `@forge-cms/cloudflare` (minor — additive, no contract signature change).

## Test plan

- `schema-generator.test.ts`: a collection with fields `[a, b]` and existing columns `[a]` → one `ALTER
  TABLE ... ADD COLUMN "b"` statement; existing columns already matching → empty array.
- `libsql.adapter.test.ts`: `syncSchema([v1])` (fields: `title`) → create + insert a row → redefine the
  collection as `v2` (fields: `title`, `views`) → `syncSchema([v2])` → the v1 row is still readable
  (`views` reads back as `null`/undefined) and a new row can now set `views`.
- `d1.adapter.test.ts`: same scenario against the (extended) mock.

## Acceptance criteria

1. A field added to a collection's definition after its table already exists becomes a real column on the
   next `syncSchema()` call, on both `LibSqlDatabaseAdapter` and `D1DatabaseAdapter`.
2. Existing rows and existing columns are untouched — `syncSchema` never drops data or columns.
3. Running `syncSchema` again with no field changes issues zero `ALTER TABLE` statements (idempotent).
4. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.

## Open questions

(none — approved)

## Outcome

Shipped 2026-07-20 as specified. Extending `d1.adapter.test.ts`'s mock to track real schema state (needed
to test `PRAGMA table_info`) surfaced a pre-existing, unrelated bug in the same mock: `findById`/`update`/
`delete` build `WHERE id = ?` unquoted while `findMany` quotes column names, and the mock's WHERE-clause
regex only matched quoted identifiers — so with more than one row in a table, `first()` silently ignored
the `WHERE` entirely and returned the wrong row. Every prior test happened to only ever have one row in
play at `findById` time, so this never surfaced. Fixed by making the mock's comparison regex accept both
quoted and unquoted column names (test-only change; the real `D1DatabaseAdapter`/real SQLite were never
affected — SQLite doesn't care about identifier quoting either way). The new migration tests are also the
regression test for this. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.
