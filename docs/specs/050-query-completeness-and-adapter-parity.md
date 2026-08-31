# 050 — Query completeness & adapter parity

- **Status:** done
- **Author:** agent draft (maintainer-scoped brief)
- **Date:** 2026-08-30
- **Branch:** feature/query-completeness
- **Affected packages/apps:** @forge-cms/db, @forge-cms/cloudflare, @forge-cms/runtime, @forge-cms/core,
  @forge-cms/angular, @forge-cms/testing, apps/www (docs only), scripts/verify-release.mjs
  (packed-artifact consumer checks, no package version implication)

## Context / Why

ROADMAP item 026 ("query completeness") and DEMO-FINDINGS.md both flag the same gap: `where` is flat
AND-only, sort is single-field, there is no `findOne`, and a `relation({ many: true })` array cannot be
queried for membership. Spec 049 finished hardening auth/runtime; this is the next stabilization branch
for the `0.1.x` line — a foundation gap, not a new feature area.

## Goal

`find`/`count`/`findOne` accept nested `and`/`or` boolean queries and multi-field sort with identical
observable behavior across `InMemoryDatabaseAdapter`, `LibSqlDatabaseAdapter`, and `D1DatabaseAdapter`,
access-rule constraints stay securely AND-composed with any consumer query, and the Angular client can
express all of it without raw `fetch`.

## Non-goals

Everything in the brief's "NON-GOALS" list: Glossa, translation, GraphQL, Postgres/Mongo/Elasticsearch,
full-text search, arbitrary JSONPath, a joins DSL, SQL escape hatches, a plugin system, a CLI, a
migrations overhaul, SSR/hydration, email, more auth features, orgs/teams/billing, admin redesign, new
field kinds. Also non-goals for this branch specifically: querying _inside_ `group`/`array`/`blocks`
JSON, more than the `containsValue` array-membership operator, and any change to the stable API
envelope's success/error shape.

## Audit findings (step 1)

| Area                                                      | Finding                                                                                                                                                                                                                                       | Classification                                                                             |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `packages/db/src/where.ts`                                | `DatabaseWhere` is `Record<string, WhereCondition>` — flat AND across keys, AND across operators on one key. No `and`/`or`.                                                                                                                   | MISSING CAPABILITY                                                                         |
| `in-memory.adapter.ts` `findMany`/`count`                 | Flat `Object.entries(where).every(...)` loop, no field-name validation (silently matches nothing on an unknown field instead of erroring)                                                                                                     | ADAPTER DIVERGENCE vs. D1/libSQL, which throw                                              |
| `libsql.adapter.ts` `buildWhereCondition`                 | Flat `and(...)` of per-field drizzle conditions; single-field `orderBy`; `assertValidColumn` throws a bare `Error`, not a `ForgeError`                                                                                                        | MISSING CAPABILITY + HTTP GAP (leaks as 500)                                               |
| `cloudflare/d1.adapter.ts` `buildWhereClause`             | Same shape as libSQL, hand-built parameterized SQL, single-field `ORDER BY`; same bare-`Error` leak                                                                                                                                           | MISSING CAPABILITY + HTTP GAP                                                              |
| `runtime/access.ts` `mergeWhere`                          | `{ ...base, ...constraint }` — shallow key overwrite. Two flat wheres sharing a field key silently drop one side; nothing stops a future flat-merge bug from letting a user key clobber an access key with the same name once nesting exists. | RUNTIME BUG (latent, security-adjacent) — must become nesting-safe before `and`/`or` ships |
| `runtime/operations.ts` `prepareReadQuery`                | Already the single call site shared by `find`/`count` (good) — the right place to centralize new validation, no separate filter pipeline exists to drift                                                                                      | NO CHANGE NEEDED (structure); ADD validation here                                          |
| `runtime/operations.ts`                                   | No `findOne`                                                                                                                                                                                                                                  | MISSING CAPABILITY                                                                         |
| `runtime/handlers.ts` `parseWhere`/`parseSort`            | Flat `field`/`field[op]` params only; `SYSTEM_SORT_FIELDS` omits `_status` even on `drafts: true` collections                                                                                                                                 | HTTP GAP + TEST GAP                                                                        |
| `runtime/typed-api.ts` `TypedWhere`/`TypedFindArgs.sort`  | Flat `Partial<Record<field, WhereCondition>>`; `sort` is a single typed field name                                                                                                                                                            | TYPE GAP                                                                                   |
| `angular/query.ts` `QueryOptions`                         | `where` is an untyped flat `Record<string, unknown>`; `sort` is a single string                                                                                                                                                               | CLIENT GAP                                                                                 |
| `angular/api.service.ts`                                  | No `findOne`                                                                                                                                                                                                                                  | CLIENT GAP (deferred pending HTTP decision — resolved below: implement via `limit: 1`)     |
| `testing/contracts/database.ts`                           | Contract suite covers flat operators + single-field sort only, on an ad hoc `articles` collection created per-test                                                                                                                            | TEST GAP                                                                                   |
| `cloudflare/d1.adapter.test.ts` `MockD1PreparedStatement` | Hand-rolled WHERE parser splits only on literal `' AND '`, no parens/OR support                                                                                                                                                               | TEST GAP — must be extended or D1 gets zero real coverage of the new SQL shape             |
| relation-array membership                                 | `relation({ many: true })` stores `JSON.stringify(id[])` in a TEXT column (`schema-generator.ts`); no operator can test membership                                                                                                            | MISSING CAPABILITY — see Design §6 for the go/no-go decision                               |
| `core/identifiers.ts`                                     | Field/collection identifiers already validated against a pattern + a system-field set; no existing collection can legally have a field literally named `and` or `or` (the identifier pattern allows it, but nothing currently reserves it)    | ADAPTER DIVERGENCE risk — must reserve `and`/`or` as query keys                            |

