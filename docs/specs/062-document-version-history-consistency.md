# 062 — Document and version history consistency

- **Status:** done <!-- approved by the maintainer's task brief, which directs this exact bounded step (as for specs 059–061) -->
- **Author:** agent draft (explicit maintainer directive to implement this bounded step)
- **Date:** 2026-09-25
- **Branch:** `feature/spec-062-document-version-consistency`
- **Affected packages/apps:** @forge-cms/runtime, @forge-cms/testing, @forge-cms/cloudflare (tests
  only), docs (roadmap packets D01/D03, versions/Local API docs)

## Context / Why

Roadmap packet **D03** ("keep documents and history consistent") plus the document/history slice of
**D01** ("define the mutation consistency boundary"), audit finding **F10**. Spec 060 added the
declarative `DatabaseAdapter.atomicWrite()` and recorded in its §8 that "D03's document + version
write fits one batch". This spec migrates versioned content writes onto it. It does **not** touch
relation lifecycle (D02), globals, localization certification or object storage (D04).

### Reproduced on `main` (`16655da`) before designing anything

A throwaway probe (not committed) ran the unmodified runtime on InMemory **and** on real on-disk
libSQL with independent clients per writer. Output, identical on both backends:

| Case                                                                                             | Observed before this spec                                               |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| **A1** `create()` of a versioned document; the snapshot insert fails (injected)                  | `documents persisted=1 versions=0` — a document with no history         |
| **A2** `update({ title: 'v2' })`; the snapshot insert fails                                      | `document.title=v2 versions=1 latest.title=v1` — history lags the row   |
| **B** two writers, both held at a barrier after reading the latest version number, then released | `results=fulfilled,fulfilled versionNumbers=2,2,1 document.title=B`     |
| **C** create `{ title: 'Hello', body: 'Original body' }`, then `update({ title: 'Updated' })`    | `version 2 data={"title":"Updated"}` — the "full document" is the patch |
| **D** delete document `fixed-id`, create a new one with the same caller-supplied id              | `versions=2:attacker,1:secret v1` — the new document adopts old history |
| **D′** `update({ created_at: '1999-…' })`                                                        | `created_at` is rewritten (adjacent finding, see §11)                   |

B is two bugs at once: a duplicate version identity (`2,2`) **and** a silent lost update (both
callers told "success", `B`'s write discarded `A`'s without either knowing). D is an information leak:
through HTTP, anyone allowed to create documents can supply `id` (it is a system field
`assertWritableFields` never checks), so re-creating a deleted document's id made its entire
retained history readable by the new owner.

## Goal

A versioned document mutation and its version snapshot commit as one database mutation; version
identity `(documentId, versionNumber)` is unique at the database level; competing writers against the
same history state produce one success and one explicit conflict; every automatic snapshot is the full
restorable content of the document.

## Non-goals

- D02 relation atomicity (cascade/set-null batches, cross-collection guards, the 25-operation cap).
  Cascade/set-null still call `update()`/`delete()` one document at a time, as before.
- Any object-storage (R2) transaction. `atomicWrite()` is database-only.
- A retention/cleanup feature (`maxVersions`, `retentionDays`, scheduled cleanup). §9 defines the
  current policy; the cleanup half of D03 stays open.
- Automatic retry of document updates, a `_revision` column, a new `DatabaseAdapter` method, a
  transaction callback, a sequence allocator.
- Editor autosave, history UI, visual diffs, scheduling, workflows, globals versioning.
- A migration framework. Historical duplicate version rows are detected and reported, never repaired
  (§8; recorded as an input to roadmap 0.7 / M03).
- Fixing generic system-field writes (`created_at`, `_storageKey`, caller-supplied `id`) through
  `create`/`update` — reported in §11 as adjacent findings, not changed here beyond restore.

## D01 behavior table — document/history slice

"Atomic" means one `atomicWrite()` batch: libSQL `client.batch(…, 'write')`, D1 `batch()`, InMemory
staged copy (single process only). Nothing else in this table is claimed.

