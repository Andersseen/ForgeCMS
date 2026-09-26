# 063 — System-field mutation boundary

- **Status:** done <!-- approved by the maintainer's task brief, which directs this exact bounded step (as for specs 059–062) -->
- **Author:** agent draft (explicit maintainer directive to implement this bounded step)
- **Date:** 2026-09-26
- **Branch:** `feature/spec-063-system-field-mutation-boundary`
- **Affected packages/apps:** @forge-cms/runtime, @forge-cms/admin (form payload), @forge-cms/cloudflare
  (tests only), docs (Local API / REST / collections docs, roadmap 0.6)

## Context / Why

Spec 062 §11 recorded a confirmed vulnerability: the generic CMS mutation pipeline treats Forge-owned
document metadata in caller `data` as ordinary input. `assertWritableFields` only checks _declared_
fields, `validateCollection` whitelists the system keys, and every adapter persists what it is given.
`_storageKey` is the dangerous one: `deleteDocument` later uses it as the instruction for which physical
object to delete.

### Reproduced on `main` (`d7f8ca5`) before designing anything

A throwaway probe (not committed) ran the unmodified runtime through the real HTTP handlers, as an
authenticated `editor` with create/update/delete access on an `upload: true` collection:

| Case                                                                                                          | Observed on `main`                                                                         |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **P1** upload A and B (multipart); `PATCH A { "_storageKey": <B's key> }`; `DELETE A`                         | PATCH `200`, A's row now holds B's key; DELETE `204`; **B's object deleted**, A's orphaned |
| **P2** JSON `POST { filename, url: <B's url> }` (no file ⇒ no `_storageKey`); `DELETE` it                     | create `201`; the URL-derived fallback key **deleted B's object**                          |
| **P3** HTTP `POST { id: 'chosen-id', created_at: '1999-…', … }`                                               | `201`, `id = chosen-id`, `created_at = 1999-…`                                             |
| **P4** HTTP `PATCH { id: 'renamed', created_at: '2000-…', updated_at: '2000-…' }`                             | `200`; `created_at` rewritten; `id` change **silently ignored**                            |
| **P6** trusted Local API create; a `beforeChange` hook returns `{ ...data, _storageKey, created_at }`         | both persisted                                                                             |
| **P7** HTTP preview with `{ _storageKey, created_at, id }`                                                    | `200`, echoed back as document content                                                     |
| **P8** `updateGlobalDocument({ data: { created_at, _storageKey } })`                                          | both persisted in the global row (InMemory)                                                |
| **P9** libSQL: the admin form's save (PATCH of the whole read document + one edit, i.e. a stale `updated_at`) | title saved, **`updated_at` not bumped** — the caller's stale value overwrote the stamp    |
| **P0** multipart form parts named `_storageKey` / `created_at` / `id`                                         | ignored — only declared fields are copied, and core reserves system names                  |

P1 is a cross-object deletion: anyone with update + delete on one upload document can delete any object
in the bucket. P2 is the same destruction through a _declared_ field. P9 is a live data bug in the
first-party admin today (SQL adapters apply caller `updated_at` after their own stamp; InMemory stamps
last, so it hides the bug locally).

## Goal

No caller of the CMS mutation surface — HTTP, `overrideAccess: false` or trusted Local API, request body
or hook output — can create or change Forge-owned document metadata, and upload cleanup only ever
deletes the object Forge itself recorded for that document.

## Non-goals

- D02 relation atomicity, D04 certification, version retention, `versions.autosave`, migrations.
- A Local API upload operation (trusted server code that must attach an existing object to a document
  uses the raw adapter — see §7). Recorded as a follow-up.
- Changing adapters' raw `create`/`update` semantics (they remain the unguarded persistence layer).
- Hiding `_storageKey` from read responses (recorded, §10).
- Strata mutation routes; any change to the `CollectionInput<T>` types.

## Design

### 1. Classification

