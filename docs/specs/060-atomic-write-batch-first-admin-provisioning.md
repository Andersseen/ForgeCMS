# 060 — Atomic write batches and first-admin provisioning consistency

- **Status:** done <!-- approved by the maintainer's task brief, which directs this exact implementation -->
- **Author:** agent draft (explicit maintainer directive to implement this bounded step)
- **Date:** 2026-09-19
- **Branch:** `feature/spec-060-atomic-write-batch`
- **Affected packages/apps:** @forge-cms/db, @forge-cms/cloudflare, @forge-cms/auth,
  @forge-cms/testing, `scripts/verify-release.mjs` (packed-consumer check), docs (roadmap packet H01
  follow-up, H02 provisioning half, D01 groundwork)

## Context / Why

Spec 059 proved that a single guarded write closes the last-admin race, and recorded what it cannot
do: it cannot make two writes succeed or fail together. It also reproduced the first concrete bug that
needs exactly that (059 "Adjacent findings"): `UsersCollectionAuthAdapter` commits the spec-058
`_forge_bootstrap` claim and _then_ creates the first user. If the second write fails, the claim stays
forever with no administrator behind it — `hasAnyUser()` is false, no later caller can win the claim,
every later signup becomes `viewer`.

**Reproduced again on `main` (`29643d1`) before designing anything**
(`packages/auth/src/first-admin-provisioning.test.ts`, run against the unfixed code): with user creation
forced to fail, `users` ends with 0 rows and `_forge_bootstrap` with **1**; the retry with a valid first
user then becomes a `viewer`. Both `signup` and `createUser` are affected.

This spec adds the smallest storage primitive that fixes it and that spec 059 §7 named as the next step:
a declarative, data-only **atomic write batch**. It is the storage capability D02 (relation cascades) and
D03 (document + version) will need; neither is implemented here.

## Goal

An ordered list of database writes either all commit or none do, identically on InMemory, libSQL and
D1 — and first-admin provisioning uses it, so a failed first-user creation can never leave a consumed
bootstrap claim behind.

## Non-goals

- No `transaction(async tx => …)` callback, ORM transaction context, interactive transaction, or any way
  to run application code, hooks, HTTP, logging or other async work between the batch's statements.
- No raw SQL exposed to consumers.
- **Nothing that spans object storage.** A batch is database-only. D1 + R2 (or libSQL + S3) can never
  commit atomically together; upload lifecycle work must use compensation/recovery (roadmap D01/D04).
- No D02 (relation cascade/set-null) or D03 (document + version) migration; both are only _evaluated_
  (§8). No schema migrations, no new adapters, no SSR/S3/GraphQL/plugins/admin features.
