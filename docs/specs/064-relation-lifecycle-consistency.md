# 064 — Relation lifecycle consistency

- **Status:** done <!-- approved by the maintainer's task brief, which directs this exact bounded step -->
- **Author:** agent draft (explicit maintainer directive: roadmap 0.6 packet D02)
- **Date:** 2026-09-26
- **Branch:** `feature/spec-064-relation-lifecycle-consistency`
- **Affected packages/apps:** @forge-cms/db, @forge-cms/cloudflare, @forge-cms/runtime,
  @forge-cms/testing, `scripts/verify-release.mjs` (packed-consumer check), `apps/www` (its `posts.tags`
  pointed at an unregistered collection — forced by §2), docs (roadmap 0.6 D02, STATE, ARCHITECTURE,
  adapters/relations docs)

## Context / Why

Specs 058–063 made single-document writes, conditional writes, atomic batches and document + history
consistent. Relation lifecycle (roadmap D02, audit F09) is the last content invariant that still spans
several documents with no atomicity. **Reproduced on `main` (`ee25b7e`) before designing anything**
(`packages/runtime/src/relation-lifecycle.test.ts` "pre-fix evidence", run against the unfixed code):

1. **Partial cascade.** `authors ←cascade posts ←cascade comments`; author A has posts P1 (no comments)
   and P2 (comment C whose `beforeDelete` throws). `delete(A)` rejects, and the database is left as
   `{ A: exists, P1: DELETED, P2: exists, C: exists }` — P1's delete committed before C's hook ran.
2. **Concurrent reference race (real on-disk libSQL, two independent clients).** The deleter observes
   zero references to A and is held at its write; a second client creates post Q → A; the deleter is
   released. Outcome: `{ delete: committed, create: committed, authorExists: false, posts: 1 }` — a
   dangling `post.author`.
3. **Silently ignored reference shapes.** Deleting the target of a restrict-by-default reference held in
   (a) a top-level `upload` field, (b) a `relation` inside a `group`, (c) a relation field of a global —
   all three deletes **succeed**, leaving dangling references. `create({ hero: 'no-such-media' })` is
   **accepted**: nothing validates that a written relation target exists, so an orphan can be created
   directly, without any race.
4. **Localized relations cannot be written at all.** `relation({ localized: true })` stores
   `{ en: id }`, which the relation validator rejects (`Document validation failed`) on every adapter,
   while `onDelete` on such a field is silently ignored by the integrity engine.

