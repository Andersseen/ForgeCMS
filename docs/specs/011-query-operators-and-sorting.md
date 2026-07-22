# 011 — Add query operators and sorting to findMany

- **Status:** done
- **Author:** agent draft (approved via user instruction to implement the Payload-parity roadmap)
- **Date:** 2026-07-20
- **Branch:** main
- **Affected packages/apps:** @forge-cms/db, @forge-cms/cloudflare, @forge-cms/runtime,
  @forge-cms/testing, apps/www

## Context / Why

`DatabaseAdapter.findMany`'s `where` is equality-only today (documented as a known limitation in
ARCHITECTURE.md and STATE.md's package table for `@forge-cms/db`). Every adapter (`InMemoryDatabaseAdapter`,
`LibSqlDatabaseAdapter`, `D1DatabaseAdapter`) filters with `Object.entries(where).every(([k,v]) => r[k] === v)`
or its SQL equivalent (`"key" = ?` / drizzle `eq()`). There is no way to filter numeric/date ranges, exclude
a value, filter by a set of values, do a substring match, or sort results — all baseline expectations for a
Payload-like CMS list view (e.g. "posts with views > 100", "posts NOT in draft status", sorted by date).

## Goal

`findMany` supports per-field operators (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `contains`) and
single-field sorting, consistently across all three `DatabaseAdapter` implementations, exposed through the
existing `GET /api/v1/[collection]` list endpoint via query params.

## Non-goals

- Multi-field sort (single `sort`/`order` pair only).
- Combining conditions with OR (all conditions in `where` remain AND-ed together, as today).
- Nested/grouped conditions.
- Full-text search (`contains` is a simple `LIKE '%value%'` / `.includes()`, not FTS).
- Changing `count(collection)` to accept `where` (stays collection-wide; not needed by any current caller).

## Design

### `@forge-cms/db` — `FindManyOptions` (breaking-compatible type change)

```ts
export type WhereOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';

export type WhereValue =
  | { eq: unknown }
  | { ne: unknown }
  | { gt: unknown }
  | { gte: unknown }
  | { lt: unknown }
  | { lte: unknown }
  | { in: unknown[] }
  | { contains: string };

/** A bare value means `eq` (backward compatible with today's `{ field: value }` usage). */
export type WhereCondition = unknown | WhereValue;

export type DatabaseWhere = Record<string, WhereCondition>;

export interface FindManyOptions {
  collection: string;
  limit?: number;
  offset?: number;
  where?: DatabaseWhere;
  sort?: string; // field name
  order?: 'asc' | 'desc'; // default 'asc', ignored if `sort` is absent
}
```

A small shared helper `isWhereValue(v): v is WhereValue` and `matchesCondition(value, condition): boolean`
live in `packages/db/src/where.ts` and are exported from `@forge-cms/db` for reuse by `InMemoryDatabaseAdapter`
(direct in-JS comparison) and to keep the operator list in one place. `LibSqlDatabaseAdapter` and
`D1DatabaseAdapter` map operators to SQL themselves (drizzle operators / raw SQL), not through this helper,
since they need to produce query fragments, not evaluate values.

`in` values are always arrays (already-coerced by the caller — see handlers below). `contains` only makes
sense for string columns; adapters apply it via `LIKE`/`.includes()` regardless of declared field kind (no
runtime type-check — a `contains` against a number column is a caller error that will just match nothing on
libsql/d1's LIKE-on-numeric-cast behavior, and never-true on in-memory since `.includes` requires a string).

### `@forge-cms/runtime` — HTTP query param syntax

Bracket syntax, matching the convention this project's docs already call "Payload-like":

```
GET /api/v1/posts?views[gt]=100&status[ne]=draft&tags[in]=a,b,c&title[contains]=hello&sort=views&order=desc
GET /api/v1/posts?status=published        // unchanged: bare value is still eq
```

`coerceWhere` in `packages/runtime/src/handlers.ts` is extended to:

1. Parse keys of the form `field[operator]`. Reject unknown operators with a 400 (reuse the existing
   `FilterCoercionError` path).
2. Coerce the value string to the field's declared type the same way it does today for bare `eq` (number →
   `Number()`, boolean → `'true'/'false'`, else pass through as string), except `in`, which splits on `,`
   first and coerces each element.