## Design

### 1. `DatabaseWhere` gains nested groups (`@forge-cms/db`)

```ts
export type WhereOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'contains'
  | 'containsValue';

export interface WhereValue {
  eq?: unknown;
  ne?: unknown;
  gt?: unknown;
  gte?: unknown;
  lt?: unknown;
  lte?: unknown;
  in?: unknown[];
  contains?: string;
  /** Exact-element membership against a JSON array column (relation({ many: true })). */
  containsValue?: unknown;
}

export type WhereCondition = unknown | WhereValue;
export type WhereFields = Record<string, WhereCondition>;
export interface WhereAndGroup {
  and: DatabaseWhere[];
}
export interface WhereOrGroup {
  or: DatabaseWhere[];
}
export type DatabaseWhere = WhereFields | WhereAndGroup | WhereOrGroup;

export function isWhereAndGroup(w: DatabaseWhere): w is WhereAndGroup;
export function isWhereOrGroup(w: DatabaseWhere): w is WhereOrGroup;
export function isWhereGroup(w: DatabaseWhere): w is WhereAndGroup | WhereOrGroup;
export function matchesWhere(
  record: Record<string, unknown>,
  where: DatabaseWhere | undefined
): boolean;
```

`matchesWhere` is the pure recursive reference implementation (brief §14). Its actual evaluation
strategy: iterate every key in the `where` object and AND the results together, whatever each key
means — `and` → `.every` over its children, `or` → `.some` over its children, any other key → today's
`matchesCondition` against that field. This — not a first-match "is this a group, else is it flat"
branch — is what lets `and`/`or` sit alongside ordinary flat keys in the _same_ object
(`{ status: 'published', or: [...] }` means `status = 'published' AND (...)`) without one silently
winning and the other being ignored; every adapter's SQL builder mirrors the same "iterate every key,
AND the parts" strategy for the same reason. `InMemoryDatabaseAdapter` calls `matchesWhere` directly, so
it stays the executable semantic reference. An empty `or: []` has no disjunct that can be true, so it
evaluates to `false` (the standard empty-disjunction identity) — the same thing a legitimately
zero-branch access-rule constraint means (`{ or: user.tenants.map(...) }` for a tenant-less user); an
empty `and: []` has no conjunct that can be false, so it evaluates to `true`. `and`/`or` are reserved
top-level keys — a flat `WhereFields` object with a key literally named `and` or `or` is parsed as a
group key, not a field filter. This is only reachable if a collection defines a field named `and`/`or`;
`validateCollectionIdentifiers` (core) gains those two names to its reserved set so this can never
happen for a real field, matching the existing `_status`/`_storageKey` system-field reservation
pattern.