Spec 060 §8 already named what D02 needed from storage: a cross-collection guard ("no referencing row
remains") and a rule for the 25-operation cap. This spec adds exactly that guard and moves the whole
relation lifecycle onto one atomic batch.

## Goal

A supported relation mutation — a delete with its cascade/set-null graph, or a create/update writing
relation targets — either commits every database row change together, with no surviving reference to a
deleted document and no reference to a missing one, or changes nothing; unsupported reference shapes are
refused at startup instead of being silently ignored.

## Non-goals

- No JSON-path query language; relations inside `group`/`array`/`blocks` and localized relations are
  **rejected**, not supported (§2).
- No `transaction(callback)`, `begin/commit/rollback`, raw SQL, or change to `ATOMIC_WRITE_MAX_OPERATIONS`.
  No chunking of a large cascade into several commits.
- No `onDelete` on `UploadFieldOptions`; no new field kinds; no `_revision` column.
- No change to the auth adapter's user lifecycle (`createUser`/`updateUser`/`deleteUser`), and no routing
  of relation cascades through it (spec 061).
- No DB + object-storage atomicity, durable R2 recovery (D01/D04), version retention/purge, globals first
  write (D04), H04, S3, SSR, admin/Angular changes, Strata work.
- `findOrphanedDocuments` stays diagnostic — no automatic repair.

## Design

### 1. Supported matrix

"Reference" = a stored value naming a document of another (or the same) collection.

| Shape                                                       | restrict                        | cascade                                | set-null                           | target validated on write |
| ----------------------------------------------------------- | ------------------------------- | -------------------------------------- | ---------------------------------- | ------------------------- |
| collection, top-level `relation` single                     | ✅                              | ✅                                     | ✅ (`id → null`)                   | ✅                        |
| collection, top-level `relation` `many: true`               | ✅                              | ✅                                     | ✅ (`[A,t,B] → [A,B]`)             | ✅ (one count per target) |
| self relation / cross-collection / cycles / diamonds        | ✅                              | ✅                                     | ✅                                 | ✅                        |
| collection, top-level `upload`                              | ✅ implicit, always             | — (no option)                          | — (no option)                      | ✅                        |
| global, top-level `relation` / `upload`                     | ✅ implicit restrict            | ❌ rejected at startup                 | ❌ rejected at startup             | ✅                        |
| referrer collection versioned                               | ✅                              | ✅ (history retained, spec 062 §9)     | ✅ (patch + snapshot in the batch) | ✅                        |
| referrer collection upload-enabled                          | ✅                              | ✅ (`_storageKey` cleanup post-commit) | ✅                                 | ✅                        |
| referrer collection auth-managed                            | ✅                              | ❌ rejected before mutation (061)      | ❌ rejected before mutation (061)  | n/a (auth adapter writes) |
| target collection auth-managed (e.g. `post.author → users`) | ⚠️ **not enforced** — see below | ❌ rejected at startup                 | ❌ rejected at startup             | ✅                        |
| `localized: true` relation / upload                         | ❌ rejected at startup          | ❌                                     | ❌                                 | ❌                        |
| relation / upload inside `group` / `array` / `blocks`       | ❌ rejected at startup          | ❌                                     | ❌                                 | ❌                        |
| relation / upload to an unregistered collection             | ❌ rejected at startup          | ❌                                     | ❌                                 | ❌                        |

**Auth-managed targets.** A user document can only be deleted through the auth adapter's own
`deleteUser` (spec 061 refuses generic deletes of it). That lifecycle does not consult content
relations, so a restrict reference `post.author → users` does not stop a user deletion. Writes are
still validated (a post cannot be created pointing at a missing user), and `cascade`/`set-null` onto an
auth-managed target — which could never run — are rejected at startup. Closing the delete side needs the
auth adapter to accept reference guards into its `deleteUser` batch; it is recorded as the one open cell
(Known limitations), not faked here.

### 2. Startup validation (`ForgeCmsRuntime` constructor)

`validateRelationSchema(collections, globals, isAuthManaged)` returns every problem; the constructor
throws one `Error` listing all of them (same style as `defineCollection`). Rejected:

- `relation`/`upload` with `localized: true` — message: localized references are not supported (the
  value is a per-locale map that relation integrity and the query language cannot address; such a field
  cannot currently be written either).
- `relation`/`upload` anywhere inside `group`/`array`/`blocks` (recursively) — message: nested
  references are stored inside a JSON column that Forge cannot query, so neither `onDelete` nor target
  existence can be enforced.
- `relation`/`upload` whose `collection` is not a registered collection.
- a global's relation with `onDelete` other than `restrict`.
- `onDelete: 'cascade' | 'set-null'` on a relation whose target is auth-managed.

**Migration.** A schema that used any of these now fails at startup with a message naming the field.
Persisted data is never read, rewritten or deleted by the check. Options: lift the reference to a
top-level field; or store the id in a `text`/`json` field as an explicit weak reference (no population,
no integrity); or drop the `onDelete` option. Localized references never worked through the pipeline.

### 3. Atomic primitive: `assertCount` (`@forge-cms/db`)

The smallest data-only addition to the spec-060 operation union:

```ts
export type AtomicWriteOperation<TRecord> =
  | …existing five…
  | {
      type: 'assertCount';
      collection: string;
      /** Rows to count; omitted/{} = every row. Same `DatabaseWhere` language as `findMany`/`count`. */
      where?: DatabaseWhere;
      /** The batch fails unless exactly this many rows match at this point of the batch. */
      equals: number;
    };

export type AtomicWriteResult<TRecord> = …existing… | { type: 'assertCount' };
```

| Question        | Contract                                                                                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Semantics       | Counts rows of `collection` matching `where` **as of its position in the batch**: every earlier operation of the same batch is visible, later ones are not. Writes nothing.                                                     |
| Failure         | Count ≠ `equals` → the batch rejects with `AtomicWriteConditionError` and **nothing** commits, including earlier operations. The error does not say which operation failed (D1 reports no statement index; spec 060).           |
| Malformed input | `equals` not a non-negative safe integer → `RangeError`; `where` present but not a plain object → `TypeError`; unknown column / unregistered collection → rejects on SQL adapters. All before anything is sent to the database. |
| Retry           | A failed assertion is "known rolled back" like every spec-060 error: re-read and decide again.                                                                                                                                  |
| Serialization   | libSQL `BEGIN IMMEDIATE` batch / D1 `batch()` — the count and the writes are one transaction serialized against every other writer, so the count cannot go stale before the batch commits.                                      |

SQL: one statement, `SELECT abs(CASE WHEN COUNT(*) = ? THEN 0 ELSE -9223372036854775808 END) FROM "t"
WHERE <where>` — the spec-060 overflow guard, so `toAtomicWriteError` already classifies it. InMemory:
counts the staged rows. It expresses both D02 needs:

- no reference remains: `assertCount(posts, { author: { in: [A, B] } }, 0)`; many:
  `assertCount(posts, { or: [{ tags: { containsValue: A } }, …] }, 0)`;
- every target exists: `assertCount(tags, { id: { in: uniqueIds } }, uniqueIds.length)` — one statement
  for any number of ids.

`AtomicWriteConditionError`'s message is widened to cover a failed assertion; its code is unchanged.

### 4. Target validation on create/update (and `updateGlobal`)

After `beforeChange` hooks produced the final data (the same point unique constraints are checked):

1. Collect the **written** top-level `relation`/`upload` values. On update only values that change:
   a single relation whose new value differs from the stored one; for `many`, only ids not already in
   the stored array. An update that does not touch a relation (or echoes an already-orphaned value)
   validates nothing — existing databases with historical orphans keep working.
2. Group unique ids by target collection. One `count(target, { id: { in: ids } })` each. A shortfall →
   `InvalidInputError` (400 `INVALID_INPUT`) naming the field and missing id(s), no write.
3. The write batch carries `assertCount(target, { id: { in: ids } }, ids.length)` for each target, before
   the document write (and before the snapshot for versioned collections — **one** batch, spec 062's
   `[document, snapshot]` gains the assertions; no nested/second transaction).
   - Non-versioned update with assertions uses `updateIf(id, data, {})` (not required), so a missing
     document is `applied: false` → 404 and the only possible `AtomicWriteConditionError` is an assertion.
   - An assertion failing at commit means a target vanished after step 2: `ConcurrentModificationError`
     (409). A versioned update with assertions cannot tell "document deleted" from "target deleted"
     (both are the batch's required conditions), so both map to 409 there. Initial absence is only ever
     reported from the step-2 read, never inferred from a failed batch.
   - A write without relation values keeps the existing single-call path.
4. **Re-sent references (added after review).** Values an update sends _unchanged_ are not
   target-checked, so that historical orphans stay saveable. A whole-document save (admin form) that
   read a row before a set-null delete cleared a reference, and committed after it, would silently put
   the deleted id back. So the update commits only while the row **still holds** every re-sent
   reference: `updateIf(…, { targetMatches: { and: [{ f: id }, { g: { containsValue: id } }, …] } })`
   (`echoedReferenceGuard`). A refusal is `409` if the row still exists and `404` if it is gone; a
   re-read picks which, and nothing was written either way. Versioned updates carry the same condition
   with `requireApplied`.
5. **Self reference on create.** A trusted create with an explicit `id` may reference itself. That id
   is excluded from its own target check, because the same batch creates it.

**Decisions recorded at review.**

- **Existence probe.** Target validation reads the raw database, not the target collection's read
  policy. A caller who may write a relation can therefore learn whether an id exists in a collection
  it cannot read (a `400` versus success). Ids are opaque (UUIDs by default) and the message discloses
  nothing else. Refusing the check for unreadable targets would bring back orphan writes. This is
  accepted and documented rather than solved here.
- **Hook output types.** Validation runs before `beforeChange`. A hook that writes a non-string
  relation value is neither validated nor target-checked; that ordering predates this spec.
- **Target rows must live in the content database.** A relation to a registered collection whose rows
  are kept elsewhere (an auth adapter with its own store) cannot be written. Every in-repo app keeps
  users in the same database.

### 5. Delete: plan → prepare → commit → finalize

`deleteDocument` becomes four phases; no database write happens before phase 3.

**Phase 1 — plan (reads only).** Root: `assertNotAuthManaged`, `beforeOperation`, read, access (as
before). Then a breadth-first traversal over `collection:id` keys (each scheduled at most once, so
self-references, cycles and diamonds terminate). For each document scheduled for deletion and each
top-level `relation`/`upload` field (in any collection or global) targeting its collection, the
referencing rows are read with `findMany(..., limit: MAX + 1)` (bounded — never a full scan):

- `cascade` → schedule the referrer for deletion (auth-managed referrer → reject, spec 061 message);
- `set-null` → record an edge (auth-managed → reject);
- `restrict` / upload / global → record a restrict edge.

**Final-state evaluation**, after the fixpoint: a restrict edge blocks only if its referrer **survives**
(is not itself scheduled for deletion) → `InvalidInputError` "referenced by N document(s)" (existing
message). A set-null edge from a deleted referrer is dropped; one from a survivor becomes a patch
(single → `null`; many → remove every deleted id), merged per document. A surviving `required` set-null
referrer → the existing "required … set-null" `InvalidInputError`.

**Operation count.** `deletes + set-null updates (+1 snapshot each if versioned) + reference assertions`.
Over `ATOMIC_WRITE_MAX_OPERATIONS` → `InvalidInputError` explaining the limit, **before any before-hook of
the plan and before any write**. The root's own `beforeOperation` (a side-effect hook that runs before
the root is even read, as it always has) is the one hook that precedes the check. Traversal stops early
once the scheduled deletes or set-null edges alone exceed the cap. Snapshots and assertions are added up
after traversal, and hook-written relation values of set-null dependents are re-checked just before the
batch.

**Phase 2 — prepare (hooks, validation; no writes).** In plan order, root first: each deletion runs the
existing delete preparation (dependents: `beforeOperation('delete')`, access with `overrideAccess: true`
per spec 058, `beforeDelete`); each set-null patch runs the **same** `prepareUpdate` that
`runtime.update()` uses (version number read before the document per spec 062 §3, system-field
screening, `beforeValidate`, validation, `beforeChange`), with the patch computed from the document
read here. Any failure → rejection, zero database mutation.

**Phase 3 — commit, one `atomicWrite`:**

1. set-null patches: versioned → spec 062's `[update, snapshot N+1]`; non-versioned →
   `updateIf(…, { targetMatches: { updated_at: seen } }, requireApplied)`;
2. cascaded deletes: `deleteIf(…, { targetMatches: { updated_at: seen } }, requireApplied)`; the root:
   plain `delete` (unchanged semantics);
3. reference assertions: for every (referrer collection or global, field) targeting a collection with
   deleted documents, `assertCount(referrer, <field references any deleted id>, 0)` — evaluated **after**
   the batch's own set-nulls and deletes, i.e. against the final state.

Any concurrent reference created before this batch took the write lock, any dependent changed since it
was read (CAS), or any stale traversal assumption fails the batch: `ConcurrentModificationError` (409)
naming the root, nothing written. A version-identity conflict on a dependent snapshot maps the same way.

**Phase 4 — finalize (after commit).** Storage cleanup for every deleted upload document using the
`_storageKey` captured in phase 1 (best-effort, logged without secrets, spec 063 §6 — never atomic with
the DB); then after-hooks — dependents first, root last (the pre-064 order): `afterChange` +
`afterRead`/`afterOperation` for set-null updates, `afterDelete` + `afterOperation` for deletes.

**Hooks boundary (D01).** Before-hooks run before the batch and are not rolled back: an external side
effect they performed (an email, an HTTP call) survives a later rollback. After-hooks run only if the
batch committed; an after-hook failure is reported to the caller but the committed mutation stands.

**Access (spec 058, unchanged).** Dependent cascade/set-null mutations are consequences of an authorized
root delete and run with `overrideAccess: true` — authorization bypass, never lifecycle bypass
(validation, hooks, auth-managed and system-field boundaries, version consistency all apply).

### 6. Concurrency semantics

With the root delete carrying final reference assertions and every relation write carrying target
assertions, the two batches serialize in the database:

- reference write commits first → the delete's assertion sees it → delete fails (409), nothing deleted;
- delete commits first → the writer's target assertion fails → write fails (409), nothing written.

"Both commit, reference dangles" is impossible on libSQL and D1 for supported shapes. Non-versioned CAS
uses `updated_at` (millisecond ISO timestamps): two writes to the same dependent in the same millisecond
are not distinguished — the same precision limit spec 062 records; versioned dependents use the
version-number identity instead. A row with no `updated_at` (raw legacy write) is guarded by existence only.

### 7. Public API

- `@forge-cms/db`: `AtomicWriteOperation`/`AtomicWriteResult` gain `assertCount`; `assertValidAtomicWrite`
  validates it (`where`, when present, must be a non-null, non-array object). `ATOMIC_WRITE_ASSERT_COUNT_SELECT`
  is exported next to `ATOMIC_WRITE_REQUIRE_APPLIED_SQL`, because the D1 adapter lives in another package.
- `@forge-cms/runtime`: `validateRelationSchema` export; `ConcurrentModificationError` gains an optional
  `message` constructor argument; `handleCascadeDelete`/`handleSetNullOnDelete`/`checkDeleteRestrictions` stay exported as
  low-level, **non-atomic** primitives (unchanged, marked `@deprecated`) — `runtime.delete` no longer
  uses them. `findOrphanedDocuments` also reports top-level `upload` references.
- `@forge-cms/testing/contracts`: atomic-write contract gains `assertCount` cases; new
  `runRelationLifecycleContractTests` (two-writer concurrency on one backend) with its harness helpers
  `createBatchHold`, `relationLifecycleCollections` and the `BatchHold` / `RelationLifecycle*` types.

### 8. Known limitations (stated, not hidden)

- **Auth-managed targets (open):** `deleteUser` does not consult content relations (§1).
- Remote Turso / production D1 not exercised (local workerd + on-disk libSQL only).
- D1 allows 100 bound parameters per statement, so target checks use `in` lists of at most 90 ids
  (several `assertCount`s for a larger `many` write, each counting against the 25-operation cap).
- Before-hook side effects are not transactional (D01).
- `updated_at` CAS precision (§6).
- The existence probe, hook-output types and out-of-database targets (§4 "Decisions recorded at review").

## Implementation plan

- [x] Reproduce partial cascade, libSQL race and silently ignored shapes on `main`.
- [x] `@forge-cms/db`: `assertCount` type, validation, InMemory + libSQL; D1 in `@forge-cms/cloudflare`.
- [x] Contract: `assertCount` cases in `runDatabaseAdapterAtomicWriteContractTests`.
- [x] Runtime: `validateRelationSchema` + constructor; target validation (create/update/global);
      refactor update/delete into prepare/commit/finalize; the planner; error mapping.
- [x] Relation lifecycle contract + runners on InMemory, libSQL (independent clients), D1 (workerd).
- [x] Runtime tests (matrix, failure injection, oversized, hooks, versions, uploads, orphans).
- [x] Docs, changeset, `check:api:update`, STATE/ROADMAP/0.6; full gates + E2Es.

## Test plan

Focused: `pnpm --filter @forge-cms/db test`, `--filter @forge-cms/runtime test`,
`pnpm test:cloudflare`, `pnpm test:libsql`. Then `pnpm format:check && pnpm lint && pnpm typecheck &&
pnpm test && pnpm build`, `pnpm check:api`, `pnpm release:verify`, `pnpm e2e:www`,
`pnpm e2e:tiny-project`, `pnpm e2e:demo`.

## Acceptance criteria

1. The three pre-fix reproductions pass (no partial cascade; no dangling race outcome; unsupported
   shapes rejected at startup, upload/global references enforced, missing targets rejected).
2. `assertCount` passes the shared atomic-write contract on InMemory, libSQL and D1.
3. The relation lifecycle contract (both interleavings of reference-write vs delete; concurrent set-null
   target edit; concurrent cascade reference change) passes on InMemory, on-disk libSQL with
   independent clients and local D1 with independent adapters.
4. Late dependent hook failure, dependent validation failure and injected DB failure leave every row
   unchanged; oversized cascades are rejected before any write and before every before-hook except
   the root's own `beforeOperation` (§5).
5. Versioned set-null writes exactly one matching snapshot in the same batch.
6. Existing relation/version/auth-managed/system-field tests and the three consumer E2Es stay green.
7. API baseline updated intentionally; changeset added; nothing published.

## Open questions

(none)

## Outcome

Shipped as designed:

- `assertCount` on all three adapters;
- one-batch relation deletes (plan → prepare → commit → finalize);
- target-validated relation writes on collections and globals;
- startup refusal of unsupported shapes.

Pre-fix evidence (Context §1–4) was reproduced on `main`, including the race on real on-disk libSQL and
real local D1 (both writes committed, `post.author` dangling). The same scenarios now fail safely.

**Review round** (`forge-rules-reviewer` + `spec-reviewer`). All fixed with tests:

1. A set-null dependent's hook could write an unchecked relation value. Its prepared patch now carries
   target guards, and the batch is re-capped.
2. On D1, more than ~99 new ids in one `many` write hit the 100-bound-parameter limit as a raw 500.
   `in` lists are now chunked to 90, proven on real D1 with 200 ids.
3. **High.** A non-versioned whole-document save re-sending a reference could land after a set-null
   delete cleared it, putting the deleted id back. This is the §4.4 `echoedReferenceGuard`, now a
   seventh two-writer contract scenario on all three backends. Without the guard the update never
   batches at all.
4. Create-time self reference with an explicit id.
5. Missing tests: dependent validation failure, and the upload-enabled, versioned-restrict,
   auth-managed-referrer and auth-managed-target cells.
6. Spec text aligned: §5 wording, §7 exports, AC4.
7. Recorded as decisions: the existence probe, hook-output types, out-of-database targets.

Verification (2026-09-26, uncached):

- `pnpm format:check`, `lint` (4 pre-existing `libsql.adapter.ts` warnings), `typecheck`: pass.
- `test`: 24/24 tasks — runtime 570, db 324.
- `build`: pass.
- `test:cloudflare`: cloudflare 212 + tiny-project 1.
- `test:libsql`: 4.
- `check:api`: baseline updated.
- `release:verify`: pass, with a new packed-consumer spec-064 check.
- `e2e:www` 19, `e2e:tiny-project` 10, `e2e:demo` 9.

Production D1 / remote Turso not exercised.

Deviations:

- `apps/www` had to register a real `tags` collection and seed consistent ids.
- The release fixture registered its relation target.
- The spec-040 "dangling upload is populated as null" test now creates the orphan through the raw
  adapter.

**D02 status:** every matrix cell is supported or explicitly refused, except one still open: a user
deleted through the auth adapter can leave content relations to the users collection dangling (§1).
D02 stays open until that cell is closed.
