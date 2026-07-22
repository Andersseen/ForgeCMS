# 019 — Add a Local API and make the HTTP handlers a thin layer over it

- **Status:** done
- **Author:** agent draft
- **Date:** 2026-07-22
- **Branch:** main
- **Affected packages/apps:** @forge-cms/runtime, apps/www

## Context / Why

Every CMS operation lived inside `handlers.ts` as a `(Request) => Response` function. Using ForgeCMS
from server code — an Analog.js `.server.ts` route, a Nitro handler, a seed script — meant
**fabricating a `Request` object** and parsing a `Response` back, for a call that never leaves the
process.

That matters more here than it would elsewhere. ForgeCMS's reason to exist is being the CMS whose
native consumption model is Angular/Analog. If you cannot write
`const posts = await cms.find({ collection: 'posts' })` in a server route, there is no advantage over
calling any other headless CMS over HTTP. This is the moat, and it was missing.

It is also a prerequisite: specs 020–022 all extend the operation pipeline, and extending it while it
is smeared across five HTTP handlers means writing every test through a fake `Request`.

## Goal

`ForgeCmsRuntime` exposes `find`/`findByID`/`create`/`update`/`delete`/`count`, running the full
pipeline with no HTTP involved; the HTTP handlers parse, delegate, and map errors.

## Non-goals

- Type-safe per-collection returns (`find<'posts'>` inferring `Post[]`). Returns stay
  `DatabaseRecord`. Wiring `CollectionData<T>` through is roadmap item 038.
- A Nitro/Analog integration package (roadmap item 037).
- Transactions or batching.

## Design

### `ForgeCmsRuntime` methods

```ts
find(args: FindArgs): Promise<PaginatedDocs>;
findByID(args: FindByIDArgs): Promise<DatabaseRecord>;   // throws NotFoundError
count(args: CountArgs): Promise<number>;
create(args: CreateArgs): Promise<DatabaseRecord>;
update(args: UpdateArgs): Promise<DatabaseRecord>;
delete(args: DeleteArgs): Promise<DatabaseRecord>;       // returns the deleted document
```

```ts
interface BaseOperationArgs {
  collection: string;
  user?: CmsUser | null;
  overrideAccess?: boolean; // defaults to TRUE
  depth?: 0 | 1;
}

interface PaginatedDocs<TDoc = DatabaseRecord> {
  docs: TDoc[];
  totalDocs: number; // ignores limit/offset
  limit: number | undefined;
  offset: number;
  page: number; // 1-based
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}
```

**`overrideAccess` defaults to `true`.** A direct Local API call comes from trusted server code that
has already decided it is allowed to do this; requiring every seed script to opt out of access
control would be noise. The HTTP layer always passes `overrideAccess: false` plus the resolved user,
so nothing reachable from the network is unchecked.

### Typed errors

`errors.ts` exports `ForgeError` (carrying `status`) and `NotFoundError` (404), `InvalidInputError`
(400), `ValidationFailedError` (400, with `details`), `UnauthorizedError` (401),
`AccessDeniedError` (403). Operations throw; the HTTP layer maps. An `AccessDeniedError` raised with
no authenticated user is reported as **401**, not 403 — the caller did not fail a permission check so
much as present no credentials.

### Avoiding an import cycle

`operations.ts` and `populate.ts` need `adapters` and `getCollection`, but `runtime.ts` imports them.
They therefore depend on a structural `OperationContext` interface (`context.ts`) that
`ForgeCmsRuntime` satisfies, rather than importing the class — `import/no-cycle` is an error in this
repo.

### HTTP layer

`handlers.ts` keeps only transport concerns: query-string parsing (`where`, `sort`, `order`, `depth`,
`status`, `limit`, `offset`), multipart upload handling, the auth gate, the JSON envelope, and error
mapping. The envelope is unchanged; `meta` gains the pagination fields from spec 018.

### Behaviour changes

- `DELETE` of a document that does not exist now returns **404** instead of 204. The document has to
  be loaded anyway to evaluate row-level access (spec 020) and run `beforeDelete` (spec 021).
- A throwing `beforeChange` hook still produces 400: `runRejectableStage` converts a plain `Error`
  from a before-hook into `InvalidInputError`, preserving spec 013's contract.

## Implementation plan

- [x] `errors.ts`, `context.ts`
- [x] `operations.ts` — the six operations and the shared read/write pipelines
- [x] `ForgeCmsRuntime` delegating methods
- [x] Rewrite `handlers.ts` as transport-only
- [x] `describe.ts` + thin `/api/v1/collections` route
- [x] Tests; changeset

## Test plan

- `operations.test.ts` — pagination across pages, CRUD without HTTP, `overrideAccess` semantics,
  typed errors, partial-update validation.
- The 62 pre-existing `handlers.test.ts` cases must pass **unmodified** — that is the evidence the
  refactor preserved HTTP behaviour.

## Acceptance criteria

1. ✅ All six methods exist on `ForgeCmsRuntime` and run hooks/access/drafts/populate.
2. ✅ `handlers.ts` contains no business logic beyond parsing and mapping.
3. ✅ `handlers.test.ts` passes unchanged.
4. ✅ No import cycle.
5. ✅ `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.

## Outcome

Shipped 2026-07-22. All 62 handler tests passed without modification. `apps/www` seeds its
`landing_pages` collection through `runtime.create` — the first real Local API consumer in the repo.