`WhereCondition`/`WhereValue` unchanged otherwise — existing `eq`/`ne`/`gt`/`gte`/`lt`/`lte`/`in`/
`contains` keep exact current semantics (brief §3).

### 2. Multi-field sort (`@forge-cms/db`)

```ts
export interface SortField {
  field: string;
  order?: 'asc' | 'desc';
}
export type SortInput = string | SortField[];
```

`FindManyOptions.sort?: SortInput` (was `string`); `order?: 'asc' | 'desc'` stays and is only meaningful
when `sort` is a plain string (brief §6 backward compatibility). Tie-break: stable — array order and SQL
`ORDER BY` both preserve insertion/row order for equal keys; `InMemoryDatabaseAdapter`'s sort uses a
stable comparator over all `SortField`s in order (first field decides, ties fall through to the next),
matching what `ORDER BY a, b` does in SQL.

### 3. `mergeWhere` becomes nesting, not shallow-merge (`@forge-cms/runtime/access.ts`)

```ts
export function mergeWhere(
  base: DatabaseWhere | undefined,
  constraint: DatabaseWhere | undefined
): DatabaseWhere | undefined {
  if (isEmptyWhere(constraint)) return base;
  if (isEmptyWhere(base)) return constraint;
  return { and: [constraint, base] };
}
```

This is the brief §9 requirement made structural: `checkAccess`'s constraint always becomes the first
`and` branch, the caller's `where` (however deeply nested, however many `or`s inside it) becomes the
second — so a consumer `or` can never escape the access constraint, because it is never at the top
level. `documentMatches` (used by `update`/`delete`, which address a document by id and can't push a
constraint into a query) switches from its flat per-key loop to `matchesWhere`. Same fix, same file,
also used for the `_status` draft constraint merge — that call site is unchanged, it already goes
through `mergeWhere`.

### 4. Centralized query validation (`@forge-cms/runtime/query-validation.ts`, new file)

```ts
export function validateWhere(
  collection: CollectionDefinition,
  where: DatabaseWhere | undefined,
  opts?: { maxDepth?: number }
): void;
export function validateSort(collection: CollectionDefinition, sort: SortInput | undefined): void;
```

Recursively checks every leaf field name against `collection.fields` plus system fields (`id`,
`created_at`, `updated_at`, and `_status` iff `collection.drafts === true` — closing the brief §7 gap),
checks every operator name is known, rejects `containsValue` on any field whose `kind !== 'relation'`,
rejects empty `and: []` / `or: []` (brief §15 "prefer rejecting" — `InvalidQueryError`), and caps
recursion at `maxDepth` (default 6) against pathological/attacker-supplied JSON. Throws
`UnknownFieldError` for a bad field name, `InvalidQueryError` for everything else — both already exist
in `errors.ts` (were defined, apparently for future use, and are wired into `handlers.ts`'s HTTP-level
flat parsing today but never reused at the Local API level, which is exactly the gap this closes).

Called once, in `operations.ts`'s existing shared `prepareReadQuery` (used by `find`/`count`/the new
`findOne` — brief §8 parity falls out for free because there is exactly one call site) against the
**caller-supplied** `args.where`/`args.sort`, before it is merged with the access constraint or the
draft-status constraint. `handlers.ts`'s existing flat `field`/`field[op]` parsing is unchanged and
still does its own coercion (string → number/boolean per field kind) — deep validation is not
duplicated there; an invalid parsed `where` now fails once, in `operations.ts`, as a typed `ForgeError`
that `toErrorResponse` already maps to 400. This removes the one place adapter-level
`assertValidColumn`'s bare `Error` could otherwise leak to a 500: valid queries never reach the adapter
with an unknown field, because they were already rejected upstream.