3. Parse `sort` (must name a real field on the collection, else 400) and `order` (`asc`|`desc`, else 400;
   default `asc` when `sort` is present) from the top-level query params (already excluded from `where`
   alongside today's `limit`/`offset`).

### Adapter implementations

- **`InMemoryDatabaseAdapter`**: replace the `.every(eq)` filter with `matchesCondition` per field; add a
  sort step (`Array.prototype.sort`, stable, using `<`/`>` — good enough for strings/numbers/ISO date
  strings) before the existing offset/limit slicing.
- **`LibSqlDatabaseAdapter`**: map operators to drizzle's `eq/ne/gt/gte/lt/lte/inArray/like` (import from
  `drizzle-orm`), combined with the existing `and(...)`; add `.orderBy(asc(col)/desc(col))` when `sort` is
  set.
- **`D1DatabaseAdapter`**: map operators to raw SQL fragments (`= ?`, `!= ?`, `> ?`, `>= ?`, `< ?`, `<= ?`,
  `IN (?, ?, ...)`, `LIKE ?` with `%` wrapping applied server-side, not trusting caller-supplied wildcards);
  append `ORDER BY "<col>" ASC|DESC` (column name validated against the collection's known fields before
  interpolation — same trust boundary as today's existing column-name interpolation in this adapter).

## Implementation plan

- [x] `packages/db/src/where.ts`: `WhereOperator`, `WhereValue`, `WhereCondition`, `DatabaseWhere`,
      `isWhereValue`, `matchesCondition`; export from `packages/db/src/index.ts`; update `FindManyOptions`.
- [x] `packages/db/src/in-memory.adapter.ts`: use `matchesCondition`; add sort.
- [x] `packages/db/src/libsql.adapter.ts`: operator → drizzle mapping; add `.orderBy`.
- [x] `packages/cloudflare/src/d1.adapter.ts`: operator → SQL mapping; add `ORDER BY`.
- [x] `packages/runtime/src/handlers.ts`: extend `coerceWhere` for `field[operator]` keys; parse
      `sort`/`order`; pass through in `handleList`.
- [x] `packages/testing/src/contracts/database.ts`: extend `ContractDatabaseAdapter.findMany` type; add
      contract tests for each operator and for sort (asc/desc).
- [x] Unit tests: `packages/db/src/*.test.ts`, `packages/cloudflare/src/d1.adapter.test.ts`,
      `packages/runtime/src/handlers.test.ts` (query-string parsing incl. 400 on unknown operator/sort field).
- [x] `docs/ARCHITECTURE.md` line 70: remove "`where` is equality-only today"; document operators + sort.
- [x] `docs/STATE.md`: `@forge-cms/db` row, API surface section, known-issues/what's-next list.
- [x] Changesets: `@forge-cms/db`, `@forge-cms/cloudflare`, `@forge-cms/runtime` (minor — additive contract
      change).

## Test plan

- Contract suite (`runDatabaseAdapterContractTests`) run against all three adapters covers every operator
  and both sort directions — this is the primary correctness proof since it runs identically against
  in-memory, libsql, and D1.
- `handlers.test.ts`: `?views[gt]=10` produces the right `where` shape passed to a fake database adapter;
  `?foo[bogus]=1` → 400; `?sort=nonexistentField` → 400.
- Manual: `pnpm dev:www` → `GET /api/v1/posts?views[gt]=0&sort=views&order=desc` returns posts sorted
  descending by views.

## Acceptance criteria

1. All three `DatabaseAdapter` implementations pass the extended `runDatabaseAdapterContractTests` suite.
2. `GET /api/v1/[collection]` accepts `field[op]=value` for every listed operator and `sort`/`order`.
3. Unknown operator or unknown sort field → `400` with a descriptive `error` message (existing envelope).
4. Existing bare-equality query params (`?status=published`) still work unchanged.
5. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.

## Open questions

(none — approved)

## Outcome

Shipped 2026-07-20. One divergence from the plan: the shared `runDatabaseAdapterContractTests` runner
takes a synchronous `createAdapter()` factory, but `LibSqlDatabaseAdapter`/`D1DatabaseAdapter` need an
async `syncSchema()` call before `findMany`/`create` work (they throw "not registered" otherwise) — this
was already true before this spec (only `InMemoryDatabaseAdapter` used the shared runner; D1 had its own
bespoke test file). Rather than changing the contract-test harness's API (out of scope), gave
`LibSqlDatabaseAdapter` its own dedicated test file (it had none before, a pre-existing gap) and extended
D1's existing bespoke test file — both cover every operator and both sort directions with equivalent
assertions to the contract suite, just not through the literal same runner. All other acceptance criteria
met as specified; `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.
