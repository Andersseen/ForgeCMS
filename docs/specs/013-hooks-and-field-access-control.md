# 013 — Add lifecycle hooks and field/collection access control

- **Status:** done
- **Author:** agent draft (approved via user instruction to implement the Payload-parity roadmap)
- **Date:** 2026-07-20
- **Branch:** main
- **Affected packages/apps:** @forge-cms/core, @forge-cms/runtime

## Context / Why

Spec 010 added route-level RBAC (`allowedRoles` passed per-route, identical for every collection). Two
gaps remain, both listed in STATE.md's package table and named together in `docs/SDD.md`'s own
required-spec table as one category ("runtime feature (hooks, access control)"):

1. No lifecycle hooks — a collection can't run custom logic (defaulting, deriving, normalizing, side
   effects) around create/update, short of forking `@forge-cms/runtime`.
2. Access control is all-or-nothing per route, not per collection or per field. Every collection using a
   given route gets the same roles; there's no way to make one field (e.g. an internal note) readable or
   writable only by certain roles while the rest of the document stays open.

## Goal

`defineCollection` accepts `hooks: { beforeChange?, afterChange? }` and `access: { read?, create?,
update?, delete? }`; individual fields accept `access: { read?, write? }` in their options. The runtime
handlers run hooks and enforce both levels of access control.

## Non-goals

- `beforeRead`/`afterRead`/`beforeDelete`/`afterDelete` hooks (only `beforeChange`/`afterChange`, matching
  what was asked for).
- Hook ordering/priority configuration beyond "run in array order".
- Field-level access on `handleCreate`'s **response** shape (the created record echoes back whatever the
  caller could already infer from a 201; only the _request_ is access-checked, and only `handleList`/
  `handleRead` responses are read-filtered).
- Changing `apps/www`'s demo collections to use hooks/access (this spec ships the capability in
  `@forge-cms/core`/`@forge-cms/runtime` with full test coverage there; wiring a demo is a natural
  fast-follow, not required for this spec's acceptance).
- A generic "roles" type in `@forge-cms/core` — role names stay plain `string[]` there (core has no
  dependency on `@forge-cms/auth` today and this spec doesn't add one); `@forge-cms/runtime` (which
  already depends on `@forge-cms/auth`) does the actual role comparison.

## Design

### `@forge-cms/core` — new types, `CollectionDefinition` and `BaseFieldOptions` extended

```ts
export interface HookContext {
  collection: CollectionDefinition;
  operation: 'create' | 'update';
  data: Record<string, unknown>;
  previousData?: Record<string, unknown>; // update only
}

export type BeforeChangeHook = (
  ctx: HookContext
) => Record<string, unknown> | Promise<Record<string, unknown>>;

export type AfterChangeHook = (
  ctx: HookContext & { result: Record<string, unknown> }
) => void | Promise<void>;

export interface CollectionHooks {
  beforeChange?: BeforeChangeHook[];
  afterChange?: AfterChangeHook[];
}

export interface CollectionAccess {
  read?: string[]; // role names; undefined = public, matching today's default
  create?: string[]; // undefined = fall back to the route's own allowedRoles (backward compatible)
  update?: string[];
  delete?: string[];
}

export interface FieldAccess {
  read?: string[]; // undefined = every role (incl. unauthenticated) can read this field
  write?: string[]; // undefined = every role that can write to the collection can write this field
}

// BaseFieldOptions gains: access?: FieldAccess
// CollectionDefinition gains: hooks?: CollectionHooks; access?: CollectionAccess
```

A `beforeChange` hook that wants to reject the operation throws; the runtime turns that into a `400` with
the thrown `Error`'s message (same shape as a validation failure). `afterChange` hooks run after the write
succeeds; a throwing `afterChange` hook is logged (`console.error`) and does not fail the request — the
write already happened.

### `@forge-cms/runtime` — new `hooks.ts`

```ts
export async function runBeforeChangeHooks(
  collection: CollectionDefinition,
  ctx: Omit<HookContext, 'collection'>
): Promise<Record<string, unknown>>; // runs collection.hooks?.beforeChange in order, threading data through

export async function runAfterChangeHooks(
  collection: CollectionDefinition,
  ctx: Omit<HookContext, 'collection'> & { result: Record<string, unknown> }
): Promise<void>; // swallows + console.error's individual hook failures
```

### `@forge-cms/runtime` — new `field-access.ts`

```ts
export function filterReadableFields(
  record: DatabaseRecord,
  collection: CollectionDefinition,
  role: UserRole | undefined
): DatabaseRecord; // omits keys whose field.options.access?.read is set and doesn't include role

export function assertWritableFields(
  body: Record<string, unknown>,
  collection: CollectionDefinition,
  role: UserRole | undefined
): void; // throws FieldAccessError naming the first offending field
```