| Key           | Kind                 | Meaning                                                                       |
| ------------- | -------------------- | ----------------------------------------------------------------------------- |
| `id`          | Forge-owned identity | allocated at create; immutable                                                |
| `created_at`  | Forge-owned metadata | stamped by the adapter at create; immutable                                   |
| `updated_at`  | Forge-owned metadata | stamped by the adapter on every write                                         |
| `_storageKey` | Forge-owned metadata | the stored object's key; set only by Forge's upload pipeline; drives deletion |
| `_status`     | **lifecycle input**  | `draft`/`published` on a `drafts: true` collection/global — stays writable    |
| declared      | content              | field access rules (`access.write`) apply                                     |

The four Forge-owned keys become one runtime constant, `FORGE_OWNED_KEYS` (package-internal,
`packages/runtime/src/system-fields.ts`); `versions.ts` (spec 062's `SYSTEM_KEYS`) reuses it.

### 2. Policy matrix

"Echo" = the key's value equals what is already stored on the target document (`null`/absent count as
equal). An echo is a no-op, not a write attempt: it is **dropped** before hooks and persistence, so a
client that round-trips the whole document it read (the admin form, P9) keeps working and never
overwrites a stamp. Anything else is a write attempt and is **rejected** — never silently stripped.

| Key / operation | HTTP                        | Local API `overrideAccess: false` | Trusted Local API (default)              | Internal runtime                    | Raw `DatabaseAdapter` |
| --------------- | --------------------------- | --------------------------------- | ---------------------------------------- | ----------------------------------- | --------------------- |
| `id` on create  | 400                         | 400                               | **allowed** (non-empty string, else 400) | allocated (UUID / spec 062)         | unguarded             |
| `id` on update  | echo dropped, else 400      | echo dropped, else 400            | echo dropped, else 400                   | target id = `UpdateArgs.id` / URL   | unguarded             |
| `created_at`    | create 400; update echo/400 | same                              | same                                     | adapter stamps                      | unguarded             |
| `updated_at`    | create 400; update echo/400 | same                              | same                                     | adapter stamps                      | unguarded             |
| `_storageKey`   | create 400; update echo/400 | same                              | same                                     | multipart upload pipeline only (§5) | unguarded             |
| `_status`       | drafts: allowed             | drafts: allowed                   | drafts: allowed                          | defaults to `draft`                 | unguarded             |

`overrideAccess: true` bypasses **authorization**; it never grants permission to corrupt Forge-owned
metadata — the same rule spec 061 established for auth-managed collections. Trusted code that genuinely
needs raw persistence (fixtures, imports of existing rows with their timestamps, attaching a
pre-existing object) uses `runtime.adapters.database`, which bypasses access, hooks, validation, the
auth boundary and this boundary by design.

**Why trusted explicit `id` stays:** spec 062 relies on it (history-adoption regression, the
`runVersionHistoryContractTests` suite) and it is the one deterministic-id capability seeds/imports/sync
have through the pipeline. An untrusted client has no need to choose primary keys, so HTTP and
`overrideAccess: false` reject it.

### 3. Error semantics

A caller write attempt → `InvalidInputError` (`400`, `INVALID_INPUT`), message
`Field '<key>' is managed by Forge and cannot be written` (the key is the caller's own input; no stored
value or storage detail is included). `INVALID_INPUT` rather than `FORBIDDEN`: these keys are not
role-controlled fields — no role can write them. No new error class; no API baseline change. The check
runs after collection access/row policy (so an unauthorized caller still gets `401/403`, and the echo
comparison is never an oracle for a document the caller cannot update) and before field-write checks,
hooks and any write, so a rejection has no side effects.

### 4. Hooks

Forge-owned keys are kept **out of** hook `data`: a trusted create's explicit `id` is held aside and
re-attached at persistence (hooks see it on the returned `doc`), and echoes were already dropped. After
each hook stage (`beforeValidate` incl. field hooks, `beforeChange` incl. field hooks) the output is
screened with the same echo rule; a hook that introduces or changes a Forge-owned key fails the
operation with a plain `Error` (→ `500 INTERNAL_ERROR`, logged) — it is a server-code bug, not a bad
request, so it is not reported as the caller's `400`. `_status` stays hook-writable. A hook returning
`{ ...previousData, ...data }` still works (its system keys are echoes).

