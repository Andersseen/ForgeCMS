# 007 — Make apps/www's CRUD routes delegate to @forge-cms/runtime handlers

- **Status:** done
- **Author:** agent draft
- **Date:** 2026-07-08
- **Branch:** main
- **Affected packages/apps:** @forge-cms/runtime, @forge-cms/angular, apps/www

## Context / Why

STATE.md known issue #1 / PLAN.md P2-1.5: none of `apps/www`'s 5 CRUD HTTP routes actually call
`@forge-cms/runtime`'s `handleList/Read/Create/Update/Delete`, contradicting ARCHITECTURE.md's "thin
wrappers" claim. Each route reimplements similar-but-diverging logic directly with h3 primitives.
Concrete costs: QW-4's `coerceWhere` filter fix (in `@forge-cms/runtime`) has no effect on the real
app; the error envelope for write failures is h3's `{ error: true, statusCode, statusMessage,
message, data: { errors } }` instead of the documented `{ error: string, details?: ValidationError[] }`;
`handleUpdate`'s partial-validation logic is duplicated app-side. Approved as part of finishing
PLAN.md in full (2026-07-08) — this session's plan treats that broad instruction as approval, per
`SDD.md`, given the spec has no open design questions.

## Goal

`apps/www`'s 5 CRUD route files are thin `ApiContext`-building wrappers that call
`@forge-cms/runtime`'s handlers directly; the deployed demo's behavior (filtering, error envelope,
validation) matches what `@forge-cms/runtime`'s own tests already assert.

## Non-goals

- `GET /api/v1/collections` (bespoke metadata endpoint, no runtime handler exists for it), `GET
/api/auth/me`, and `GET /api/status` — untouched, out of scope.
- Auth enforcement on writes — that's PLAN.md P2-2 / spec 006, built on top of this once it lands.
- Any change to `@forge-cms/runtime`'s handler logic itself — it's already correct and tested.

## Design

### Before → after, route shape

Every route currently repeats: resolve runtime → read router params → look up the collection (404 if
missing) → do its own body-parsing/validation/adapter call → hand-build a JSON response or throw an
h3 `createError`. After this change, every route is:

```ts
import { defineEventHandler, getRouterParam, toWebRequest } from 'h3';
import type { ApiContext } from '@forge-cms/api';
import { handleList } from '@forge-cms/runtime'; // handleRead/Create/Update/Delete per file
import { getServerRuntime } from '../../../api/runtime';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const context: ApiContext = {
    request: toWebRequest(event),
    params: { collection: getRouterParam(event, 'collection') ?? '' },
    env: event.context.cloudflare?.env
  };
  return handleList(context, { runtime });
});
```

(`[id]` routes add `id: getRouterParam(event, 'id') ?? ''` to `params`.) h3 1.15.11 (installed
version) natively detects a returned `Response` instance (`isWebResponse`/`sendWebResponse` in
`h3/dist/index.mjs`) and streams it back — no bridging utility needed beyond `toWebRequest`.

Files: `apps/www/src/server/routes/api/v1/[collection].get.ts`, `[collection].post.ts`,
`[collection]/[id].get.ts`, `[collection]/[id].put.ts`, `[collection]/[id].delete.ts`.

### Envelope reconciliation

`@forge-cms/runtime`'s `handleCreate`/`handleUpdate` already return
`jsonResponse({ error: 'Validation failed', details: validation.errors }, 400)` — this **is**
ARCHITECTURE.md's documented envelope. Once routes delegate to it, `@forge-cms/angular`'s
`toApiError` (`packages/angular/src/index.ts:77-85`) needs to read the new (correct) shape instead of
the old h3 shape it was written against:

```ts
// before
const body = (await response.json()) as {
  statusMessage?: string;
  data?: { errors?: ApiFieldError[] };
};
if (body.data?.errors)
  return new ApiValidationError(body.statusMessage ?? fallbackMessage, body.data.errors);

// after
const body = (await response.json()) as { error?: string; details?: ApiFieldError[] };
if (body.details) return new ApiValidationError(body.error ?? fallbackMessage, body.details);
```

Successful `create` now returns HTTP `201` (was an implicit `200`) — matches ARCHITECTURE.md,
harmless to callers since `CmsApiService` only checks `response.ok`.

## Implementation plan

- [x] Rewrite `[collection].get.ts` → `handleList`; manually curl it against `pnpm dev:www` before
      touching the rest (confirms the `Response`-passthrough approach works end-to-end)
- [x] Rewrite `[collection].post.ts` → `handleCreate`
- [x] Rewrite `[collection]/[id].get.ts` → `handleRead`
- [x] Rewrite `[collection]/[id].put.ts` → `handleUpdate`
- [x] Rewrite `[collection]/[id].delete.ts` → `handleDelete`
- [x] `packages/angular/src/index.ts`: update `toApiError` (Design above)
- [x] Changeset (patch, `@forge-cms/angular`)
- [x] Update `docs/STATE.md` (known issue #1 resolved; API surface section)
- [x] Full gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

## Test plan

- Manual curl cycle against `pnpm dev:www`: list with `where`-style query params now filters (was
  silently ignored before); create with a missing required field → `400` with `{error, details}`;
  valid create → `201`; read/update/delete all still work.
- `@forge-cms/runtime`'s existing handler tests already cover the handler logic; no new tests needed
  there. No new apps/www-level tests for the route files themselves (intentionally thin, per
  CONVENTIONS.md) — covered by e2e instead.

## Acceptance criteria

1. `GET /api/v1/posts?category=tutorial` returns only matching records (filter now works).
2. `POST /api/v1/posts` with a missing required field returns `400` with body
   `{ "error": "Validation failed", "details": [...] }`.
3. `POST /api/v1/posts` with valid data returns `201`.
4. `GET/PUT/DELETE /api/v1/posts/:id` behave the same as before for valid input.
5. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.

## Open questions

None.

## Outcome

Shipped as designed. Also required adding `@forge-cms/api: workspace:*` to `apps/www/package.json`
(it was never a declared dependency, only reachable transitively before — `tsc` couldn't resolve it
until added explicitly). Found, but deliberately left alone (pre-existing, not a regression):
`handleUpdate`'s partial-validation filter flags a required field as missing even when a partial PUT
body simply doesn't touch that field — this already existed identically in the old app-local route
(same filter logic, byte for byte) and the real schema-driven edit form sends the full document on
save, so it doesn't manifest in the UI; verified via curl with a deliberately partial body. Left as a
known issue for a future fix, out of this spec's scope.
