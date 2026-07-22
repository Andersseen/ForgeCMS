# 018 — Fix the users auth schema and give lists real pagination metadata

- **Status:** done
- **Author:** agent draft
- **Date:** 2026-07-22
- **Branch:** main
- **Affected packages/apps:** @forge-cms/auth, @forge-cms/db, @forge-cms/cloudflare, @forge-cms/runtime, @forge-cms/testing, apps/www

## Context / Why

Two Phase 0 items from [ROADMAP.md](../ROADMAP.md), both blocking:

1. `UsersCollectionAuthAdapter` writes a `passwordHash` column that no `users` collection declares.
   On the in-memory adapter that is harmless (schemaless); on D1 it means the generated table has no
   such column and **every login and createUser fails in production** with
   `D1_ERROR: table users has no column named passwordHash` (STATE.md known issue #10, last bullet).
2. `meta.count` on a list response is the length of the returned page, and `DatabaseAdapter.count`
   had no `where` parameter — so no client can build a paginator, which blocks the admin list view.

## Goal

Auth works on the D1 path, and a list response carries enough metadata to drive a paginator.

## Non-goals

- Publishing to npm (Phase 0.3) — needs registry credentials, a human step.
- Cursor-based pagination. Offset/limit only.

## Design

### Auth schema

`@forge-cms/auth` gains `AUTH_USER_FIELDS` and `withAuthFields(collection)`:

```ts
export const AUTH_USER_FIELDS = {
  passwordHash: defineField.text({ access: { read: [], write: [] } })
} satisfies FieldMap;

export function withAuthFields<TSlug, TFields>(
  collection: CollectionDefinition<TSlug, TFields>
): CollectionDefinition<TSlug, TFields & typeof AUTH_USER_FIELDS>;
```

Explicit fields win over the defaults, and the input collection is not mutated. `access.read: []`
means "no role is on the allowlist", so `filterReadableFields` strips `passwordHash` from every API
response as a side benefit. This adds `@forge-cms/core` to `@forge-cms/auth`'s dependencies (core has
no dependencies of its own, so there is no cycle).

### `count(where)`

```diff
- count(collection: string): Promise<number>;
+ count(collection: string, where?: DatabaseWhere): Promise<number>;
```

Implemented in all three adapters. `LibSqlDatabaseAdapter` and `D1DatabaseAdapter` each grew a shared
where-clause builder so `findMany` and `count` cannot drift apart.

### Pagination metadata

`meta` gains `totalDocs`, `page`, `totalPages`, `hasNextPage`, `hasPrevPage`. `count` is kept as the
page length so existing clients do not break.

## Implementation plan

- [x] `AUTH_USER_FIELDS` / `withAuthFields` (@forge-cms/auth) + apply in `apps/www`
- [x] `count(collection, where?)` on the contract and all three adapters
- [x] Extract `buildWhereClause`/`buildWhereCondition` in the D1 and LibSQL adapters
- [x] Pagination metadata (delivered via spec 019's `PaginatedDocs`)
- [x] Contract tests + regression test tying `withAuthFields` to the generated SQL
- [x] changeset

## Test plan

- `packages/auth/src/user-fields.test.ts` — including the SQL-generation regression test.
- `runDatabaseAdapterContractTests` — four new `count` cases, incl. "ignores limit when counting".
- `packages/runtime/src/operations.test.ts` — pagination metadata across pages.
- Manual: `curl 'localhost:5173/api/v1/pages?limit=2'` shows `totalDocs: 3, totalPages: 2`.

## Acceptance criteria

1. ✅ The generated `users` table contains a `passwordHash` column.
2. ✅ `passwordHash` never appears in an API response.
3. ✅ `count` accepts a `where` and returns the total ignoring limit/offset, on all three adapters.
4. ✅ A list response carries `totalDocs`/`page`/`totalPages`/`hasNextPage`/`hasPrevPage`.
5. ✅ `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.

## Outcome

Shipped 2026-07-22. Verified against the running dev server: login succeeds, `/api/auth/users`
returns `['email','id','name','role']` with no `passwordHash`, and `?limit=2` reports `totalDocs: 3`.