| Operation                                             | Outcome                                                                                                                                                                                                        |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| versioned `create`                                    | **Atomic**: document + version 1 in one batch.                                                                                                                                                                 |
| versioned `update`                                    | **Atomic**: document patch + version N+1 (full snapshot) in one batch.                                                                                                                                         |
| `restoreVersion`                                      | Same as update (it _is_ an update): restored document + one labeled snapshot, one batch.                                                                                                                       |
| rejected by access / field access / validation / hook | Throws before any write. Neither document nor history changes. `before*` hooks that already ran are not undone.                                                                                                |
| version conflict (another writer committed first)     | Batch rolls back. `ConcurrentModificationError` (409, `CONCURRENT_MODIFICATION`). Neither changes.                                                                                                             |
| document deleted between read and write               | Batch rolls back (`update` of a missing row). `NotFoundError` (404). Neither changes.                                                                                                                          |
| snapshot insert fails for any other reason            | Batch rolls back; the original error propagates (500 over HTTP). Neither changes.                                                                                                                              |
| unique conflict on a document field                   | Batch rolls back; `UniqueConstraintError` (409) exactly as before.                                                                                                                                             |
| network/driver failure after the batch left           | Outcome unknown (spec 060 retry rule). Do not blindly retry; re-read.                                                                                                                                          |
| non-versioned `create`/`update`                       | Unchanged: one adapter write.                                                                                                                                                                                  |
| manual `createVersion`                                | One insert (atomic by itself). Version-number conflict → re-read and retry, at most 3 attempts in total, then `ConcurrentModificationError`. No hooks, no document write, snapshot unchanged between attempts. |
| `delete` of a versioned document                      | Unchanged: one document delete. History is **retained** (§9).                                                                                                                                                  |
| cascade / set-null into a versioned collection        | Each dependent `update()` is itself atomic with its snapshot; the multi-document chain is **not** atomic (D02).                                                                                                |
| upload document + R2 object                           | Not atomic; unchanged (D01/D04 compensation work).                                                                                                                                                             |

## Design

### 1. Version table: a real identity invariant (+ a snapshot-format marker)

`ForgeCmsRuntime.syncSchema()` declares, for each versioned collection's internal
`_versions_<slug>` collection, through the existing collection-level compound-index machinery
(spec 046):

```ts
indexes: [{ fields: ['documentId', 'versionNumber'], unique: true }];
```

→ `CREATE UNIQUE INDEX IF NOT EXISTS "idx__versions_<slug>_documentId_versionNumber"` on libSQL/D1,
and the same uniqueness check in `InMemoryDatabaseAdapter`. Invariant: _for one document, a version
number exists at most once._ Different documents each have their own `1, 2, …`.

It also declares one additive column, `snapshotFormat` (text). Automatic snapshots written from now on
carry `'full'`; rows written before this spec (and manual `createVersion` rows, §7) have `NULL`. It is
internal — not part of the public `Version` shape — and exists only so restore can tell a full snapshot
from a pre-062 patch (§6). Without it a restore would have to either null every field a legacy patch
did not mention (data loss) or ignore missing fields for new snapshots too (wrong for §6's
invalid-old-schema case).

`runtime.syncSchema()` is therefore **mandatory** for versioned collections — it always was part of
setup, but the guarantee now depends on it: on libSQL/D1 an unsynced collection is refused anyway
("not registered"); `InMemoryDatabaseAdapter` enforces unique indexes only for collections it was
synced with, so on InMemory without `syncSchema()` two interleaved updates can both succeed (found in
review, reproduced by the reviewer; documented rather than enforced in the write path).

Uniqueness, not gaplessness: numbers are allocated as `latest + 1` and a losing writer's number is
never committed, so today no gap is produced, but the documented guarantee is only uniqueness — a
future cleanup/retention feature may delete rows.

### 2. Versioned `create`: runtime-allocated id, one batch

`atomicWrite()` is declarative and cannot feed operation 1's generated id into operation 2, so for a
versioned collection the runtime allocates the id **before** building the batch:

- caller-supplied `data.id` that is a non-empty string → used as is (current behavior on every
  adapter: the SQL adapters use `data.id || randomUUID()`, InMemory `data.id ?? randomUUID()`);
- otherwise `crypto.randomUUID()` (what the adapters would have generated).

```text
atomicWrite([
  { type: 'create', collection: slug,             data: { ...data, id } },
  { type: 'create', collection: `_versions_<slug>`, data: { documentId: id, versionNumber: 1, data: snapshot, snapshotFormat: 'full', … } }
])
```