### 5. Upload pipeline — internal ownership

`handleCreate`'s multipart branch no longer puts `_storageKey` in `data`. It calls a package-private
operation `createUpload(ctx, args, storageKey)` (exported from `operations.ts` for `handlers.ts`, **not**
from the package entry point, so no public escape hatch). `create()` and `createUpload()` share one
pipeline; the key is merged only into the persisted row (and never into the version snapshot, which
excludes it anyway). Multipart form parts keep being copied only for declared fields; core already
forbids declaring a field named after a system key, so a form part cannot spoof it (pinned by a test).

### 6. Storage cleanup reads only Forge's own key

`deleteDocument` deletes `doc._storageKey` and nothing else. The spec-051 URL-derived fallback is
**removed**: `url` is a declared, writable content field, so deriving a deletion target from it
reproduces the exploit without touching a system key (P2). A document without `_storageKey` (a pre-0.2
upload record, or one created without a file) deletes no object; its object, if any, is left for manual
cleanup (logged at `warn`). Upgrade note in the Local API docs.

### 7. Preview and globals

`preview()` applies the same input screen (create mode, or update mode against the existing document)
before merging — protected keys cannot masquerade as content. `updateGlobal()` applies it against the
existing global row (first write: every Forge-owned key rejected; the row id stays `global`), and screens
hook output the same way. Draft `_status` unchanged on both.

### 8. Versioned upload collections

Snapshots already exclude the Forge-owned keys and restore already drops them (spec 062); unchanged, and
now pinned for an upload + versions collection (restore cannot change the object association).

### 9. First-party client

`ForgeCollectionFormComponent` (`@forge-cms/admin`) submits without the Forge-owned keys it read, so the
admin never relies on echo tolerance and a concurrent edit cannot turn a stale `updated_at` into a
confusing `400`. Other clients keep working through echo tolerance.

### 10. Recorded, not fixed

- Read responses include `_storageKey` (it is also derivable from `url`); hiding it is a separate
  read-projection change.
- `_status` sent to a non-drafts collection is accepted by validation; on SQL there is no column.
- InMemory does not enforce primary-key uniqueness (spec 062 §11) — not needed by these tests.
- `apps/demo-aesthetics`' settings page still PATCHes the whole loaded document. It works through echo
  tolerance, but a concurrent write between load and save now yields `400 Field 'updated_at'…` (on
  `main`, SQL silently kept the stale stamp). App-local; not changed here.
- A `null` JSON body or a `__proto__` key on create/update is a pre-existing `500` (TypeError before any
  write), not a `400`. Not a security issue; unchanged.

## Implementation plan

- [x] `system-fields.ts`: `FORGE_OWNED_KEYS`, caller-input screen, hook-output screen (runtime)
- [x] `operations.ts`: create/update/preview use the screens; `createUpload` internal; id held aside;
      storage cleanup without URL fallback; `versions.ts` reuses the constant
- [x] `globals.ts`: same screens
- [x] `handlers.ts`: multipart path calls `createUpload`
- [x] `@forge-cms/admin`: form submit drops Forge-owned keys
- [x] tests: runtime matrix, hooks, preview, globals, HTTP exploit, multipart, versioned upload,
      libSQL/D1 timestamps; real D1 + R2 exploit regression; update existing tests that relied on
      trusted `_storageKey` / URL fallback
- [x] changesets, docs (Local API, REST, collections, ARCHITECTURE, STATE, roadmap 0.6), cross-ref in 062

## Test plan

- `packages/runtime/src/system-fields.test.ts` — the matrix on InMemory and on-disk libSQL: untrusted and
  trusted create/update per key, echoes, `_status`, hooks, preview, globals, admin-style echo bumps
  `updated_at`.
