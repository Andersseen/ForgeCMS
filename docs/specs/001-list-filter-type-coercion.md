# 001 — Coerce list-filter query params to field types

- **Status:** draft
- **Author:** agent draft (example spec — also serves as the reference for the format)
- **Date:** 2026-07-07
- **Branch:** —
- **Affected packages/apps:** @forge-cms/runtime (primary), @forge-cms/core (maybe), apps/www (e2e only)

## Context / Why

`handleList` in `packages/runtime/src/handlers.ts` copies every non-`limit`/`offset` query param
into the `where` object as a **string**. Database adapters compare with strict equality, so
`GET /api/v1/products?price=99` never matches a numeric `99`, and `?published=true` never matches a
boolean `true`. This is Known issue #2 in [STATE.md](../STATE.md).

## Goal

Equality filters in list endpoints match records whose field values are numbers, booleans, or dates,
by coercing query-param strings according to the collection's field definitions.

## Non-goals

- Query operators (`gt`, `lt`, `in`, `contains`) — equality only, as today.
- Filtering on `json` or `relation` fields.
- Changing the `DatabaseAdapter` contract or the API envelope.

## Design

Add a pure helper in `@forge-cms/runtime` (not exported from the package root unless needed):

```ts
/** Coerce raw query-param strings to the value types declared by the collection's fields. */
function coerceWhere(collection: CollectionDefinition, raw: Record<string, string>): DatabaseRecord;
```

Rules per field kind: `number` → `Number(value)` (reject `NaN` → 400); `boolean` → `'true'/'false'`
→ boolean (anything else → 400); `date` → keep ISO string as-is (adapters store ISO strings);
all other kinds → string unchanged. Params that don't match any field name are passed through
unchanged (current behavior). Invalid coercion returns the standard error envelope:
`{ error: "Invalid filter value for field 'price'" }` with status 400.

`handleList` calls `coerceWhere(collection, where)` before `findMany`.

## Implementation plan

- [ ] Add `coerceWhere` + unit tests in `packages/runtime` (`handlers.test.ts` or a new `coerce.test.ts`)
- [ ] Use it in `handleList`; add handler-level tests for number/boolean/invalid cases
- [ ] Changeset (patch, @forge-cms/runtime) + update STATE.md known issue #2
- [ ] Mark this spec done

## Test plan

- Unit: coercion per field kind, unknown param passthrough, invalid number/boolean → 400.
- Handler: `handleList` with `?price=99` on a seeded in-memory adapter returns the record; `?price=abc` → 400.
- Full gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## Acceptance criteria

1. `GET /api/v1/products?price=99` (dev www server, seed data) returns the seeded product.
2. `GET /api/v1/products?price=abc` returns 400 with the error envelope.
3. No change to `DatabaseAdapter` or response shapes; contract tests untouched and green.
4. Full quality gates green.

## Open questions

- Should `date` filters accept `YYYY-MM-DD` prefixes (range-of-day matching), or exact ISO equality
  only? (Default assumption: exact equality; prefix matching is a non-goal.)

## Outcome

—