A new document always starts at version **1** — no read of existing history. Consequence (fixes probe
D): creating a document whose id still has retained history (a deleted document's id) now conflicts on
`(id, 1)` and is refused with the same `UniqueConstraintError` a live duplicate id gets
(`fields: ['id']`, "A document with this id already exists"); the internal table name never leaks. On
InMemory, which has no primary-key check, this is also the first time a duplicate id is refused for a
versioned collection.

Non-versioned `create` is unchanged (no id pre-allocation).

### 3. Versioned `update`: full snapshot, one batch, serialized by version identity

Order inside `update()` for a versioned collection:

```text
beforeOperation hooks
read latest version number N                       ← NEW, before the document read
read existing document
access / row policy / field-write checks
localization, auto-slug, beforeValidate, draft-status check, validation, beforeChange   (unchanged)
snapshot = restorableContent({ ...existing, ...data })
atomicWrite([
  { type: 'update', collection: slug, id, data },                                      ← patch, as before
  { type: 'create', collection: `_versions_<slug>`, data: { versionNumber: N + 1, data: snapshot, … } }
])
afterChange hooks → read tail (populate/filter/afterRead) → afterOperation hooks                 (unchanged)
```

**Why reading N first is the whole concurrency argument.** Every successful versioned mutation commits
its document write and version `N+1` together. A writer that commits version `N+1` therefore committed
it against a document read taken _after_ it observed `N` as the latest. If any other writer committed
between that observation and this commit, it committed `N+1` (or later) first, so this writer's
`(id, N+1)` insert hits the unique index and the whole batch — document patch included — rolls back.
So a commit proves the patch was applied to exactly the state the snapshot was computed from; there is
no silent lost update, and the snapshot equals the committed document's content. If the document were
read first and the version number second, a writer could read state `S0`, let another writer commit
`S1`/`N+1`, then read `N+1`, commit `N+2` computed from `S0` — a lost update the index cannot see. A
false positive is possible (a manual `createVersion` bumps `N` without changing the document) and is
accepted: it is conservative.

`updated_at` is **not** used as a concurrency token (finite clock precision, and not needed); no
`_revision` column is added. Proven on real backends (§Test plan).

Errors from the batch are mapped at the runtime boundary:

| Batch failure                                              | Runtime error                                                                           |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| db `UniqueConstraintError` on `_versions_<slug>`           | `ConcurrentModificationError` (update) / `UniqueConstraintError(slug, ['id'])` (create) |
| db `UniqueConstraintError` on the document's own table     | `UniqueConstraintError(slug, fields)` (unchanged)                                       |
| `AtomicWriteConditionError` (the `update` target vanished) | `NotFoundError`                                                                         |
| anything else                                              | rethrown unchanged                                                                      |

The versioned path requires `DatabaseAdapter.atomicWrite`; a custom adapter without it is refused
explicitly by `syncSchema()` when any collection has `versions` enabled (and by the write path itself),
never silently downgraded to two writes.

### 4. `ConcurrentModificationError` (new, `@forge-cms/runtime`)

```ts
export class ConcurrentModificationError extends ForgeError {
  // status 409, code 'CONCURRENT_MODIFICATION'
  readonly collection: string; // the public collection slug — never the internal table
  readonly id: string;
}
```

HTTP body is the standard `{ error: { code: 'CONCURRENT_MODIFICATION', message } }` (no `details`).
Existing `UniqueConstraintError` was rejected for this: its message ("A document with this
documentId/versionNumber combination already exists") and `details.collection: '_versions_posts'`
would describe an internal detail as if the caller had submitted duplicate content. `@forge-cms/angular`
already preserves any `error.code` (`CmsApiError.code`), so clients see the new code with no change.

**Retry semantics.** Forge does **not** retry a document update after a conflict: `beforeOperation`,
field and collection `beforeValidate`/`beforeChange` hooks may already have run, and they may have side
effects Forge cannot undo or safely repeat. The caller decides: re-read the document, re-apply its
intent, submit again.

### 5. `Version.data`: full restorable content

`Version.data` of an automatic snapshot is exactly:

- every field **declared** on the collection at write time, with `null` for an unset value (so a
  restore can clear a field that was empty at that version) — normal fields, relation ids, localized
  fields as their full `{ locale: value }` map, groups/arrays/blocks as stored;
- `_status`, on a `drafts: true` collection.

It never contains system/adapter metadata: `id`, `created_at`, `updated_at`, `_storageKey` (object
storage is not versioned; a restore must never repoint a document at a different stored object).
For update, the content is `{ ...existing, ...data }` — the state the batch commits (§3). The public
`Version` type is unchanged; its `data` doc comment is made precise.

### 6. Restore: the same update pipeline, now fed a diff

Restore still is `getVersion` (trusted, raw) → `update()` (spec 058 §2). Nothing restore-specific is
persisted. What changes is what `update()` receives: the snapshot is handed to `update()` internally
and turned into a patch **after** `update()`'s own version/document reads (§3), so the diff is computed
against exactly the state the batch serializes on:

1. **Target**: for a `'full'` snapshot, every currently declared field → the snapshot's value, or
   `null` when the snapshot does not have that field (it did not exist then, so the restored document
   does not have it either); plus `_status` when present on a drafts collection. For a legacy
   (pre-062 / manual) snapshot, only the declared fields (and `_status`) it contains — the pre-062
   behavior, since those rows may be patches. Unknown keys and system metadata are dropped in both
   cases, so a restore can never rewrite `id`, `created_at`, `updated_at` or `_storageKey`.
2. **Patch** = the target fields whose value differs from the current document (null/undefined and
   `Date`/ISO string compared as equal; objects compared structurally).
3. That patch goes through the unchanged access → field-write → validation → hooks pipeline; the batch
   writes it plus one snapshot labeled `Restored from version N`.

Sending only the difference keeps spec 058's field-write rule meaningful: an editor may restore a
version as long as the restore does not change a field they cannot write; with a full snapshot as the
patch, every field-level write rule would have been tested on unchanged values. A restore whose target
equals the current content still writes one labeled snapshot.

**Invalid old-schema restore:** a snapshot `{ title: 'Old' }` taken before `category` became required
targets `category: null`, which fails current validation → `ValidationFailedError`, document and
history unchanged. Old incompatible versions remain readable history; they are not valid current
documents. Validation is not weakened.

### 7. Manual `createVersion()`

Public semantics preserved: trusted Local API only (no HTTP route), no hooks, no access check, no
owner-existence check, caller `data` stored verbatim (so its rows are **not** marked `'full'`; restore
treats them like legacy snapshots). The number allocation becomes concurrency-safe: read latest →
insert `latest + 1`; on a unique conflict on `_versions_<slug>`, re-read and retry, **at most 3
attempts**, then `ConcurrentModificationError`. Retrying is safe here and only here: nothing but the
number changes between attempts, no document write is involved and no consumer code runs.

### 8. Upgrading existing databases

`syncSchema()` adds the column and index through the existing additive path (`ALTER TABLE … ADD
COLUMN`, `CREATE UNIQUE INDEX IF NOT EXISTS`). A database that already holds duplicate
`(documentId, versionNumber)` rows (possible only from the pre-062 race) cannot get the index: SQLite
refuses. `syncSchema()` then scans that version table for the duplicates and fails loudly:

```text
Cannot add the unique (documentId, versionNumber) index to "_versions_posts": it already contains
3 duplicate version identities (e.g. document "…" version 2) … ForgeCMS will not delete, renumber or
merge version history automatically. Decide which rows to keep, fix them, then restart. …
```

Nothing is deleted, renumbered or rewritten. If the index creation failed for another reason the
original error is rethrown. Recorded as an upgrade input for roadmap 0.7 / M03. InMemory is
ephemeral and has nothing to upgrade.

Pre-062 snapshots stay as they are (patches for updates). They remain listable and restorable with
their old merge semantics (§6); new snapshots are full.

### 9. Retention and deleted owners (defined, not changed)

- Versions are **retained indefinitely**. There is no automatic cleanup and no max-count policy.
- Deleting a document does **not** delete its history. The history becomes orphaned.
- Untrusted `listVersions`/`getVersion` (the HTTP routes) of a deleted owner → 404, no data
  (unchanged spec 058 behavior, now pinned for both calls).
- Trusted Local API calls still read orphaned history (they skip owner checks by design).
- `restoreVersion` of an orphaned version → `NotFoundError` (the update target is gone); nothing
  written.
- An orphaned history blocks re-creating its document id (§2). That is deliberate: re-creating must
  not adopt the deleted document's history. Consequences: a manual `createVersion()` for an id that has
  no document yet also blocks a later `create()` with that id; and a caller who may create documents
  and supply an `id` can learn that an id had history (as the primary key already reveals live ids) —
  part of the §11 system-field finding.

### 10. Hooks

```text
beforeOperation → [collection access, field access] → field/collection beforeValidate
→ validation → field/collection beforeChange → ATOMIC BATCH → afterChange → afterRead → afterOperation
```

On any batch failure: `before*` hooks have run; document and history are unchanged; `afterChange` and
`afterOperation` do not run, so no hook ever observes a mutation that did not commit. A database
rollback cannot undo external effects a `before*` hook performed. Hooks are never moved inside the
batch (it is declarative data, not a callback).

Consequence for hook authors: a `before*` hook that itself calls `update()` on the **same** versioned
document commits a version first, so the outer update then fails with `ConcurrentModificationError`.
Mutate `data` in the hook instead.

### 11. Autosave and adjacent findings (recorded, not fixed)

- `versions: { autosave: true }` is **inert**: nothing reads it at runtime (`autosaveEnabled()` is
  exported but unused). Automatic snapshots always have `autosave: false`; only manual
  `createVersion({ autosave: true })` sets the flag. Unchanged. Follow-up: either implement or
  reject the option (D04-style "accepted-but-inert" matrix).
- **Security (confirmed, not fixed here):** generic `create`/`update` accept the system keys `id`
  (create), `created_at`, `updated_at` and `_storageKey` from any caller allowed to write the document,
  including over HTTP (`assertWritableFields` only checks declared fields; validation lists them as
  system fields). Probe D′ rewrote `created_at`. A second throwaway probe, over HTTP as an `editor`
  (`PATCH /api/v1/media/:id` with `{ "_storageKey": "private/victim.pdf" }` → `200`, then
  `DELETE` → `204`), deleted the **other** stored object `private/victim.pdf` and left the document's own
  file in place: anyone with update + delete access on one upload document can delete arbitrary objects
  in the bucket. Restore no longer writes any of these keys (§6); closing the generic path is the
  recommended next bounded step (see Outcome).
- `InMemoryDatabaseAdapter.create` does not enforce primary-key uniqueness (SQL adapters do).
- `Version.label` is `null` on the SQL adapters for an unlabeled version (typed `label?: string`; absent
  on InMemory) — pre-existing parity nit.
- The public raw fallback of `handleCascadeDelete`/`handleSetNullOnDelete` (no `mutator`) wrote
  documents straight through the adapter; for a versioned collection that would commit a change with
  no version row and break §3's serialization. It now refuses a versioned target (found in review; the
  only relation-code change here). `operations.ts` always passes a real mutator, so normal deletes are
  unaffected.

## Implementation plan

- [x] Probe the three failure modes on InMemory + libSQL before changing code
- [x] `errors.ts`: `ConcurrentModificationError`; export it (`index.ts`)
- [x] `versions.ts`: version collection definition (unique index + `snapshotFormat`), snapshot
      builder, restore target/diff, latest-number read, retrying manual `createVersion`, duplicate scan
- [x] `operations.ts`: versioned create/update through `atomicWrite`, error mapping, restore via diff
- [x] `runtime.ts`: `syncSchema()` uses the shared version collection, requires `atomicWrite`, reports
      historical duplicates
- [x] `@forge-cms/testing/contracts`: `runVersionHistoryContractTests` (duck-typed, gate-driven)
- [x] Runtime tests (InMemory + on-disk libSQL), real local D1 tests, invalid old-schema restore,
      full snapshot, deleted owner, upgrade with duplicates
- [x] Changesets, API baseline, docs (STATE, ARCHITECTURE, roadmap 0.6, www versions/Local API docs)

## Test plan

- `packages/runtime/src/version-consistency.test.ts` — InMemory: snapshot completeness (multi-type
  collection incl. localized, relation, boolean/select, group, drafts), restore exactness, invalid
  old-schema restore, hook ordering on commit/rollback, deleted-owner semantics, id re-creation,
  manual `createVersion` retry, HTTP 409 envelope, non-versioned path unchanged.
- `@forge-cms/testing/contracts` `runVersionHistoryContractTests` run on:
  InMemory (runtime tests), real on-disk libSQL with an independent client per writer (runtime tests),
  real local D1 in workerd with an independent adapter per writer (`packages/cloudflare`,
  `pnpm test:cloudflare`). Covers: DB-level uniqueness, create/update/restore rollback on a snapshot
  conflict injected _inside_ the batch, deterministic two-writer update (both held at the write gate
  after every read), manual `createVersion` race, history == document afterwards.
- SQL-only non-constraint fault: a `BEFORE INSERT` trigger on the version table raising an error,
  proving rollback for a failure that is not a unique conflict (libSQL + D1).
- Upgrade: an old-shape version table seeded with duplicates → `syncSchema()` fails with the
  actionable message and leaves rows untouched (libSQL + D1).

## Acceptance criteria

1. Versioned create = one batch (document + version 1); injected snapshot failure leaves no document.
2. Versioned update = one batch; injected snapshot failure leaves the previous document and history.
3. Restore inherits both through `update()`; a failed restore changes neither.
4. `(documentId, versionNumber)` is unique at the database level on InMemory/libSQL/D1.
5. Two gated concurrent versioned updates: exactly one succeeds, the other gets
   `ConcurrentModificationError`; history numbers unique; latest snapshot == committed document.
6. `Version.data` of an automatic snapshot contains every declared field and no system metadata.
7. Restore never rewrites `id`/`created_at`/`updated_at`/`_storageKey`.
8. Invalid old-schema restore → validation error, nothing changed.
9. Spec 058 access tests and spec 061 auth-managed tests still pass unchanged.
10. `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`,
    `pnpm test:libsql`, `pnpm test:cloudflare`, `pnpm check:api`, `pnpm release:verify`, consumer E2Es.

## Open questions

None.

## Outcome

Shipped as designed. Versioned create/update/restore are one `atomicWrite()` batch; `_versions_<slug>`
has the unique `(documentId, versionNumber)` index and a `snapshotFormat` marker; conflicts surface as
`ConcurrentModificationError`; snapshots are full content; restore is a diff through `update()`.

Divergences from the brief, all deliberate:

- **Snapshot-format marker column** (§1). Not asked for; needed so full-snapshot restore semantics
  (missing field → `null`, which is what makes invalid-old-schema restore fail validation) do not null
  out fields when restoring pre-062 _patch_ snapshots.
- **Restore sends only the changed fields** (§6) rather than the whole snapshot, so spec 058's field-write
  rule keeps its meaning with full snapshots.
- **Versioned create always writes version 1** (no latest read), which also closes probe D (history
  adoption by id reuse) — at the cost of refusing to re-create an id whose history is retained.
- `ConcurrentModificationError` for a lost race; a concurrently _deleted_ document maps to `NotFoundError`.

Review (forge-rules-reviewer + spec-reviewer): no rule violations; all acceptance criteria met. Acted
on: raw relation fallback now refuses versioned targets (+ test), `Version` doc comment in
`@forge-cms/core` made precise (+ patch changeset), InMemory `syncSchema()` dependency, hook
re-entrancy and id-blocking consequences documented (§1, §9, §10), `label: null` parity recorded (§11).

Evidence (2026-09-25, this branch):

- Pre-fix probe on `main` (InMemory + on-disk libSQL): table in "Context".
- `runVersionHistoryContractTests` — InMemory 9, libSQL on-disk with independent clients 10 (incl.
  trigger), real local D1/workerd with independent adapters 10 (incl. trigger); plus D1 upgrade 2 and
  libSQL upgrade 2. Two-writer result on all three: one fulfilled, one `CONCURRENT_MODIFICATION`, row ==
  winner, history `[2, 1]` with `version 2 = full content`.
- Mutation check: swapping the version/document reads in `update()` makes the read-ordering test fail
  (writer B's lost update succeeds), restored afterwards.
- Gates: `pnpm format:check`, `lint` (0 errors; 4 pre-existing warnings in `@forge-cms/db`, untouched),
  `typecheck`, `test` (all packages; runtime 416), `build`, `test:libsql` (4, tiny-project — it has no
  versioned collection), `test:cloudflare` (cloudflare 187 + tiny-project 1, freshly executed),
  `check:api` (intended additions only), `release:verify` (incl. a new spec 062 packed-consumer check),
  `e2e:www` 19, `e2e:tiny-project` 9, `e2e:demo` 9 — all passed. No consumer app enables `versions`, so
  the E2Es are regression evidence only. Production D1 and remote Turso were **not** exercised.

Remaining: retention **cleanup** (no mechanism; product decision), `versions.autosave` inert, the §11
system-field write finding (recommended next bounded step), D02, D04.