**"Checks every operator name is known" precisely means:** a condition object's keys must not contain
one _unrecognized_ key mixed with a _recognized_ one (`{ eq: 'a', contians: 'x' }` — almost certainly a
typo). An object where **no** key looks like an operator at all is left alone and reaches the adapter
as a bare equality value — the pre-existing, intentional way to filter a `json`-typed field against a
literal object (`where: { metadata: { source: 'x' } }`). Validating naively against
`toOperatorValues`'s _output_ cannot see this distinction: that function already silently downgrades
any non-conforming object to a bare `eq` value before an operator-name check would ever run, so
`validateWhere` inspects the raw condition object's keys directly instead.

**The "not re-validated" access/draft constraint needed one more hardening pass**, found by review
after the first implementation: `resolveAccess`'s constraint is a real runtime value that can
legitimately be `{ or: [] }` (e.g. `{ or: user.tenants.map(...) }` for a user in zero tenants — "no
branch can be true", i.e. deny-all), and because it bypasses `validateWhere` entirely, the _adapters
themselves_ must interpret an empty group correctly rather than relying on validation to have already
rejected it. The first cut of the SQL adapters compiled an empty `or` to "contribute no condition"
(same as "no filter at all"), which is `matchesWhere`-incompatible and a real security hole on
production (D1/libSQL) while behaving safely by accident on InMemory. Fixed by making every adapter
(and `matchesWhere`) implement the standard empty-disjunction/-conjunction identities — an empty `or`
compiles to a constant-false condition (`sql`0``on libSQL, the literal`0`in D1's generated SQL,`.some()`over`[]`in`matchesWhere`), an empty `and`contributes no condition (equivalent to
constant-true), matching §1's`matchesWhere`design above.
Relatedly,`matchesWhere`and both SQL builders were also hardened to evaluate **every key in a where
object**, not just`and`/`or`xor flat keys exclusively —`{ status: 'published', or: [...] }`now
correctly ANDs the flat`status`condition with the`or`group instead of the flat key being silently
dropped (the group branch used to win exclusively). This matters for the exact same reason: an access
rule or a`beforeRead`hook naturally writes`{ tenantId: x, or: [...] }`-shaped constraints.

### 5. `findOne` (brief §4/§5)

```ts
export interface FindOneArgs extends BaseOperationArgs {
  where?: DatabaseWhere;
  sort?: SortInput;
  order?: 'asc' | 'desc';
  status?: DraftStatus | 'all';
}
export async function findOne(
  ctx: OperationContext,
  args: FindOneArgs
): Promise<DatabaseRecord | null>;
```

Shares `prepareReadQuery`/`prepareForRead` with `find` (same access/hooks/drafts/locale/relation-populate
pipeline — no second read pipeline). Unlike `find`, it does **not** call `adapters.database.count()` —
brief §21 requires a real `LIMIT 1`, not "fetch everything and take the first", and `findOne` has no
pagination metadata to compute, so the extra `count` query would be pure waste. `runtime.ts` exposes it
both untyped and typed (`TypedFindOneArgs` in `typed-api.ts`, mirroring `TypedFindByIDArgs` but with a
`TypedWhere`/typed-`sort` shape reused from the now-nested `TypedWhere`), returning
`CollectionDocument<...> | null`.

### 6. Relation-array membership — decision: **implement**, via `containsValue`

SQLite's `json_each` table-valued function has been part of core SQLite (not a loadable extension) since
3.38 (2022); both `LibSqlDatabaseAdapter` (real `@libsql/client`, itself a SQLite fork well past that
version — the package's own test suite already runs it against a real `file::memory:` database) and
Cloudflare D1 (SQLite-compatible by construction) support it as a baseline capability, not a
runtime-specific extension. `containsValue` is only accepted (brief §11 "keep JSON querying narrow") on
fields with `kind === 'relation'`, checked by `validateWhere` above — not general JSON arrays.

- **InMemory**: `Array.isArray(recordValue) && recordValue.some((v) => v === value)`, in `matchesOperator`.
- **libSQL**: `` sql`EXISTS (SELECT 1 FROM json_each(${column}) WHERE value = ${value})` `` via drizzle's
  `sql` template (parameterized). No explicit `IS NOT NULL` guard needed: `json_each(NULL)` yields zero
  rows in SQLite, so `EXISTS (...)` is already `false` for a null column.
- **D1**: `EXISTS (SELECT 1 FROM json_each("field") WHERE value = ?)`, bound value, same
  parameterization discipline as every other operator in `buildWhereExpression`.

Caveat carried into STATE.md: this is exercised in CI against a real SQLite engine for libSQL, but D1's
copy only runs against `cloudflare/d1.adapter.test.ts`'s hand-rolled mock (per CONVENTIONS.md, "no
miniflare in unit tests" is the existing, pre-this-branch policy for that package) — extended in this
branch to parse `EXISTS (SELECT ... FROM json_each(...))` and nested parenthesized `AND`/`OR`, but it is
still a mock, not real D1. Flagged as a follow-up smoke test against a real D1 binding, not blocking.

### 7. HTTP transport (brief §16)

Flat `field=value` / `field[op]=value` / `sort=field&order=asc` query params are unchanged byte-for-byte.
Two additions, both opt-in and additive:

- `?where=<url-encoded JSON>` — a new reserved query param. Parsed with `JSON.parse` (wrapped;
  malformed JSON → `InvalidQueryError`, 400), capped at 4096 characters before parsing (oversized →
  `InvalidQueryError`), required to be a plain object (`InvalidQueryError` otherwise). When present it
  **replaces** flat filter parsing entirely for that request (no merge-by-key ambiguity between the two
  transports). Deep field/operator validation happens once downstream in `operations.ts` (§4 above) —
  `handlers.ts` only does the JSON/shape/size checks.
- `sort=<url-encoded JSON array>` — detected by sniffing whether the decoded string starts with `[`; if
  so, `JSON.parse`d and passed through as `SortField[]` (validated downstream the same way); otherwise
  the existing single-field-name path (with `order`) is unchanged. No second query param needed.

### 8. Angular client (brief §17/§18)

```ts
// packages/angular/src/query.ts
export interface QueryOptions {
  where?: DatabaseWhere; // was Record<string, unknown> — now the real nested type
  sort?: string | SortField[]; // was string
  order?: 'asc' | 'desc';
  // ...unchanged: limit, offset, page, depth, status, locale
}
```

`buildQueryString` grows one branch: if `where` contains a top-level `and`/`or` key (i.e. is a
`WhereGroup`), serialize it as `?where=<json>`; otherwise keep serializing it field-by-field exactly as
today (byte-identical URLs for every existing caller — brief §22). Same sniff for `sort` as an array vs.
a string. **The `sort` param must stay in its original insertion position** (before `order`/`depth`/
`status`/`locale`/`limit`), since `URLSearchParams.toString()` preserves insertion order and
"byte-identical" means exactly that — the parameter set alone is not enough; a review caught an
implementation draft that moved `sort` later in the function and changed the emitted string for every
existing sort-using caller even though the parsed _meaning_ was unchanged. This is the "one shared
helper" the brief asks for — `getDocuments`/`listDocuments`/`collectionResource`/`documentResource` all
already funnel through `buildQueryString`, so none of them need their own changes.

`CmsApiService.findOne<T>(collection, where, options?)` — thin wrapper: calls
`listDocuments(collection, { ...options, where, limit: 1 })` and returns `docs[0] ?? null`. No new server
route (brief §18's stated preference), since `limit=1` already round-trips through the existing list
endpoint.

### 9. Typed Local API (brief §5/§19)

```ts
export type TypedWhere<TCollection extends CollectionDefinition> =
  | Partial<Record<TypedSortField<TCollection>, WhereCondition>>
  | { and: TypedWhere<TCollection>[] }
  | { or: TypedWhere<TCollection>[] };

export type TypedSortInput<TCollection extends CollectionDefinition> =
  | TypedSortField<TCollection>
  | { field: TypedSortField<TCollection>; order?: 'asc' | 'desc' }[];
```

`TypedFindArgs.sort`/`TypedFindOneArgs.sort` use `TypedSortInput`. Runtime validation (`query-validation.ts`)
remains authoritative — this is compile-time convenience only, per brief §19's explicit instruction not
to build a metaprogramming project.

## Implementation plan

- [x] `packages/db/src/where.ts` — `WhereAndGroup`/`WhereOrGroup`/`DatabaseWhere` union, `containsValue`
      operator, `matchesWhere`, `isWhereGroup` family
- [x] `packages/db/src/index.ts` — `SortField`/`SortInput` exports, `FindManyOptions.sort: SortInput`
- [x] `packages/core/src/identifiers.ts` — reserve `and`/`or` as field names (system-field-style rejection)
- [x] `packages/db/src/in-memory.adapter.ts` — `matchesWhere` + multi-field stable sort
- [x] `packages/db/src/libsql.adapter.ts` — recursive `and`/`or` → drizzle `and(...)`/`or(...)`,
      `containsValue` via `sql` template + `json_each`, multi-field `orderBy`
- [x] `packages/cloudflare/src/d1.adapter.ts` — recursive parenthesized SQL builder, `containsValue` via
      `EXISTS (SELECT 1 FROM json_each(...))`, multi-field `ORDER BY`
- [x] `packages/cloudflare/src/d1.adapter.test.ts` — extend `MockD1PreparedStatement`'s WHERE parser for
      nested parens/`AND`/`OR` and `EXISTS (... json_each ...)`
- [x] `packages/testing/src/contracts/database.ts` — shared `articles` query dataset + nested AND/OR,
      multi-field sort, empty-group, invalid-structure cases, run identically against all three adapters
- [x] `packages/runtime/src/access.ts` — `mergeWhere` nesting rewrite, `documentMatches` via `matchesWhere`
- [x] `packages/runtime/src/query-validation.ts` (new) — `validateWhere`/`validateSort`
- [x] `packages/runtime/src/operations.ts` — wire validation into `prepareReadQuery`; add `findOne`
- [x] `packages/runtime/src/typed-api.ts` — `TypedWhere` nested, `TypedSortInput`, `TypedFindOneArgs`
- [x] `packages/runtime/src/runtime.ts` — expose `findOne` (typed + untyped)
- [x] `packages/runtime/src/handlers.ts` — `?where=<json>` + JSON-array `sort=`, `_status` sortable
- [x] `packages/angular/src/query.ts` — nested `where`/multi-field `sort` types + serialization
- [x] `packages/angular/src/api.service.ts` — `findOne`
- [x] Regression/security tests: nested `or` cannot escape an access `where` constraint (operations.ts);
      an access constraint resolving to `{ or: [] }` denies all identically on InMemory _and_ real
      libSQL (a genuine bug caught by review — see Design §4/§1); a where mixing a flat key with `and`/
      `or` ANDs correctly instead of dropping the flat key; an operator-name typo mixed with a valid
      operator is rejected while a bare-object equality value (JSON-field comparison) is still allowed;
      a malformed sort entry (`[null]`) is a 400, not a crash; empty-`and`/`or` and mixed-key parity
      added to `runDatabaseAdapterQueryContractTests` (proven on InMemory, real libSQL, and the D1 mock);
      `and`/`or` field-name reservation covered in `packages/core/src/identifiers.test.ts` (new)
- [x] Docs: `apps/www/src/content/docs/local-api.md`, `rest-api.md`, `angular-client.md`
- [x] `docs/ROADMAP.md` (026 → done), `docs/STATE.md`, changeset(s)
- [x] Full verification gates

## Test plan

- `packages/db/src/where.test.ts` (new) — `matchesWhere` recursive semantics, `containsValue`.
- Extended `packages/testing/src/contracts/database.ts`, run from `in-memory`, `libsql.adapter.test.ts`,
  `cloudflare/d1.adapter.test.ts` — same nested-boolean/multi-sort/empty-group/invalid-structure cases,
  identical expected results.
- `packages/runtime/src/operations.test.ts` — `findOne` (found/not-found/uses same access+hooks path),
  nested `and`/`or` through `find`/`count` parity, access-constraint-cannot-be-escaped-by-`or` security
  case, `_status` sortable on a drafts collection, unknown-field/invalid-structure → `ForgeError` not a
  leaked adapter `Error`.
- `packages/runtime/src/handlers.test.ts` — `?where=` happy path, oversized/malformed → 400, `sort=`
  JSON-array happy path, existing flat-param tests unchanged (regression).
- `packages/angular/src/query.test.ts` — nested `where`/array `sort` serialize to `?where=`/JSON `sort=`;
  existing flat cases produce byte-identical URLs (regression).
- Manual: none required (no UI surface changes).

## Acceptance criteria

Written out explicitly here (a prior revision only referenced an external, unversioned brief — not
reviewable on its own; this replaces that reference with the actual checklist):

1. Existing flat queries (`where: { status: 'published' }`) remain backwards compatible.
2. Nested `and`/`or` queries work, and compose with a sibling flat key at the same level (no key is
   silently dropped).
3. Nested queries have identical observable behavior in InMemory, libSQL, and D1 — including the
   degenerate cases (`and: []`, `or: []`, `and`/`or` mixed with flat keys).
4. `findOne()` exists on the Local API and returns a typed document or `null`.
5. `findOne()` uses the normal read/access/hook pipeline, with a real database-side `LIMIT 1` (no
   `count()` call).
6. `count()` shares the same nested filter semantics as `find()` (one shared `prepareReadQuery`).
7. Multi-field sort works consistently across adapters, stable tie-break.
8. Access-rule constraints remain securely AND-composed with consumer queries — a consumer `or` can
   never escape a constraint, and a constraint that resolves to `{ or: [] }` (a legitimate "no
   matches" access decision, not malformed input) denies all rather than silently becoming "no filter"
   on a SQL adapter.
9. Invalid nested queries fail deterministically: unknown field, unknown operator (including an
   operator name mixed with a valid one, e.g. a typo), malformed `and`/`or` shape, `containsValue` on
   a non-relation field, and a malformed sort entry are all a stable `ForgeError` (400), never an
   uncaught exception surfacing as 500.
10. HTTP query transport (`?where=<json>`, JSON-array `sort=`) supports the new model safely; existing
    flat query strings are unchanged, byte-for-byte, for every existing caller (both the raw HTTP query
    string and `@forge-cms/angular`'s `buildQueryString` output).
11. Angular `QueryOptions` can express the supported query capabilities without raw fetch workarounds.
12. Typed Local API rejects obvious invalid collection fields/sorts where practical (`TypedWhere`,
    `TypedSortInput`).
13. Relation-array membership (`containsValue`) is implemented correctly across all three adapters,
    proven by the shared contract suite, not just deferred.
14. Shared adapter contract tests (`runDatabaseAdapterQueryContractTests`) cover query parity,
    including empty groups and mixed and/or-plus-flat-key structure, not only the "happy path" nested
    cases.
15. No SQL/adapter internals leak through public errors.
16. Existing runtime/client/admin behavior remains green (`pnpm test`, `pnpm build`, `pnpm e2e:www`,
    `pnpm release:verify`).
17. `docs/STATE.md`/`docs/ROADMAP.md`/`docs/DEMO-FINDINGS.md` accurately reflect the completed work,
    including named caveats (D1's `containsValue` only proven against a mock, not live D1).
18. No unrelated feature expansion was introduced (see Non-goals).

`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build` green, plus the full
adapter contract suite (InMemory/libSQL/D1-mock), `pnpm release:verify`, and Playwright e2e for
`apps/www`.

## Open questions

None — the brief resolved every open design question (relation-array: implement via `containsValue`;
HTTP transport: `?where=<json>`; `findOne` client: `limit: 1` over the existing endpoint).

## Outcome

Shipped, but **not** on the first pass — an independent `forge-rules-reviewer` + `spec-reviewer` pass
over the diff found four real defects before merge, three of them security- or correctness-relevant,
one a leftover debug file that broke two of the five verification gates. All four were fixed and
re-verified; this section records both the original design and what review actually caught, since the
first draft of this Outcome claimed "no divergence from the plan," which was false.

**What review found and what changed:**

1. **Security bug (most severe):** an access-rule constraint that legitimately resolves to `{ or: [] }`
   (a natural multi-tenant pattern — `{ or: user.tenants.map(...) }` for a user in zero tenants, meaning
   "no branch can ever be true") bypasses `validateWhere` entirely (it only checks caller-supplied
   `where`, not the trusted access constraint `mergeWhere` merges in). The first-cut `libsql.adapter.ts`/
   `d1.adapter.ts` compiled an empty `or` group to "contribute no SQL condition" — i.e. no filter at
   all — so on the only production adapter (D1) and on libSQL, this returned _every row in the table_
   instead of none, while `matchesWhere` (InMemory) correctly returned zero rows. **Fixed** by making
   every adapter compile an empty `or` to a constant-false condition (`sql`0``/ literal`0`), matching
the standard empty-disjunction identity `matchesWhere` already used — see Design §1/§4/§6. Covered by
a new regression test run against both InMemory and a real libSQL database
(`operations.test.ts`, "an access rule that legitimately resolves to `{ or: [] }` denies all").
2. **Data-loss bug:** a `where` object mixing a flat key with `and`/`or` at the same level
   (`{ status: 'published', or: [...] }` — a natural shape for an access rule or a `beforeRead` hook to
   construct) silently dropped the flat key everywhere (`matchesWhere`, both SQL builders,
   `validateWhere`), because the original design branched exclusively into "is this a group" vs. "is
   this flat" instead of evaluating every key. **Fixed** by rewriting all four to iterate every key and
   AND the results, so `and`/`or` compose with sibling flat keys instead of one silently winning.
3. **Validation bug:** `validateWhere`'s "checks every operator name is known" claim was not actually
   true — it validated post-`toOperatorValues` output, and that function already silently downgrades any
   condition object with an unrecognized key to a bare `eq`-against-the-whole-object comparison, so a
   typo like `{ eq: 'a', contians: 'x' }` never reached the operator-name check and silently matched
   nothing instead of 400ing. **Fixed** by validating the raw condition object's keys directly, while
   deliberately preserving the case that fallback exists for: an object where _no_ key looks like an
   operator (e.g. filtering a `json` field by literal value) is still accepted as a bare value, not
   rejected — see Design §4 for the exact distinction.
4. **Regression:** `@forge-cms/angular`'s `buildQueryString` moved the `sort` param's `.set()` call to a
   different position while adding multi-field-sort support, which changed the emitted query string's
   byte order for every existing sort-using caller (`URLSearchParams` preserves insertion order) even
   though the spec's own explicit promise was "byte-identical URLs for every existing caller." **Fixed**
   by restoring `sort`'s original position.
5. Minor: a scratch investigation file (`packages/db/src/__parity_probe.test.ts`) used to find bug #1
   was left in the tree, untracked, unformatted, and failing — deleted; a `?sort=[null]` HTTP request
   crashed into an uncaught `TypeError` (500) instead of a 400 — `validateSort` now guards each entry's
   shape before destructuring; `containsValue` is now also accepted as a flat `field[containsValue]=`
   HTTP operator (it wasn't, contradicting what the REST docs already said) rather than requiring
   `?where=`; the acceptance criteria section (originally "mirrors an 18-point brief verbatim," but the
   brief isn't a file in this repo, so that wasn't independently reviewable) is now written out
   explicitly in this spec.

**Otherwise as designed:** nested `and`/`or`, multi-field sort, `findOne`, and relation-array
`containsValue` are identical across InMemory, real libSQL, and D1 (extended mock) — including the
degenerate empty-group and mixed-key cases above, now covered by
`runDatabaseAdapterQueryContractTests`. `count`/`find`/`findOne` parity, the HTTP transport, the Angular
client, and the typed Local API all match the Design section. Full gates green
(`format:check`/`lint`/`typecheck`/`test`/`build`), `scripts/verify-release.mjs`'s packed-artifact
consumer checks (extended with spec-050 assertions), and a full Playwright e2e pass for `apps/www`
(unaffected — no UI surface changed) — all re-run after the fixes above, not just before them. One
caveat carried into STATE.md: `containsValue`'s `json_each` SQL is proven against real SQLite for
libSQL but only against a (now much more capable) hand-rolled mock for D1 — not smoke-tested against a
live D1 binding from this environment. `DEMO-FINDINGS.md` finding 10 is closed at the package level;
`apps/demo-aesthetics`'s route file was deliberately left on its old workaround (out of scope for this
branch) and is noted as a follow-up.
