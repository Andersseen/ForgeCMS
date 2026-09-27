# 066 — Global document lifecycle and localization

- **Status:** done <!-- directed by the maintainer: "continue with the recommended step" (D04) -->
- **Author:** agent draft (maintainer directive: roadmap 0.6 D04, first bounded part)
- **Date:** 2026-09-27
- **Branch:** `feature/spec-065-auth-managed-delete-relation-integrity` (second commit; one PR for both)
- **Affected packages/apps:** @forge-cms/core, @forge-cms/db, @forge-cms/cloudflare, @forge-cms/runtime,
  @forge-cms/testing, docs (STATE, ROADMAP, roadmap 0.6 D04, collections docs)

## Context / Why

With D02 closed (spec 065), D04 is the next 0.6 packet: certify globals, localization and the
DB ↔ object-storage lifecycle. It is too large for one step, so this spec takes **globals and
localization** and leaves the file lifecycle (R2 fault recovery, browser upload journey) for the next
part.

**Reproduced first, on the unfixed code** (runtime probes, InMemory and on-disk libSQL):

1. **Access queries ignored.** `access.read`/`update` returning `{ region: 'eu' }` was treated as "allowed":
   a row with `region: 'us'` was returned and updated. The where-constrained rule also authorized
   creating the row.
2. **A partial update was not partial.**
   - `{ region: 'eu' }` alone failed with `VALIDATION_ERROR` (`title` is required), because
     validation ran on the partial input.
   - With `title` re-sent, the stored `theme: 'dark'` was reset to its default `'light'`, and a
     published global (`_status: 'published'`) was put back to `'draft'`.
3. **Editing one locale dropped the others.** There was no `locale` for globals, so writing
   `{ tagline: { en: 'yo' } }` replaced `{ en: 'hi', es: 'hola' }`.
4. **Localization did not work on SQL at all.** On libSQL, `create({ locale: 'en', data: { title: 'hi' } })`
   on a localized collection failed with `Failed query: insert … params: …,[object Object]`. The
   per-locale map was bound as a plain column value. Localization only ever worked on InMemory. D1
   shares the same value codec; it was not reproduced separately.
5. **Localized non-text fields could never be written.** Core validation accepts per-locale maps only
   for text-like kinds, so a localized `number`/`boolean` failed validation on every adapter. A
   localized `slug`/`email` skipped its per-locale format check.
6. **Simultaneous first writes.** Two runtimes on two libSQL clients writing a never-written global at
   once gave `[ok, UniqueConstraintError: Unique constraint violated on "_global_site" (id)]`. That is
   an internal error naming an internal table.
   - `InMemoryDatabaseAdapter` let **both** commit, silently: it had no primary-key check.
   - The D1 unit-test mock did not have one either.
7. **Accepted but inert options:**
   - `slug` `autoGenerate` on a global never generated anything;
   - `access.create`/`access.delete` and `beforeDelete`/`afterDelete` hooks on a global can never
     run;
   - a `localized` field without `locales`, or nested in a composite field, can never address a
     locale.

## Goal

A global behaves like a collection document with one row: partial writes, enforced access queries, a
race-safe first write and working per-locale edits. Localization works on every adapter for the kinds it
supports, and everything else is refused at startup.

## Non-goals

- The DB ↔ object-storage lifecycle, R2 fault recovery and the browser upload journey: D04's next
  part.
- Querying or sorting on localized fields.
- Localized kinds beyond `text`/`textarea`.
- Versions for globals, and changes to Angular/admin globals UI.
- **Concurrent edits of different locales on a _collection_.** Collections' locale merge has the same
  read-merge-write shape as the global fix below. Recorded as open, not changed here.

## Design

### 1. Global reads (`getGlobal`)

- **Access query.** A query-returning `access.read` is a row-level grant. If the row does not match,
  the read returns `null`, the same as "never configured" (HTTP `404`), so it confirms nothing.
- **Locale.** `locale` resolves localized fields with the collection fallback chain (exact →
  language → first declared locale). HTTP reads accept `?locale=`.

### 2. Global writes (`updateGlobal`)

The pipeline is the collection `prepareUpdate` shape, adapted to a singleton row:

- **Access query.** A query-returning `access.update` must match the stored row, or the write gets
  `403`. It **cannot authorize the first write**, because there is no row to match. Seed that row from
  trusted code. This is deliberately conservative.
- **Locale.** `locale` must be one of the global's `locales`, otherwise `400`. It is written with the
  shared `storeLocalizedDocument`, which merges into the stored map. HTTP writes accept `?locale=`.
- **First write only:**
  - `defaultValue`s apply;
  - `slug` auto-generation runs;
  - `_status` defaults to `'draft'` on a drafts global.
- **Later writes:**
  - `applyAutoSlugs` runs with the stored row, so an existing slug is kept;
  - `_status` is kept unless the write sends it;
  - `previousData` reaches `beforeValidate` as well as `beforeChange`.
- **Validation.** A later write validates `{ ...existing, ...data }` and reports only the errors
  the caller can act on, as collections do.
- **Persistence (`writeGlobal`):**
  - first write → `create` of the fixed `global` row;
  - later write → `update`;
  - a later write that merges locales → `updateIf` with a compare-and-set on the `updated_at` it
    read, `requireApplied`;
  - relation-target assertions (spec 064) are added in front of the write, in the same
    `atomicWrite`;
  - a failed condition becomes `409 CONCURRENT_MODIFICATION`;
  - a unique conflict on the first write's own table is the lost first-write race, and becomes the
    same `409` with a clean message (no table name).