- `packages/runtime/src/handlers.test.ts` — full HTTP exploit (P1) and URL variant (P2): rejected, B's
  object survives, A keeps its key, deleting A removes only A's object; multipart spoof parts.
- Versioned upload: update + restore never change `_storageKey`.
- `packages/cloudflare/test/workers/storage-lifecycle.test.ts` — the exploit and normal cleanup on real
  local D1 + R2 (workerd); timestamp/id rules on D1.
- Full gates + `test:libsql`, `test:cloudflare`, `check:api`, `release:verify`, the three consumer E2Es.

## Acceptance criteria

1. `PATCH { _storageKey }` → `400 INVALID_INPUT`, stored key unchanged — HTTP, `overrideAccess: false` and
   trusted Local API.
2. The P1 attack leaves B's object and document intact; deleting A removes A's object only.
3. P2: deleting a document without `_storageKey` deletes no object.
4. `created_at`/`updated_at` supplied on create → 400; changed on update → 400; echoes accepted and the
   adapter's stamps win (P9 fixed on libSQL/D1).
5. `id` on update: echo accepted, anything else 400. `id` on untrusted create → 400; trusted create keeps
   its explicit id (spec 062 history-adoption regression still green).
6. `_status` create/update on a drafts collection unchanged.
7. Multipart upload still records a Forge-generated `_storageKey`; spoofed form parts have no effect.
8. A `beforeChange` hook injecting any Forge-owned key fails the operation (`500`), nothing written.
9. Preview and `updateGlobalDocument` follow the same policy.
10. Versioned upload: snapshots/restore never alter `_storageKey`.
11. InMemory / libSQL / D1 agree; raw adapter documented as outside the guarantee.
12. `pnpm check:api` unchanged; gates and consumer E2Es green.

## Open questions

None.

## Outcome

Shipped as designed. Forge-owned keys are screened in `create`/`update`/`preview`/`updateGlobal` and after
every `beforeValidate`/`beforeChange` stage (collection and field hooks). The multipart upload records
its key through the package-private `createUpload`, and deletion uses only `_storageKey` (the URL
fallback is removed). No new exports; `check:api` unchanged.

Divergence from the brief: the brief suggested strict rejection of any system key in an update. Strict
rejection would have broken the first-party admin, which PATCHes the whole document it read, so an
unchanged echo (`null` counts as absent) is dropped instead of rejected (§2). The admin form was also
fixed to stop sending these keys (§9).

Review (forge-rules-reviewer + spec-reviewer): no rule violations, all criteria met, no bypass found.
The reviewers also probed:

- the echo "oracle": a caller without update access gets 403 either way;
- `__proto__` bodies;
- in-place `previousData` mutation;
- `beforeValidate` injection.

Acted on:

- added `beforeValidate` + in-place field-hook injection tests;
- documented that `null` counts as not set;
- recorded the demo settings page and the pre-existing `null`-body 500 (§10).

Evidence (2026-09-26, this branch):

- Pre-fix probe on `main`: table in "Context".
- Runtime: `system-fields.test.ts` 90 (InMemory + on-disk libSQL); HTTP exploit suite in
  `handlers.test.ts` (6); a mutation check disabling the screen fails 62 of the matrix tests. Real local
  D1 + R2 (workerd): `storage-lifecycle.test.ts` 3 (normal cleanup via the real multipart handler,
  exploit regression, timestamp/id rules).
- Gates: `format:check`, `lint` (0 errors; 4 pre-existing `@forge-cms/db` warnings), `typecheck`, `test`
  (runtime 512, admin 59, all packages green), `build`, `test:libsql` 4 (tiny-project), `test:cloudflare`
  (cloudflare 189 + tiny-project 1), `check:api` (unchanged), `release:verify` passed, `e2e:www` 19,
  `e2e:tiny-project` 10, `e2e:demo` 9 — all passed. Production D1/R2 and remote Turso **not** exercised.
