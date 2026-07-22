# 017 — Add draft/published status to collections

- **Status:** done
- **Author:** agent draft (approved via user instruction to implement the Payload-parity roadmap)
- **Date:** 2026-07-20
- **Branch:** main
- **Affected packages/apps:** @forge-cms/core, @forge-cms/db, @forge-cms/cloudflare, @forge-cms/runtime

## Context / Why

Every write is published immediately today — there's no way to save a document without it being publicly
visible right away. The original roadmap item is "drafts/versioning, no solo publish directo" (not just
direct publish). This spec ships drafts (a `_status` on each document, public reads hidden until
published). A full version-history system (every past revision retained, diffing, restore-to-version) is
a materially bigger feature — explicitly deferred, see Non-goals.

## Goal

`defineCollection({ ..., drafts: true })` gives every document a system `_status: 'draft' | 'published'`
field, defaulting to `'draft'` on create. Public (unauthenticated) reads only ever see `published`
documents; authenticated requests can opt in to seeing drafts via `?status=draft|all`.

## Non-goals

- Version history (retaining every past revision, diffing, restoring an old version). This spec is
  binary draft/published status on the current row, not an audit log — a genuinely bigger feature left for
  its own future spec.
- Autosave / scheduled publishing.
- A dedicated "publish" UI action or endpoint — publishing is just a normal `PUT` that sets
  `_status: 'published'` (or a `POST` that sets it directly).
- Field-level or role-specific "who can publish" gating beyond the collection's existing
  `access.create`/`access.update` (spec 013) — anyone who can write the document can set its `_status`.
- Retroactively migrating `_status` onto a `drafts: true` collection whose table already existed before
  this flag was added (consistent with spec 014's additive-only migrations, which only track
  `collection.fields`, not system columns like `_status`/`id`/`created_at`) — a collection needs `drafts:
true` from its first sync, or a manual `ALTER TABLE ADD COLUMN "_status" TEXT` for existing deployments.

## Design

### `@forge-cms/core`

`CollectionDefinition` gains `drafts?: boolean`. `_status` is a system field, like `id`/`created_at`/
`updated_at` — it is never part of `collection.fields` and is not touched by `validateCollection`.

### `@forge-cms/db` / `@forge-cms/cloudflare` — schema

`generateCreateTableSql` adds `"_status" TEXT` to the system columns (right after `updated_at`) when
`collection.drafts === true`. `getOrCreateDrizzleTable` (libsql) does the same. `D1DatabaseAdapter` shares
the same `generateCreateTableSql`, so no separate change needed there.

### `@forge-cms/runtime` — `handlers.ts`

- **`handleCreate`**: on a `drafts: true` collection, if the body doesn't include `_status`, set
  `data._status = 'draft'` (after hooks run, so a `beforeChange` hook can still see/override it — applied
  right before `validateCollection`... actually applied to `data` right after `runBeforeChangeHooks`, so a
  hook-supplied `_status` is respected and only the "still unset" case gets the default). If the body (or a
  hook) sets `_status`, it must be `'draft'` or `'published'` — otherwise `400`.
- **`handleUpdate`**: same validation if `_status` is present in the (hook-processed) data; otherwise the
  existing row's `_status` is left untouched by the partial update, as today.
- **`handleList`**: new `status` query param (added to `RESERVED_QUERY_PARAMS`, so it's never treated as a
  `where` filter) — only meaningful when `collection.drafts === true`:
  - Anonymous request (no resolved user/role): always filtered to `_status = 'published'`, regardless of
    `?status`.
  - Authenticated request: `?status=draft` → only drafts; `?status=all` → no `_status` filter; absent or
    `?status=published` → published only (the safe default even when logged in, so an editor's normal
    "browse the list" view doesn't silently include drafts unless asked).
  - Any other `status` value → `400`.
- **`handleRead`**: on a `drafts: true` collection, if the found record's `_status === 'draft'` and the
  requester has no resolved role (anonymous), respond `404` (same as "doesn't exist" — no separate
  "exists but forbidden" signal, to avoid leaking draft existence).
- None of this applies when `collection.drafts` is falsy — fully backward compatible, zero behavior change
  for every existing collection.

## Implementation plan

- [x] `packages/core/src/index.ts`: `CollectionDefinition.drafts?: boolean`.
- [x] `packages/db/src/schema-generator.ts`: conditional `"_status" TEXT` in `generateCreateTableSql`/
      `getOrCreateDrizzleTable`.
- [x] `packages/runtime/src/handlers.ts`: default/validate `_status` in `handleCreate`/`handleUpdate`;
      `status` query-param parsing + filtering in `handleList`; draft-hiding in `handleRead`.
- [x] Tests: `schema-generator.test.ts` (`_status` column present only when `drafts: true`);
      `handlers.test.ts` (create defaults to draft; explicit `_status: 'published'` on create is honored;
      invalid `_status` → 400; anonymous list only sees published; authenticated `?status=draft`/`all` work;
      anonymous `?status=draft` is silently ignored (still published-only); anonymous read of a draft →
      404; non-drafts collections completely unaffected — regression check against all prior tests).
- [x] `docs/ARCHITECTURE.md` / `docs/STATE.md`: document `drafts`/`_status`/`?status`; update
      `@forge-cms/core`/`@forge-cms/db`/`@forge-cms/runtime` rows; mark "drafts/versioning" (partially)
      done, noting version history explicitly remains open.
- [x] Changeset: `@forge-cms/core`, `@forge-cms/db`, `@forge-cms/runtime` (minor — additive).

## Test plan

- `schema-generator.test.ts`: `generateCreateTableSql` includes `"_status" TEXT` iff `collection.drafts`.
- `handlers.test.ts`: full matrix above (create default, explicit status, invalid status, anonymous vs.
  authenticated list filtering, anonymous read of a draft, non-drafts collection regression).

## Acceptance criteria

1. Creating a document on a `drafts: true` collection without `_status` in the body results in
   `_status: 'draft'` on the stored/returned record.
2. Anonymous `GET` (list or single) never returns a `draft` document from a `drafts: true` collection.
3. An authenticated request can see drafts via `?status=draft`/`?status=all` on list; default (or
   `?status=published`) stays published-only even when authenticated.
4. Collections without `drafts: true` are completely unaffected — no `_status` column, no filtering.
5. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.

## Open questions

(none — approved)

## Outcome

Shipped 2026-07-20 as specified. One addition beyond the original design: D1's `SYSTEM_COLUMNS`
allow-list (used to validate `where`/`sort` column names before SQL interpolation, added in spec 011) needed
`'_status'` added too, since `handleList` now injects `where._status` directly — not mentioned explicitly
in the original design text but a necessary consequence of it. `pnpm lint && pnpm typecheck && pnpm test
&& pnpm build` green.