- **The CAS stamp is made strictly later (found in review).** Adapters stamp `updated_at` to the
  millisecond. So before a CAS write, `writeGlobal` waits (bounded, ~1 ms) until the clock passes the
  stamp it read. Its own stamp is then always later, and a second writer that read the same row cannot
  match it. The contract runs the locale race with no pause between writes.
  - **Residual:** clock skew _between_ isolates or processes. A writer whose clock is behind can stamp
    an equal or earlier time. This is recorded, not solved; the fix would be a monotonic revision
    column.
- **Concurrent writes of different plain fields** both commit. Each `update` writes only its own
  columns, so neither resets the other. The contract proves it.

### 3. Localization on SQL adapters (`@forge-cms/db`, `@forge-cms/cloudflare`)

- **Column type.** `fieldKindToSqlType` gives every `localized` field a TEXT column.
- **Codec.** New `encodeFieldValue(value, field)` / `decodeFieldValue(value, field)` store a localized
  field's map as JSON and parse it back. Other fields keep their kind codec (`toDbValue`/`fromDbValue`,
  still exported). The libSQL and D1 adapters use them for create, update/`updateIf` and hydration.
- **Existing tables.** A localized field's column was created with its kind's type. Localized writes
  never succeeded on SQL, so no stored data depends on it. Existing columns are not retyped;
  SQLite's type affinity stores the JSON text as TEXT in them.

### 4. Supported localization matrix and startup refusals

`validateLocalizationSchema` checks collections and globals. `validateGlobalSchema` checks the global
options. Both run in the `ForgeCmsRuntime` constructor and throw
`Unsupported global/localization configuration:` with one line per problem.

| Configuration                                                                                               | Result                                               |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `localized` `text`/`textarea`, top level, owner declares `locales`                                          | supported: per-locale write/merge/read, all adapters |
| `localized` field, owner declares no `locales`                                                              | refused at startup                                   |
| `localized` field of any other kind (number, boolean, date, select, slug, email, json, richtext, composite) | refused at startup                                   |
| `localized` field nested in `group`/`array`/`blocks`                                                        | refused at startup                                   |
| `localized` `relation`/`upload`                                                                             | refused at startup (spec 064)                        |
| filter/sort on a localized field                                                                            | not supported (compares the stored map); documented  |
| global `access.create` / `access.delete`, global `beforeDelete`/`afterDelete` hooks                         | refused at startup                                   |
| global `drafts`, `depth: 1`, relation/upload fields, hooks (other), field access                            | supported (existing tests + spec 064)                |

- **What this changes for existing apps.** An application declaring any refused shape now fails at
  startup with a message naming the field. No persisted data is read, rewritten or deleted.
- **Apps in this repository.** None of them declares localization or a refused global option.

### 5. Adapter parity: duplicate primary key

`InMemoryDatabaseAdapter.create` now rejects a second row with an existing `id` as a
`UniqueConstraintError(collection, ['id'])`, as libSQL/D1 do through their primary key. The D1 unit-test
mock enforces it too, with real D1's error shape. The shared constraint contract proves it on all three.

## Test plan

- **Unit tests (`packages/runtime/src/global-lifecycle.test.ts`):**
  - partial updates keep required, defaulted and draft-status fields;
  - defaults and draft status apply on the first write only;
  - a cleared required field is still reported;
  - slug auto-generation, kept on rename;
  - `previousData` reaches `beforeValidate`;
  - locale write/merge/read and fallback;
  - an undeclared locale is a `400`;
  - `?locale=` over HTTP;
  - read/update access queries, including refusing the first write;
  - every startup refusal on globals and collections.
- **Contract `runGlobalLifecycleContractTests`**, on InMemory, on-disk libSQL (independent clients)
  and local D1 (workerd, independent adapters). Both writers are held with `createWriteGate` and
  released together:
  - two simultaneous first writes → one `ok`, one `409`, and the row equals the winner's;
  - simultaneous edits of different locales → one `ok`, one `409`; the retry keeps both;
  - simultaneous partial edits of different fields → both kept.
- **DatabaseAdapter contract:** a localized map round-trips through create and update (InMemory,
  libSQL, D1 mock); a duplicate `id` is a unique conflict (InMemory, libSQL, D1 mock, real D1).
- **Real D1 (workerd):** a localized collection's create/update/read per locale, through the runtime.

## Acceptance criteria

1. A query-returning global access rule is enforced on read and update.
2. A later global write keeps every omitted field: required, defaulted and `_status`.
3. Writing one locale keeps the others, and concurrent edits of different locales cannot drop one.
4. Localized `text`/`textarea` fields work on InMemory, libSQL and D1.
5. Two simultaneous first writes: exactly one commits, the other gets `409`, and no internal error or
   table name leaks.
6. Every unsupported global/localization option is refused at startup.
7. The full repository gates, `test:libsql`, `test:cloudflare`, `check:api`, `release:verify` and the
   three E2Es are green.

## Open questions

None.

## Outcome

Shipped as designed, plus one change made in review: the CAS stamp is made strictly later (§2), which
closes same-millisecond locale races under one clock.

Recorded in review, not changed here:

- **Read access on write responses.** A write's response ignores the caller's _read_ rule. An
  update-permitted caller whose read query hides the row still receives it from
  `updateGlobalDocument`.
- **Update-access check timing.** The update-access query is checked against the row read before the
  write, not inside the write.
- **Whole-map writes.** A write without `locale` sending the whole map is last-writer-wins.

The first two are the same on collection `update()`, so they belong to one cross-cutting fix rather
than a globals-only divergence.

Remaining D04 work:

- DB ↔ object-storage lifecycle (R2 fault recovery, browser upload journey);
- the collection locale-merge race;
- querying localized fields (not supported).

Production D1 and remote Turso were not exercised.
