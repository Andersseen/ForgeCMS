# 041 — Give the Angular client a real query API

- **Status:** in-progress
- **Author:** agent draft (approved by the maintainer: "implement them now")
- **Date:** 2026-07-27
- **Branch:** `feature/demo-aesthetics-app`
- **Affected packages:** `@forge-cms/angular`

## Context / Why

[DEMO-FINDINGS.md](../DEMO-FINDINGS.md) finding 15: `CmsApiService.getDocuments(collection)` takes no
arguments beyond the slug. The HTTP API has supported `where`/`sort`/`order`/`limit`/`offset`/`depth`/
`status` since specs 011/012/017, and pagination metadata since 018 — the client exposes none of it.
It also sends **no `Authorization` header on reads**, so a signed-in editor is anonymous to every
`GET`, which is the real reason the admin cannot see drafts (finding 17) and why field-level read
access always resolves as "not logged in".

The demo therefore built two replacement services with raw `fetch` and hand-rolled loading state in
seven pages. This is the package that is supposed to be the reason to choose ForgeCMS.

## Goal

Everything the HTTP API can do is reachable from `@forge-cms/angular`, with pagination metadata and
signal-based resources, and the demo's two hand-rolled services can be deleted.

## Non-goals

- SSR-safe fetch / transfer state (roadmap 036's other half) — the base URL stays relative.
- Typed documents inferred from collection definitions (roadmap 038).
- An `HttpClient`-based implementation. `fetch` stays, so the package keeps zero runtime deps.
- Caching or a normalised store.

## Design

### Query options

```ts
export interface QueryOptions {
  where?: Record<string, unknown>; // { featured: true, price: { gte: 50 } }
  sort?: string;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  page?: number; // 1-based; converted to offset when limit is set
  depth?: 0 | 1;
  status?: 'draft' | 'published' | 'all';
}

export function buildQueryString(options?: QueryOptions): string;
```

`where` serialises to what the HTTP layer already parses: a bare value becomes `field=value`, an
operator object becomes `field[op]=value`, and `in` joins with commas. Exported because apps that
build links (`?page=2`) need to produce the same strings.

### Service surface

```ts
getDocuments<T>(collection: string, options?: QueryOptions): Promise<T[]>;                 // unchanged shape, new arg
listDocuments<T>(collection: string, options?: QueryOptions): Promise<PaginatedDocuments<T>>;
getDocument<T>(collection: string, id: string, options?: { depth?: 0 | 1 }): Promise<T>;
uploadFile<T>(collection: string, file: File, fields?: Record<string, string>): Promise<T>;
```

```ts
export interface ListMeta {
  collection: string;
  count: number; // page length, kept for backwards compatibility
  totalDocs: number;
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  limit?: number;
  offset?: number;
}
export interface PaginatedDocuments<T> {
  docs: T[];
  meta: ListMeta;
}
```

**Every** request — reads included — now sends the auth header when a token is configured.

### Signal resources

```ts
export interface ForgeResource<T> {
  value: Signal<T>;
  isLoading: Signal<boolean>;
  error: Signal<Error | null>;
  reload(): void;
}

export function collectionResource<T>(
  params: () => CollectionRequest | undefined
): ForgeResource<PaginatedDocuments<T> | undefined>;
export function documentResource<T>(
  params: () => DocumentRequest | undefined
): ForgeResource<T | undefined>;
```

Both are called in an injection context, re-run whenever their reactive `params` change, ignore
out-of-order responses, and return `undefined` while the request is `undefined` (the "no id yet"
case). They are deliberately **not** built on `@angular/core`'s `resource()`: that API is still
marked experimental and the package's peer range starts at Angular 19, so this is a signals-only
implementation with the same shape.

## Implementation plan

- [x] `query.ts`: `QueryOptions`, `buildQueryString`
- [x] auth header on every request; `listDocuments`, `getDocuments(options)`, `getDocument(options)`
- [x] `uploadFile`
- [x] `resources.ts`: `collectionResource`, `documentResource`
- [x] tests for query serialisation, the service methods (mocked `fetch`) and the resources
- [x] changeset

## Test plan

- `buildQueryString`: bare values, operator objects, `in` lists, `page`→`offset`, empty options.
- Service: sends the token on reads; `listDocuments` returns `docs` + `meta`; `uploadFile` posts
  `FormData` with the file part named `file`; error envelopes still map to `ApiValidationError` /
  `ApiAuthError`.
- Resources: initial load, reload on param change, `undefined` params stay idle, out-of-order
  responses do not clobber a newer one.
- `apps/demo-aesthetics` drops `AdminApiService` and its `async-state` helper and keeps working.

## Acceptance criteria

1. `getDocuments('services', { where: { featured: true }, sort: 'order', limit: 3, depth: 1 })`
   issues `GET /api/v1/services?featured=true&sort=order&limit=3&depth=1`.
2. `listDocuments` exposes `totalDocs`/`totalPages`/`hasNextPage`.
3. A configured token is sent on `GET` requests.
4. `uploadFile` creates a document on an `upload: true` collection.
5. `collectionResource` re-fetches when its params signal changes.
6. Gates green.

## Open questions

None.

## Outcome

Shipped as specified; the demo deleted `admin-api.service.ts`, `async-state.ts` and its
`site-api.service.ts` fetch plumbing in favour of the package.
