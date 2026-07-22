# 020 — Access control as functions returning boolean or a query constraint

- **Status:** done
- **Author:** agent draft
- **Date:** 2026-07-22
- **Branch:** main
- **Affected packages/apps:** @forge-cms/core, @forge-cms/runtime

## Context / Why

Spec 010/013 modelled access as `string[]` of role names. That expresses "admins may delete" and
nothing else. It cannot express the rule every real CMS deployment needs within a week:

> an author may edit **their own** posts, but not anyone else's

Row-level rules are not a niche feature — ownership, per-tenant isolation and per-team drafts are all
the same shape, and none of them fit a role list.

## Goal

An access rule can be a function that returns `true`, `false`, or a **query constraint** naming the
documents the operation may touch.

## Non-goals

- Multi-tenancy as a subsystem. A `Where`-returning rule already expresses it.
- Access rules on relationship traversal (`depth=1` populates without re-checking the target
  collection's rules).
- A UI for authoring rules.

## Design

```ts
type AccessQuery = Record<string, unknown>; // structurally a DatabaseWhere
type AccessResult = boolean | AccessQuery;

interface AccessArgs {
  user: CmsUser | null;
  operation: 'read' | 'create' | 'update' | 'delete';
  collection: CollectionDefinition;
  id?: string; // read-one, update, delete
  data?: Record<string, unknown>; // create, update
  doc?: Record<string, unknown>; // update, delete — the stored document
}

type AccessFn = (args: AccessArgs) => MaybePromise<AccessResult>;
type AccessRule = string[] | AccessFn; // string[] keeps its spec-010 meaning
```

`CollectionAccess.{read,create,update,delete}` and `FieldAccess.{read,write}` both accept the union,
so **every existing role-array config keeps working unchanged**.

`AccessQuery` is declared in `@forge-cms/core` rather than imported from `@forge-cms/db` because db
depends on core; the two types are structurally identical (`Record<string, unknown>`). `CmsUser` is
declared in core for the same reason and is structurally identical to `@forge-cms/auth`'s `AuthUser`.

### How a returned constraint is applied

| Operation         | Application                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| `find`/`count`    | AND-merged into the query. The **total respects it too**, or the paginator lies.                                   |
| `findByID`        | Checked against the loaded document; a miss **404s, not 403s** — a 403 would confirm the id exists.                |
| `update`/`delete` | Checked against the loaded document; a miss is **403** (the caller already proved the id exists by addressing it). |

### Field access

`FieldAccessFn` receives `{ user, operation, collection, fieldName, doc?, data? }` and returns a
boolean. Resolution is now async, so `filterReadableFields` and `assertWritableFields` return
promises — a breaking change to those two exported helpers.

## Implementation plan

- [x] Core types: `CmsUser`, `AccessQuery`, `AccessArgs`, `AccessResult`, `AccessFn`, `AccessRule`
- [x] `access.ts`: `resolveAccess`, `resolveFieldAccess`, `mergeWhere`, `documentMatches`
- [x] Wire into every operation in `operations.ts`
- [x] Make `field-access.ts` async and rule-aware
- [x] Tests; changeset

## Test plan

`operations.test.ts` — an `owned` collection whose `update`/`delete` return `{ ownerId: user.id }`:
author edits own ✅, author edits another's ❌, admin passes ✅. A `scoped` collection whose `read`
returns a constraint: the listing filters **and** `totalDocs` reflects the constraint; a single read
of an unreachable id 404s. Plus a case proving role arrays still work.

## Acceptance criteria

1. ✅ A rule may be `string[]` or a function; role arrays behave exactly as before.
2. ✅ A returned constraint filters lists and their totals.
3. ✅ An unreachable single read 404s rather than 403s.
4. ✅ Field rules accept predicates.
5. ✅ `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.

## Outcome

Shipped 2026-07-22. Ownership rules are now expressible. **Breaking:** `filterReadableFields` and
`assertWritableFields` are async and take a `CmsUser | null` instead of a role string.
