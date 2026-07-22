# 012 — Add relation population (`?depth=1`)

- **Status:** done
- **Author:** agent draft (approved via user instruction to implement the Payload-parity roadmap)
- **Date:** 2026-07-20
- **Branch:** main
- **Affected packages/apps:** @forge-cms/runtime, apps/www

## Context / Why

`relation` fields (`defineField.relation({ collection, many? })`) store bare ID strings (or an array of
them) and are never resolved to the actual related record — a client that wants to show a post's author
name has to make a second request per relation. STATE.md's package table calls this out as a known gap
("relation population"). This spec adds it as an opt-in query param, matching the "Payload-like" framing
this project already uses (Payload calls the same concept `depth`).

## Goal

`GET /api/v1/[collection]` and `GET /api/v1/[collection]/[id]` accept `?depth=1`, which replaces each
`relation` field's ID (or array of IDs) with the actual related record(s) (or `null`/omitted when the
related record no longer exists).

## Non-goals

- Multi-level population (`depth` > 1, i.e. populating relations _of_ a populated relation). `depth`
  only accepts `0` (default, off) or `1`.
- Populating relations nested inside `json` field values.
- Changing the write shape — `POST`/`PUT` still take and validate bare ID strings, unchanged.
- Selecting which fields of the populated record to include (always the full record, like an unpopulated
  `findById`/`findMany` response).

## Design

### `@forge-cms/runtime` — new `populate.ts`

```ts
export async function populateRecord<TEnv>(
  record: DatabaseRecord,
  collection: CollectionDefinition,
  runtime: ForgeCmsRuntime<TEnv>
): Promise<DatabaseRecord>;

export async function populateRecords<TEnv>(
  records: DatabaseRecord[],
  collection: CollectionDefinition,
  runtime: ForgeCmsRuntime<TEnv>
): Promise<DatabaseRecord[]>;
```

For each `relation` field on `collection`: collect every referenced id across all input records into one
`Set<string>`, fetch them in a single batched `findMany({ collection: targetSlug, where: { id: { in: [...] } } })`
call (built on spec 011's `in` operator — one query per relation _field_, not per record/id), then replace
each record's field value:

- single relation (`many` falsy): the matching record, or `null` if not found (deleted/dangling reference).
- `many: true`: the array of matching records, silently dropping ids that no longer resolve.

If `field.options.collection` doesn't name a registered collection (shouldn't happen in practice, but the
type doesn't guarantee it), the field is left untouched as raw id(s) rather than throwing.

### `@forge-cms/runtime` — `handleList` / `handleRead`

Parse `depth` from query params (added to `RESERVED_QUERY_PARAMS` alongside `limit`/`offset`/`sort`/`order`
so it isn't treated as a `where` filter). Only `"0"` (or absent) and `"1"` are valid; anything else → `400`
(same `errorResponse` pattern as invalid `sort`/`order`). When `depth=1`, run the fetched record(s) through
`populateRecord`/`populateRecords` before building the JSON response.

## Implementation plan

- [x] `packages/runtime/src/populate.ts`: `populateRecord`, `populateRecords`.
- [x] `packages/runtime/src/handlers.ts`: parse/validate `depth`; add to `RESERVED_QUERY_PARAMS`; call
      populate in `handleList` and `handleRead` when `depth=1`.
- [x] `packages/runtime/src/index.ts`: export `populateRecord`/`populateRecords`.
- [x] Unit tests in `packages/runtime/src/populate.test.ts` (single + many relations, dangling id, no
      relation fields, empty record set) and `handlers.test.ts` (`?depth=1` populates, `?depth=2` → 400).
- [x] `docs/ARCHITECTURE.md` / `docs/STATE.md`: document `depth`; update `@forge-cms/runtime` row and API
      surface section; mark the "relation population" gap done.
- [x] Changeset: `@forge-cms/runtime` (minor — additive).

## Test plan

- `populate.test.ts`: a `posts` collection with `author: relation('users')` and `tags: relation('tags', { many: true })`
  — populating replaces both correctly; a dangling `author` id becomes `null`; a dangling entry inside
  `tags` is dropped, not nulled.
- `handlers.test.ts`: `GET /api/v1/posts?depth=1` returns populated `author`/`tags`; `GET
/api/v1/posts/:id?depth=1` same; `?depth=1` with no relation fields on the collection is a no-op;
  `?depth=abc` → 400.
- Manual: `pnpm dev:www` → create a post with a real `author` id, `GET
/api/v1/posts?depth=1` shows the full user object instead of the id.

## Acceptance criteria

1. `?depth=1` populates every `relation` field on both list and single-record read.
2. Dangling single relations become `null`; dangling entries in `many` relations are dropped.
3. Population is exactly one extra `findMany` call per relation field per request (not per record).
4. `?depth=0` or absent `depth` behaves exactly as before this spec (bare ids).
5. Any `depth` value other than `0`/`1` → `400`.
6. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.

## Open questions

(none — approved)

## Outcome

Shipped 2026-07-20 as specified, no divergence. Built directly on spec 011's `in` operator for batched
lookups. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.