- Does not close the generic users-collection CRUD bypass (H02's other half) — recorded honestly under Known limitations.
- No automatic repair of an already-burned bootstrap claim (§6 explains why that would be unsafe).
- Does not rewrite specs 058/059; cross-references only.

## Verified starting point (`main` at `29643d1`)

- `DatabaseAdapter` has `findById`, `findMany`, `count`, `create`, `update`, `delete`, `updateIf`,
  `deleteIf`, `syncSchema`. Three implementers (InMemory, libSQL, D1); no other implementation or test
  double of the interface exists in the repo, so a required-method addition has a three-file blast radius
  (typecheck confirms this after the change).
- `claimFirstAdminBootstrap` → `create('_forge_bootstrap', { slot })` and the user `create()` are two
  independent committed writes. The claim is a unique-index row (`slot` = the users-collection slug).
- Installed clients (checked in `node_modules`, not from memory): `@libsql/client` **0.17.3**,
  `drizzle-orm` **0.45.2**, D1 exercised through Miniflare/workerd via `@cloudflare/vitest-plugin`.

### Backend guarantees (primary sources, checked 2026-09-19)

- **D1 `batch()`** (developers.cloudflare.com/d1/worker-api/d1-database): "Batched statements are SQL
  transactions. Our implementation guarantees that each statement in the list will execute and commit,
  sequentially, non-concurrently." "If a statement in the sequence fails, then an error is returned for
  that specific statement, and it aborts or rolls back the entire sequence." Results: "each object is in
  the array position corresponding to the array position of the initial statement". The page does not say
  how the error is shaped or limit the statement count (D1's separate platform limits apply). **Observed
  on real local D1 (workerd):** a failing statement rejects the whole `batch()` with
  `Error("D1_ERROR: <sqlite message>: SQLITE_…")` — no statement index — and earlier statements' effects
  are gone; `RETURNING` rows come back in `results`.
- **libSQL `client.batch(stmts, mode)`** (docs.turso.tech/sdk/ts/reference): `"write"` = `BEGIN
IMMEDIATE` ("may execute statements that read and write data"); the batch is "all-or-nothing: success
  commits all changes, any failure results in a full rollback". Result order is not stated in the docs;
  **read from the installed source** (`lib-esm/sqlite3.js`): `BEGIN`, execute statements in array order
  pushing each `ResultSet`, `COMMIT`; on any error a `finally` issues `ROLLBACK`, and the failure is a
  `LibsqlBatchError` carrying `statementIndex`. `"deferred"` is the default when no mode is passed.
- **Consequence for the implementation:** `drizzle-orm` 0.45.2's `db.batch()` calls
  `client.batch(statements)` with **no mode**, i.e. `"deferred"`. Forge therefore builds statements with
  drizzle's `.toSQL()` and calls `client.batch(statements, 'write')` directly, so the write lock is taken
  up front instead of upgraded at the first write.
- **The abort trick (§4, "Guard") was spiked on both real backends first**: a statement that raises an error when
  the previous statement changed no row (`SELECT abs(CASE WHEN changes() = 0 THEN -9223372036854775808
ELSE 0 END)`) aborts the whole batch and rolls everything back on libSQL (`statementIndex` names the
  guard) and on local D1. This is what makes `requireApplied` and plain `update` sound without an
  interactive transaction.
- Remote Turso and remote (production) D1 are the same SQLite engine and the documented transactional
  batch, but are **not exercised** by this repo's tests.

## Design

### 1. Choosing the shape from the invariants

Needs, in order of concreteness:

1. **Now:** `[create claim, create admin]` — two creates that commit together.
2. **Next (D03):** `[update document (compare-and-set on its version), create snapshot]` — the snapshot
   must not commit if the document write is refused.
3. **Next (D02):** `[delete parent (guarded), update child set-null, …]` — the dependents must not
   commit if the guarded parent delete is refused.

(2) and (3) are why a conditional write inside a batch must be able to abort the batch. A batch in which
`updateIf` merely reports `applied: false` while the later `create` commits anyway is unusable for exactly
the invariants the primitive exists for. So conditional operations reuse spec 059's `WriteCondition`
unchanged and gain one optional flag, `requireApplied`. No second condition language.

Rejected: a callback transaction (D1 has none; invites long read→decide→write windows and network calls
inside the transaction), a sequence of independent calls with compensation (not atomic; a crash between
calls leaves the partial state — the very bug), and an interactive libSQL transaction (D1 cannot do it, so
it would not be portable).

### 2. Public API (`@forge-cms/db`)

The operations mirror the existing adapter methods one to one, so "a batch of X is calling X in order,
atomically" is the whole explanation.

```ts
export type AtomicWriteOperation<TRecord extends DatabaseRecord = DatabaseRecord> =
  | { type: 'create'; collection: string; data: TRecord }
  | { type: 'update'; collection: string; id: string; data: Partial<TRecord> }
  | { type: 'delete'; collection: string; id: string }
  | {
      type: 'updateIf';
      collection: string;
      id: string;
      data: Partial<TRecord>;
      condition: WriteCondition;
      requireApplied?: boolean;
    }
  | {
      type: 'deleteIf';
      collection: string;
      id: string;
      condition: WriteCondition;
      requireApplied?: boolean;
    };

export type AtomicWriteResult<TRecord extends DatabaseRecord = DatabaseRecord> =
  | { type: 'create'; record: TRecord }
  | { type: 'update'; record: TRecord }
  | { type: 'delete' }
  | ({ type: 'updateIf' } & ConditionalUpdateResult<TRecord>)
  | ({ type: 'deleteIf' } & ConditionalDeleteResult);

/** Upper bound on operations per batch. */
export const ATOMIC_WRITE_MAX_OPERATIONS = 25;

/** Thrown when an operation that had to apply did not: its target row was missing or its condition failed. */
export class AtomicWriteConditionError extends Error {
  readonly code = 'ATOMIC_WRITE_CONDITION_FAILED' as const;
}
export function isAtomicWriteConditionError(err: unknown): err is AtomicWriteConditionError;

interface DatabaseAdapter<TRecord> {
  // …existing members unchanged…
  atomicWrite(
    operations: readonly AtomicWriteOperation<TRecord>[]
  ): Promise<AtomicWriteResult<TRecord>[]>;
}
```

Also exported for the two SQL adapters, which live in different packages: `assertValidAtomicWrite`,
`toAtomicWriteError`, `atomicWriteMustApply` (which operations must be followed by the guard statement),
`ATOMIC_WRITE_REQUIRE_APPLIED_SQL` (same reason `assertValidWriteCondition` and
`toUniqueConstraintError` are). `atomicWrite` is a **required** member (same rationale as spec 059: an
adapter that cannot make a batch atomic cannot back first-admin provisioning safely; a compile-time break
is more honest than a runtime surprise). `UsersCollectionAuthAdapter.init()` additionally fails
explicitly, at construction, for an untyped/JS `userDatabase` lacking it.

### 3. Exact semantics

| Question                | Contract                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Atomicity               | If every operation completes, all their effects commit together; if any required step fails, **none** of them is persisted. Not "compensated afterwards": the database (SQL) or a staged copy (InMemory) never publishes a partial state.                                                                                                                                                    |
| Order                   | Operations execute in array order. A later operation observes the state produced by earlier ones in the same batch (e.g. `create` then `update` of that id; a `targetMatches` that reads what a previous op wrote). The caller supplies ids it needs to reference (`create` accepts `data.id`); a generated id is only known from the result.                                                |
| Results                 | On success, one result per operation, **same order and length** as the input, discriminated by `type`. Records are hydrated exactly as the equivalent single call returns them (`create`/`update`/`updateIf`). An empty batch returns `[]` and touches nothing.                                                                                                                              |
| `create`                | Unique-index violation (including between two operations of the same batch) rejects the batch with `UniqueConstraintError`; its `collection` names the table that conflicted.                                                                                                                                                                                                                |
| `update`                | Mirrors `update()`: `id` in `data` is ignored; a **missing row fails the batch** with `AtomicWriteConditionError` (`update()` throws for a missing row too). Unique violation → `UniqueConstraintError`.                                                                                                                                                                                     |
| `delete`                | Mirrors `delete()`: deleting a missing row is a successful no-op.                                                                                                                                                                                                                                                                                                                            |
| `updateIf` / `deleteIf` | Same semantics as spec 059 for one row. Not applied (row missing or condition false) is `applied: false` — a valid result and the batch **still commits its other operations** — unless `requireApplied: true`, which makes it fail the batch. A failed condition wins over a would-be unique conflict (constraints only apply to a row actually written).                                   |
| `requireApplied: true`  | If the operation does not apply, the batch rejects with `AtomicWriteConditionError` and nothing commits, including operations before it. Default `false`. "Missing" and "refused" are not distinguished (as in 059).                                                                                                                                                                         |
| Invalid input           | Non-array, more than `ATOMIC_WRITE_MAX_OPERATIONS` operations (`RangeError`), unknown `type`, malformed operation (`TypeError`), bad `keepAtLeast.others` (`RangeError`), unregistered collection or unknown column (SQL adapters) — all reject **before anything is sent to the database**. `InMemoryDatabaseAdapter` does not check column names or registration (as for all its methods). |
| Database failure        | Any other failure rejects the batch (never converted into a result). SQL backends roll the transaction back, so nothing is persisted.                                                                                                                                                                                                                                                        |
| Independent writers     | On libSQL and D1 the transaction serializes against every other writer of the database (SQLite single-writer; D1 processes a database's queries one at a time), so racing batches behave as if run one after the other. InMemory: one synchronous turn — one adapter instance/process only.                                                                                                  |
| Not guaranteed          | Atomicity with anything outside the database (object storage, hooks, HTTP); visibility on read replicas; exactly-once delivery; any guarantee on unverified backends (remote Turso, production D1).                                                                                                                                                                                          |

**Retry.** `UniqueConstraintError` and `AtomicWriteConditionError` mean "known rolled back": nothing was
persisted, so retrying with changed input / after re-reading is safe. A validation rejection sent nothing.
A database error reported by the engine is a rollback too. A network/timeout failure after a request left
the process is **outcome unknown** — the batch may have committed; do not blindly retry non-idempotent
batches. Callers that must retry should supply their own unique keys (on the SQL adapters, ids too — see the InMemory note under Known limitations) so a retry that hits
`UniqueConstraintError` is recognisable as "already applied". No exactly-once promise.

### 4. Adapter implementations

- **libSQL**: every operation becomes one parameterized statement built with drizzle's `.toSQL()`
  (`INSERT … RETURNING *`, `UPDATE … WHERE <write condition> RETURNING *`, `DELETE … [RETURNING id]`),
  reusing `buildCreateRecord`/`buildUpdateValues`/`buildWriteCondition` so encoding, `id` immutability,
  timestamps and condition semantics are literally the single-call code. Executed with one
  `client.batch(statements, 'write')`. Statements that must apply (`update`, `updateIf`/`deleteIf` with
  `requireApplied`) are followed by the guard statement. Driver errors go through `toAtomicWriteError`.
  Rows are hydrated with the existing `hydrateRecord`.
- **D1**: same statements as prepared SQL with bound parameters, executed with one `db.batch(...)`.
  No sequential `run()`.
- **Guard** (`ATOMIC_WRITE_REQUIRE_APPLIED_SQL`): `SELECT abs(CASE WHEN changes() = 0 THEN
-9223372036854775808 ELSE 0 END)` — `changes()` is the row count of the statement just before it, in
  the same connection/transaction; `abs()` of the minimum integer raises "integer overflow", which aborts
  the batch and rolls it back. `toAtomicWriteError` recognises it (and unique-constraint messages, using
  the table named in SQLite's message) by walking the `cause` chain. The classifier matches on the
  engine's message alone: no Forge statement performs arithmetic, so a genuine overflow cannot come from
  the statements Forge emits — but that is a property of the SQL generator, not of the classifier (see
  Known limitations); no operation index is reported because
  D1's error carries none.
- **InMemory**: staging, not compensation. `atomicWrite` validates, copies the arrays of the collections
  it touches, applies every operation to the **staged** arrays with the same private helpers the
  single-call methods use (so semantics cannot drift), and publishes all staged arrays back in one step
  only if every operation succeeded; any throw discards the stage. It is fully synchronous between
  staging and publishing, so it is atomic against other calls on that instance. Also fixes
  `update()` rewriting a row's primary key (spec 059 adjacent finding (b)) — the batch `update` must ignore
  `id` like SQL, and one shared helper serves both.

### 5. First-admin provisioning (`UsersCollectionAuthAdapter`)

Both `createUser` and `signup` now share one private path:

1. Existing validation and the `email-in-use` pre-check (unchanged); hash the password.
2. If the collection already has a user → ordinary `create()` (role from input for `createUser`, `viewer`
   for `signup`) — unchanged.
3. Otherwise **one `atomicWrite`**: `[create _forge_bootstrap { slot }, create <users> { …, role: 'admin' }]`.
   - Both succeed → this caller is the first admin; claim and admin exist together.
   - `UniqueConstraintError` on `_forge_bootstrap` → another caller won; nothing of this batch persisted;
     fall back to the ordinary `create()` as a non-admin.
   - `UniqueConstraintError` on the users collection (duplicate email) → the claim is rolled back too;
     `email-in-use`; the bootstrap opportunity is intact.
   - Any other failure rethrows; nothing persisted, so the next attempt can still become the admin.
4. The claim-only `claimFirstAdminBootstrap` and its two-step ordering are deleted.

The claim row keeps its shape (`{ slot: <users collection> }`); no schema change, so pre-060 databases
work unmodified.

### 6. Pre-existing burned claims (compatibility)

A database written before this spec can hold `_forge_bootstrap` **claim present, zero admins** (claim
burned by a failed first create). Behaviour after this spec, deliberately:

- **Public signup never becomes admin in that state.** The claim exists, so the atomic batch loses and
  the caller is a `viewer` — exactly as before. Automatic repair (delete the claim when there are no
  admins, then let signup re-claim) is rejected: it is an unguarded read-then-write, and "claim present,
  no admin" is also what a deliberately emptied admin set looks like, so auto-promotion would turn
  "the last admin was removed" into an open door for the next anonymous signup. The repair would need a
  cross-collection guard (claim delete conditional on the users collection), which `WriteCondition`
  (same-collection) does not have and this spec does not add.
- **Recovery is an explicit trusted-server operation that does not touch the claim:**
  `auth.createUser({ email, password, role: 'admin' })` (works with zero users — a lost claim honours the
  requested role) or `auth.updateUser(existingId, { role: 'admin' })` for a viewer that already signed
  up. Once any admin exists, ordinary rules apply (the claim's only job is to break the public-signup
  tie). Neither is reachable over HTTP without an admin, by design. Documented in `docs/STATE.md` and the
  auth docs; covered by tests on every backend.

### 7. Test strategy

- **Shared contract** — new `runDatabaseAdapterAtomicWriteContractTests(createAdapter, options?)` in
  `@forge-cms/testing/contracts`, run on InMemory, real libSQL and real local D1 (workerd). Covers commit,
  result order, every rollback shape (create/update/delete then a failure), unique conflicts inside and
  across operations, ordered visibility, missing update/delete, `applied: true/false`, `requireApplied`,
  a `keepAtLeast` guard inside a batch, invalid input leaving no partial write, hydration parity with the
  single calls, id immutability, the operation cap, and two racing batches (exactly one commits; the
  loser's other rows are absent). `options.rejectsUnknownColumns` (default true; false for InMemory).
- **Bootstrap contract** — new `runFirstAdminBootstrapContractTests(setup)`: concurrent first signups on
  separate adapter instances (InMemory: one shared store with separate `UsersCollectionAuthAdapter`s — a second
  `InMemoryDatabaseAdapter` would be a second store) held at a barrier (distinct emails: exactly one admin, others viewer, one
  claim; same email: one ok, others `email-in-use`, one user and one claim), the exact regression
  (claim would succeed, user creation fails → no user, no claim; retry becomes admin; both a unique
  failure and a non-unique mid-batch failure), and the burned-claim compatibility cases. `WriteGate` now
  also holds `create` and `atomicWrite`, so the barrier sits exactly on the first-admin batch.
- **Adapter-specific**: libSQL asserts one `client.batch(…, 'write')` and no `execute`; D1 asserts one
  `db.batch()` and no per-statement `run()`, bound-parameter order, and error mapping; auth asserts the
  first-admin path issues one `atomicWrite` and no standalone claim write.
- **Regression first**: `first-admin-provisioning.test.ts` was written and shown failing before the fix.

### 8. Sufficiency for later invariants (evaluation only — nothing migrated)

| Need                                 | Sufficient? | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First-admin claim + user             | **Yes**     | This spec.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D03 document update + version insert | **Yes**     | `[updateIf(doc, { targetMatches: { updated_at: seen } }, requireApplied), create(version)]` commits together or not at all; a concurrent writer makes the CAS fail and no snapshot is written. Version _numbering_ still needs a unique `(document, version)` index + retry (the batch reports the conflict as `UniqueConstraintError`). Hooks/access/validation stay outside, before the batch.                                                                                                                           |
| D02 restrict/cascade/set-null        | **Partly**  | The dependent writes (N deletes/updates, each optionally conditional) can be one batch, decided by traversal/policy/hooks **outside** the transaction. Gaps: (a) a cross-collection guard ("delete parent only if no referencing row remains") — `WriteCondition` is same-collection, so a reference created between traversal and commit is not caught; (b) the 25-operation cap means large cascades need chunking or explicit rejection; (c) hooks that ran before the commit cannot be un-run. D02 needs its own spec. |
| DB + object storage (uploads)        | **No**      | By definition not database-only. Needs compensation with durable recovery (D01/D04).                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### Known limitations (stated, not hidden)

- **Generic users-collection CRUD still bypasses lifecycle invariants** (`PUT/DELETE /api/v1/users/:id`,
  `runtime.update/delete` on the users collection go through the content pipeline, not
  `UsersCollectionAuthAdapter`) — the remaining H02 audit item, deliberately not touched here.
- InMemory atomicity is per adapter instance/process; not durable.
- Remote Turso / remote D1 are not exercised; real-D1 evidence is same-isolate on local D1. That
  separate isolates against production D1 serialize rests on Cloudflare's documented "processes queries
  one at a time" and transactional `batch()`.
- **Classification is by message.** Any engine-produced "integer overflow" in a batch's `cause` chain
  becomes `AtomicWriteConditionError`. Only the error _type_ could mislead (the batch rolled back either
  way), and `packages/db/src/atomic-write.test.ts` pins what is and is not recognised.
- The guard relies on SQLite's `changes()` and `abs()` overflow error, verified on libSQL 0.17.3 and
  local D1; a future backend that changed either would fail the shared contract, not silently pass.
- **InMemory accepts a duplicate primary key** (`create` with an existing `id` succeeds; libSQL and D1
  reject it) — pre-existing, found while checking retry advice, not fixed here. It is why "supply your own
  ids so a retry is recognisable" is stated for the SQL adapters only; a unique-indexed key works everywhere.
- The cap of 25 is a product decision, not a backend limit; D1's separate per-query bound-parameter and
  per-invocation query limits still apply.

## Implementation plan

- [x] Reproduce the burned claim with a failing regression test on `main` (before any design).
- [x] Spike the in-database abort guard on real libSQL and real local D1.
- [x] Write this spec.
- [x] `@forge-cms/db`: types, `AtomicWriteConditionError`, validation, `toAtomicWriteError`, guard SQL; InMemory staging + `update` id fix; libSQL `client.batch(…, 'write')`.
- [x] `@forge-cms/cloudflare`: D1 `db.batch()`.
- [x] `@forge-cms/testing`: atomic-write contract, bootstrap contract, gate covers `create`/`atomicWrite`.
- [x] Wire the contracts into InMemory, libSQL (independent clients) and D1 (workerd) tests; adapter-specific tests.
- [x] `@forge-cms/auth`: single-`atomicWrite` first-admin path; `init()` capability check; burned-claim tests.
- [x] `pnpm check:api:update`, changeset, docs (`ARCHITECTURE.md`, `adapters.md`, `STATE.md`, `0.6`, cross-references in 058/059), spec Outcome.
- [x] Full gates, `test:cloudflare`, `test:libsql`, `release:verify`, consumer E2Es.

## Test plan

See §7. Focused loops: `pnpm --filter @forge-cms/db test`, `--filter @forge-cms/auth test`,
`--filter @forge-cms/cloudflare test`, `pnpm test:cloudflare`, `pnpm test:libsql`; then the full gate list
and the three consumer E2Es.

## Acceptance criteria

1. `DatabaseAdapter.atomicWrite` exists with the §2 signature; all three adapters implement it; the types,
   error, cap and helpers are exported from `@forge-cms/db`.
2. `runDatabaseAdapterAtomicWriteContractTests` passes on InMemory, real libSQL and real local D1.
3. libSQL runs one `client.batch(…, 'write')` per batch and D1 one `db.batch()`; neither issues per-statement
   calls (asserted by tests).
4. `create` claim + failing user creation leaves no claim and no user, then the retry becomes admin — on
   InMemory, real libSQL and real D1, for both `signup` and `createUser`, for a unique and a non-unique failure.
5. N concurrent first signups on independent auth adapters (independent database adapters/connections on
   libSQL and D1; one shared store on InMemory) yield exactly one admin on all three backends
   (deterministic barrier), including the same-email case.
6. A pre-existing burned claim never auto-promotes a public signup; the documented trusted recovery works.
7. `check:api` baseline updated intentionally; changeset added; no manual version bump; nothing published.
8. `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`, `pnpm test:cloudflare`,
   `pnpm test:libsql`, `pnpm check:api`, `pnpm release:verify` green; consumer E2Es reported honestly.

## Open questions

(none)

## Outcome

Shipped as designed: `DatabaseAdapter.atomicWrite` (five operations mirroring the existing methods, plus
`requireApplied`), implemented as a staged copy on InMemory, one `client.batch(statements, 'write')` on
libSQL and one `batch()` on D1; first-admin provisioning is one `atomicWrite` of `[claim, admin]`. The
failed-first-creation bug is fixed and proven on InMemory, real on-disk libSQL (independent clients) and
real local D1 (workerd); the same tests fail against the old two-step flow (13 tests on InMemory+libSQL,
6 on D1). Verification results are in `docs/STATE.md`'s spec 060 entry.

Deviations and things learned while building it, none changing the design:

1. **The bug was reachable without any infrastructure failure.** Running the new bootstrap contract
   against the restored pre-060 flow showed the "same email racing to be first" scenario also failing on
   real libSQL and real D1 (not on InMemory): the caller that lost the claim inserted the shared email
   first, so the caller holding the claim failed on the unique email — a claim with no admin, from a plain
   double-submit of the first signup. Spec 059 only reproduced it with a forced failure.
2. **`drizzle-orm` 0.45.2's `db.batch()` runs `BEGIN DEFERRED`** (it passes no mode to `client.batch`),
   so the libSQL adapter builds statements with `.toSQL()` and calls `client.batch(…, 'write')` itself.
3. **D1's batch error has no statement index** (libSQL's `LibsqlBatchError` does). The public error
   therefore carries no operation index on any adapter, and the guard is recognised by message.
4. **The abort guard** (`changes()` + `abs(min-int)` overflow) was spiked on both real backends before the
   API was settled; without it neither `requireApplied` nor plain `update` could fail a D1 batch, since D1
   has no interactive transaction.
5. **`createWriteGate` now also holds `create` and `atomicWrite`** (it previously held only updates and
   deletes), so the barrier sits on the first-admin batch. Existing last-admin scenarios are unaffected.
6. **`InMemoryDatabaseAdapter.update()` no longer rewrites a row's primary key** (spec 059 adjacent finding
   (b)), because the batch `update` shares its helper and must ignore `id` like SQL. Called out in the changeset.
7. **Test-tooling gotcha (again):** `packages/cloudflare`'s workerd tests resolve `@forge-cms/auth`/`db`/
   `testing` through their `dist`; rebuild before `test:cloudflare` or a stale `dist` runs the old code.
8. **Pre-existing, not caused:** 4 ESLint warnings in `libsql.adapter.ts` (spec 059's `updateIf`/`deleteIf`
   `eslint-disable` comments sit a line too early); identical on `HEAD`. The 8 that this work's formatting
   briefly introduced were removed.
9. **Pre-existing, found here:** InMemory accepts duplicate primary keys (see Known limitations).
10. **Review follow-ups** (`forge-rules-reviewer`, `spec-reviewer`): both SQL adapters now throw if the
    driver returns fewer result sets than statements or a failed one (a missing result must never read as
    a definite `applied: false`); the guard-placement helper is exported as `atomicWriteMustApply` and
    documented for custom-adapter authors; plain `update()` id-immutability became a contract case on all
    three adapters (it had only been exercised transitively); the error classifier got unit tests
    (`atomic-write.test.ts`).

Open follow-ups: the generic users-collection CRUD bypass (rest of H02), D02, D03, DB + object-storage
lifecycle (see §8 and `docs/STATE.md`).