`role` is `undefined` for unauthenticated requests (routes that don't `requireAuth`); such requests can
still read fields with no `access.read` restriction (today's default — open collections stay open) but
never read/write fields that declare any `access.read`/`access.write` roles.

### `@forge-cms/runtime` — `handlers.ts` wiring

- **Collection-level access**: `authorize()` gains a `collection` parameter. When
  `collection.access?.[operation]` is defined, it replaces the handler's static `allowedRoles` option for
  that request (collection opts in to its own roles); when undefined, behavior is unchanged (falls back to
  `allowedRoles`, or no check when neither is set) — fully backward compatible with spec 010's routes.
- **`handleList`/`handleRead`**: resolve the requesting user optimistically (new `resolveOptionalUser`,
  wraps `requireAuth` in a try/catch returning `null`) even when the route doesn't `requireAuth`, so
  field-read access can apply to public routes too. Run `filterReadableFields` on every record (after
  population) before building the response.
- **`handleCreate`**: after parsing the body and before hooks, `assertWritableFields` (→ `403` naming the
  field on failure). Run `beforeChange` hooks, then existing validation, then `create`, then
  `afterChange` hooks with the created record as `result`.
- **`handleUpdate`**: same shape — `assertWritableFields` on the partial body, `beforeChange` (with
  `previousData` = the existing record), existing merge+validation, `update`, `afterChange`.

## Implementation plan

- [x] `packages/core/src/index.ts`: `HookContext`, `BeforeChangeHook`, `AfterChangeHook`,
      `CollectionHooks`, `CollectionAccess`, `FieldAccess`; extend `BaseFieldOptions`/`CollectionDefinition`.
- [x] `packages/runtime/src/hooks.ts`: `runBeforeChangeHooks`, `runAfterChangeHooks`.
- [x] `packages/runtime/src/field-access.ts`: `filterReadableFields`, `assertWritableFields`,
      `FieldAccessError`.
- [x] `packages/runtime/src/handlers.ts`: collection-level access in `authorize`; field filtering in
      `handleList`/`handleRead`; hooks + write-access in `handleCreate`/`handleUpdate`.
- [x] `packages/runtime/src/index.ts`: export the new hook/field-access functions and types re-exported
      from `@forge-cms/core`.
- [x] Tests: `packages/runtime/src/hooks.test.ts`, `packages/runtime/src/field-access.test.ts`,
      `handlers.test.ts` additions (collection access overriding `allowedRoles`, field read filtering on
      list/read, field write rejection on create/update, beforeChange mutating data, beforeChange throwing
      → 400, afterChange side effect runs, afterChange throwing doesn't fail the request).
- [x] `docs/ARCHITECTURE.md` / `docs/STATE.md`: document hooks + access control; update `@forge-cms/core`
      and `@forge-cms/runtime` rows; mark the gap done.
- [x] Changesets: `@forge-cms/core`, `@forge-cms/runtime` (minor — additive).

## Test plan

- `hooks.test.ts`: multiple `beforeChange` hooks run in order, each seeing the previous one's output;
  a hook that throws surfaces its message; `afterChange` receives `result`; a throwing `afterChange`
  doesn't propagate.
- `field-access.test.ts`: a field with `access.read: ['admin']` is present for an admin, absent for a
  viewer and for `undefined` role; a field with `access.write: ['admin']` in the body throws for a
  non-admin, passes for an admin; fields with no `access` are unaffected regardless of role.
- `handlers.test.ts`: a collection with `access.create: ['admin']` rejects an editor even though the
  route's `allowedRoles` includes `editor`; a collection with no `access` falls back to the route's
  `allowedRoles` unchanged (regression check against spec 010's existing tests); a restricted field is
  stripped from `GET` list/read responses for an unauthorized role and present for an authorized one.

## Acceptance criteria

1. `beforeChange` hooks can mutate data before validation; throwing one returns `400` with its message.
2. `afterChange` hooks run after a successful write and receive the created/updated record; a throwing one
   does not turn the response into an error.
3. `collection.access.<op>` overrides the route's `allowedRoles` when present; existing routes without
   `collection.access` behave exactly as before this spec.
4. `field.options.access.read` hides that field from `GET` responses for unauthorized roles (including
   unauthenticated requests on otherwise-public routes).
5. `field.options.access.write` rejects (`403`) a create/update body that sets that field from an
   unauthorized role.
6. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.

## Open questions

(none — approved)

## Outcome

Shipped 2026-07-20. One implementation detail differs from the design text: instead of `authorize()`
itself taking a `collection` parameter, each handler computes `effectiveRoles(collection.access?.[op],
allowedRoles)` and passes the result as `authorize()`'s existing `allowedRoles` argument — same behavior,
smaller diff to `authorize()`. Also reordered every handler to resolve `collectionSlug`/`collection`
_before_ calling `authorize`, so collection-level access can be consulted; verified against spec 010's
existing RBAC tests (all still use a registered `posts` collection, so the 401/403/404 status codes for
those cases are unchanged) plus a full `pnpm test` run — no regressions. `pnpm lint && pnpm typecheck &&
pnpm test && pnpm build` green.
