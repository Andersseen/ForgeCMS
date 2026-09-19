# 059 — Conditional writes: close the last-admin race at the storage layer

- **Status:** done <!-- approved by the maintainer's task brief, which directs this exact implementation -->
- **Author:** agent draft (explicit maintainer directive to implement this bounded step)
- **Date:** 2026-09-18
- **Branch:** `feature/spec-059-conditional-writes`
- **Affected packages/apps:** @forge-cms/db, @forge-cms/cloudflare, @forge-cms/auth,
  @forge-cms/testing, docs (roadmap packet H01, and the auth half of H02)

## Context / Why

Spec 058 §7b closed the first-admin bootstrap race with a unique-index claim but could only
_mitigate_ the last-admin race: `UsersCollectionAuthAdapter.updateUser`/`deleteUser` read the admin
count, decided in JavaScript, then issued an unrelated write, and compensated after the fact. The
`DatabaseAdapter` contract had no way to say "apply this write only if the database still agrees".
Two independent Workers/processes each demoting or deleting a different admin can therefore still
leave zero admins (`docs/roadmap/v1/AUDIT.md` F08, packet H01). A process-local mutex does not help:
the two writers are not in one process.

This spec adds the smallest storage-level primitive that can decide the invariant inside the write
itself, and uses it to remove the residual race. It is roadmap packet **H01** (primitive + evidence)
plus the last-admin half of **H02** (the users adapter consuming it).

## Goal

A users collection that currently contains at least one admin can never be changed by concurrent
user mutations into a state with zero admins, on every supported durable adapter (libSQL, D1), proven
by deterministic two-writer tests against real backends.

## Non-goals

- No transaction framework, `transaction(cb)`, multi-statement batch, or unit-of-work. (Evaluated for
  future steps in §"Sufficiency for later invariants" — not built here.)
- No consumer other than `UsersCollectionAuthAdapter`'s last-admin path. Not used for documents,
  versions, cascades, relations or migrations.
- No change to spec 058's first-admin bootstrap, `_sessionVersion`, session freshness, API keys,
  logout scope, or any HTTP/route behavior. No new auth features, no sessions table.
- No schema migrations. No new field kinds, endpoints, admin UI, or adapters.
- Does not fix the generic content CRUD path on the users collection (see §"Known limitations").
- Does not fix the burned-bootstrap-claim finding (see §"Adjacent findings").
- Does not rewrite spec 058's history; `STATE.md` carries the current guarantee.

## Verified starting point (current `main`, `94009e7`)

- `DatabaseAdapter` (`packages/db/src/index.ts`): `findById`, `findMany`, `count`, `create`, `update`,
  `delete`, `syncSchema`. `update`/`delete` are keyed by `id` only; there is no `WHERE`-conditioned
  write and no SQL-expression update. Three implementers exist (InMemory, libSQL, D1) and **no other
  implementation or test double of the interface exists in the repo** (grepped), so a required-method
  addition has a three-file blast radius.
- `UsersCollectionAuthAdapter.updateUser`/`deleteUser`: `findById` → `countAdmins()` (a full
  `findMany` of admin rows) → write → re-count → best-effort compensation. Reproduced by the existing
  spec 058 concurrency test, which asserts only `>= 1` admin _under a mitigation_, not atomicity.
- Backends' primary semantics (checked from primary docs at implementation time, 2026-09-18):
  - SQLite: "all transactions in SQLite show serializable isolation … by actually serializing the
    writes. There can only be a single writer at a time" (sqlite.org/isolation.html); any statement
    that changes the database runs in an automatically-started transaction that commits when the
    statement finishes (sqlite.org/lang_transaction.html). One `UPDATE`/`DELETE` statement, including
    a subquery in its `WHERE`, is therefore one indivisible step with respect to other connections.
  - D1: "Each individual D1 database is inherently single-threaded, and processes queries one at a
    time" (developers.cloudflare.com/d1/platform/limits); "Batched statements are SQL transactions"
    and batch statements "execute and commit, sequentially, non-concurrently"
    (d1/worker-api/d1-database). D1's docs do not separately state single-statement atomicity; it
    follows from D1 running SQLite one query at a time, and is verified empirically against a real
    local D1 (workerd) by this spec's tests rather than assumed.
  - libSQL (`@libsql/client`): SQLite semantics; tested here against a real on-disk database opened
    by two independent clients. Remote (Turso/sqld) is the same engine but is **not exercised** here.

## Design

### 1. Choosing the primitive from the invariant

The invariant is "at least one _other_ row still matches `role = 'admin'`", i.e. it depends on rows
**other than the one being written**. Candidates, and why each is rejected or chosen:

| Candidate                                                       | Verdict                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transaction(async () => …)` callback                           | Rejected. D1 has no interactive transactions (only `batch()`); not portable. Would also invite long read→decide→write windows.                                                                                                                                                                            |
| Target-row compare-and-set (`updateWhere(id, { role: admin })`) | Insufficient. A→editor and B→editor each target a row that _is_ currently an admin, so both conditions hold and both apply → zero admins. The condition must see other rows.                                                                                                                              |
| Epoch/version row + CAS, then write the user                    | Rejected. Two statements; the epoch CAS does not cover the user write. A wins the epoch, B re-reads the count before A's user write lands, wins the next epoch, both demote.                                                                                                                              |
| Unique-index claim (as for bootstrap)                           | Cannot express "at least one"; only "at most one".                                                                                                                                                                                                                                                        |
| Denormalised `adminCount` row                                   | Needs `n = n - 1` (no SQL-expression updates in the contract) and updating two rows atomically (multi-statement).                                                                                                                                                                                         |
| Mutex / lock / retry                                            | Rejected by the brief; not multi-instance safe.                                                                                                                                                                                                                                                           |
| **Single-statement conditional write with a cross-row guard**   | **Chosen.** Maps onto one SQL statement on both SQL backends, so the database itself decides. Uses only what D1 and libSQL both guarantee. Two write methods (`updateIf`, `deleteIf`) cover both mutation kinds the invariant needs; the condition type is a plain data value a future batch could reuse. |

The guard is deliberately shaped as a **set floor** ("the target may leave the set only if enough
_others_ remain") rather than a general cross-row expression language. It is exactly the invariant,
evaluated at write time on the target row's _current_ state — so a caller acting on a stale read
cannot defeat it (see §3).

### 2. Public API (`@forge-cms/db`)

```ts
/**
 * Precondition of a conditional write. The database evaluates it atomically with the write, against
 * the state at the instant of the write — never against a value the caller read earlier. Every clause
 * present must hold; `{}` holds whenever the target row exists.
 */
export interface WriteCondition {
  /** The target row, as it is right now, must match (per-row compare-and-set). */
  targetMatches?: DatabaseWhere;
  /**
   * Set floor. Let S be the rows of the collection matching `where`. If the target row is currently
   * in S, the write applies only when at least `others` OTHER rows are also in S. If the target is
   * not in S the clause holds vacuously (removing a non-member cannot shrink S). `others` must be a
   * non-negative integer.
   *
   * The database does not check that the write really removes the target from S (an update might
   * keep it in); the clause is a conservative precondition. Attach it to writes that _may_ remove the
   * row from S. It is scoped to the write's own collection.
   */
  keepAtLeast?: { where: DatabaseWhere; others: number };
}

export type ConditionalUpdateResult<TRecord extends DatabaseRecord = DatabaseRecord> =
  | { applied: true; record: TRecord }
  | { applied: false };

export interface ConditionalDeleteResult {
  applied: boolean;
}

interface DatabaseAdapter<TRecord> {
  // …existing methods unchanged…
  updateIf(
    collection: string,
    id: string,
    data: Partial<TRecord>,
    condition: WriteCondition
  ): Promise<ConditionalUpdateResult<TRecord>>;
  deleteIf(
    collection: string,
    id: string,
    condition: WriteCondition
  ): Promise<ConditionalDeleteResult>;
}
```

Both are **required** members of the interface (not optional): an adapter that cannot make a
conditional write atomic cannot back a users collection safely, and a compile-time break for TypeScript
implementers is more honest than a runtime surprise. The break is documented in the changeset. For
untyped/JS implementers `UsersCollectionAuthAdapter.init()` additionally fails **explicitly, at
construction**, if `userDatabase` lacks the two methods (§4) — before any affected operation can run.

### 3. Exact semantics

| Question                 | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What is evaluated        | Every present clause of `condition` against the target row and (for `keepAtLeast`) the other rows of the same collection, all as of the moment of the write.                                                                                                                                                                                                                                                                                                                                                                              |
| What is performed        | `updateIf`: same column mapping/validation and `updated_at` stamping as `update()` (`id` in `data` is ignored). `deleteIf`: deletes the row.                                                                                                                                                                                                                                                                                                                                                                                              |
| Success                  | The row exists, the condition held, and the write was applied. `updateIf` returns `{ applied: true, record }` with the row as written (hydrated exactly as `update()` returns it). `deleteIf` returns `{ applied: true }`.                                                                                                                                                                                                                                                                                                                |
| Condition not satisfied  | Nothing changes. Returns `{ applied: false }`. Not an error.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Missing target           | Nothing changes. Returns `{ applied: false }`. Not an error (unlike `update()`, which throws). Callers that must tell "missing" from "refused" re-read; that answer is advisory (the row may change again), `applied` is authoritative.                                                                                                                                                                                                                                                                                                   |
| Atomicity                | The condition check and the write are one indivisible step with respect to every other writer of the same database: no other write can interleave. **Provided by:** libSQL (one SQL statement = one auto-commit transaction, writers serialized by SQLite); D1 (one statement; D1 processes a database's queries one at a time, so independent Worker isolates are serialized); InMemory (single JS turn — atomic within one instance/process only; it is a dev/test adapter).                                                            |
| Not guaranteed           | Atomicity across more than one call; atomicity with anything outside the database (R2, hooks); visibility of the write on read replicas; any guarantee on unverified backends (remote Turso).                                                                                                                                                                                                                                                                                                                                             |
| Unique constraints       | If the write is otherwise permitted but would violate a unique index, `updateIf` throws `UniqueConstraintError` and changes nothing (same error `update()` throws). A failed _condition_ takes precedence: constraints are only checked for a row the statement actually writes, so it returns `{ applied: false }` instead. All three adapters agree (contract-tested).                                                                                                                                                                  |
| Database / input failure | Propagates as a rejection. Adapters never convert a failure into `applied: false`. Invalid input (unknown column, unregistered collection, non-integer `others`) throws **before** anything is written on the SQL adapters; `InMemoryDatabaseAdapter` rejects a bad `others` but — like every one of its methods — does not check column names or registration (see Known limitations). A rejection from a network-ambiguous failure (timeout after send) means "outcome unknown"; a constraint/validation rejection means "not applied". |
| Partial application      | None: a single statement either changes the row or does not.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Staleness                | The guard reads the target's _current_ membership in S, so a caller acting on a stale read (it saw an editor that has since become the last admin) is still correctly refused.                                                                                                                                                                                                                                                                                                                                                            |

### 4. Adapter implementations

- **libSQL** (`libsql.adapter.ts`): one drizzle `UPDATE … WHERE id = ? AND (<targetMatches>) AND
(<guard>) RETURNING *` / `DELETE … RETURNING id`, where
  `<guard> = (CASE WHEN (<P>) THEN 1 ELSE 0 END = 0) OR ((SELECT COUNT(*) FROM <t> WHERE id <> ? AND
(<P>)) >= ?)`. The `CASE` makes a NULL-valued predicate mean "not in S" (three-valued logic would
  otherwise make `NOT NULL` unknown and wrongly refuse). `<P>` reuses `buildWhereCondition`, so the
  operator semantics are the query language the adapter already ships.
- **D1** (`d1.adapter.ts`): the same statement as a prepared SQL string with bound parameters through
  `buildWhereExpression`, executed with `.all()` so `RETURNING` yields both the decision and the row.
  No use of `batch()`; no reliance on one Worker instance being the only writer.
- **InMemory**: evaluates the identical condition with `matchesWhere` and applies the write in one
  synchronous turn (no `await` between check and write), checking unique indexes only after the
  condition holds — the same ordering SQL gives.
- SQL is deliberately not shared verbatim between libSQL (drizzle) and D1 (raw); the contract suite is
  what keeps them in step.

### 5. Auth invariant (`UsersCollectionAuthAdapter`)

`const LAST_ADMIN = { keepAtLeast: { where: { role: 'admin' }, others: 1 } }`, applied against
`this.collection` (so, like the bootstrap claim, it is scoped to the configured users collection).

- `deleteUser(id)`: `deleteIf(collection, id, LAST_ADMIN)`. Applied → done. Not applied → re-read: row
  gone → idempotent no-op (as today); row present → `UserMutationError('last-admin')`. The pre-read
  and `countAdmins()` are removed.
- `updateUser(id, input)`: unchanged validation. If `input.role !== undefined && input.role !== 'admin'`
  → `updateIf(collection, id, updates, LAST_ADMIN)`; not applied → re-read: gone → `null`, present →
  `UserMutationError('last-admin')`. Otherwise plain `update()` — an update that cannot remove admin
  privilege pays nothing. The guard is attached whenever the caller _intends_ a non-admin role,
  regardless of what an earlier read showed, so a stale read can never skip it.
- Post-write re-verification, compensation and `countAdmins()` are deleted.
- `init()` throws an explicit error if `userDatabase` does not implement `updateIf`/`deleteIf`.
- Error semantics, `UserMutationError` reasons, sessions, `_sessionVersion`, bootstrap: unchanged.

### 6. Test strategy

- **Shared contract** (`@forge-cms/testing/contracts`): new `runDatabaseAdapterConditionalWriteContractTests`
  (following spec 046's precedent of a separate, additive suite). Run against InMemory, real libSQL,
  and real D1 (workerd). Covers: applied/not-applied for both methods and both clauses, missing target,
  keep-at-least counting (others excluded/included, boundary, vacuous non-member, NULL-valued
  membership), evaluation against current state, sequential conflicting writers, `Promise.all`
  conflicting writers with an exactly-one-wins outcome, condition-beats-unique-constraint, unique
  violation with no partial application, invalid `others`, result accuracy (`record` reflects the write).
- **Deterministic concurrency** (`runLastAdminConcurrencyContractTests`, also in
  `@forge-cms/testing/contracts`): a `WriteGate` decorator holds every mutating call of each party at a
  barrier until _all_ parties have reached their write, then releases them together — so the
  read→decide→write gap that used to be the race is forced open, not hoped for. A **control** test
  runs a naive count-then-write through the same gate and asserts it _does_ reach zero admins,
  proving the harness catches the historical bug. Scenarios: demote/demote, delete/delete,
  delete/demote (both orderings), three admins racing (exactly two win), non-conflicting mixes still
  both succeed, and per-collection scoping. Parties use **separate adapter instances** over one store.
- Backends: InMemory (packages/auth), a real on-disk libSQL file opened by independent clients
  (packages/auth db-parity), real local D1 in workerd (packages/cloudflare `test:cloudflare`).
- D1's hand-rolled unit-test mock is a regex SQL interpreter that cannot evaluate a cross-row
  subquery; it is **not** used to claim contract compliance. A capturing fake asserts only the emitted
  SQL/binding shape and failure propagation; real D1 carries the contract evidence.

### 7. Sufficiency for later invariants (evaluation, nothing implemented)

| Future need                                                      | Sufficient? | Reason                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H02 last-admin                                                   | **Yes**     | This spec.                                                                                                                                                                                                                                                                    |
| Migration bookkeeping (claim a step, `pending → running → done`) | **Yes**     | Claim = `create` on a unique key (already atomic); state transition = `updateIf` with `targetMatches: { state: 'pending' }`. Applying DDL itself is a separate, non-transactional concern.                                                                                    |
| Optimistic concurrency on one document (`version`/`updated_at`)  | **Yes**     | `targetMatches` is exactly per-row compare-and-set.                                                                                                                                                                                                                           |
| D03 document + version snapshot                                  | **No**      | Needs the document write and the version insert to commit together (silent divergence otherwise). That is a multi-statement atomic boundary; one conditional statement cannot span two tables. Duplicate version numbers are separately solvable with a unique index + retry. |
| D02 cascade / set-null chains                                    | **No**      | Needs N dependent writes to commit or fail together, and `restrict` needs a _cross-collection_ "no referencing rows" guard evaluated at the write (`keepAtLeast` is same-collection only).                                                                                    |
| Multi-record content mutations, DB + R2                          | **No**      | Same multi-statement boundary; DB + object storage can never be one transaction (roadmap D01 already states this).                                                                                                                                                            |

A second primitive — a declarative, data-only **atomic write batch** (an ordered list of
`create`/`update`/`delete` operations, each optionally carrying a `WriteCondition`, executed as one
unit) — would map to D1 `batch()` and libSQL `client.batch(…, 'write')`, both documented transactional,
and would reuse `WriteCondition` unchanged. That is the recommended next step, not part of this one.
_(Delivered by [spec 060](060-atomic-write-batch-first-admin-provisioning.md).)_

### Known limitations (stated, not hidden)

- **Generic content CRUD bypasses the invariant.** `PUT/DELETE /api/v1/users/:id` (or
  `runtime.update/delete` on the users collection) run through the content pipeline, which knows
  nothing about roles-as-invariants; only `UsersCollectionAuthAdapter.updateUser/deleteUser` (used by
  `/api/auth/users*` and the admin users screen) is protected. Pre-existing, untouched, and the
  remaining H02 audit item ("generic users-collection CRUD cannot bypass lifecycle invariants").
  Trusted direct adapter access is likewise outside runtime guarantees.
- **InMemory is atomic only inside one adapter instance/process.** By design; it is not a durable
  adapter.
- **Remote libSQL/Turso** shares SQLite semantics but is not exercised by this repo's tests.
- **Remote D1 / cross-isolate.** The real-D1 evidence runs both parties inside one workerd isolate
  against Miniflare's local D1. It proves the _decision is made by the SQL statement_ (the load-bearing
  claim); that two real Worker isolates against remote D1 are serialized rests on Cloudflare's
  documented "processes queries one at a time", not on a test here.
- **InMemory does not validate column names or registration** (none of its methods does). A typo in a
  condition's `where` therefore matches nothing there and, for `keepAtLeast`, silently makes the guard
  vacuous, where libSQL/D1 reject. Dev/test-only adapter; the auth guard is a fixed literal. A bad
  `others` (including an omitted one) is rejected identically by all three.
- **`ne`/NULL parity** of `DatabaseWhere` between JS and SQL is pre-existing and inherited by the
  guard's `where`; the auth guard uses `eq` only.

### Adjacent findings (reproduced, deliberately not fixed here)

- **`InMemoryDatabaseAdapter.update()` can rewrite the primary key.** It merges `data` wholesale, so
  `update(c, id, { id: 'other' })` re-keys the row; the SQL adapters and the new `updateIf` ignore `id`.
  Pre-existing, made visible by the sibling method; needs its own fix and contract case.

- **A failed first-user create burns the spec-058 bootstrap claim.** `claimFirstAdminBootstrap`
  inserts the marker row, then `create()` inserts the user; if that `create()` throws (transient DB
  error), the marker stays forever, `hasAnyUser()` is false, no later caller can win the claim, and
  every subsequent signup becomes `viewer` — a users collection with zero admins and no in-band way
  out. Reproduced against built `dist` with a one-shot failing `create`. It is a failure-recovery
  gap, not a two-writer race, and needs an atomic "create user as admin unless an admin exists" or a
  claim+create batch — i.e. the next primitive above. Recorded for that step.
  **Superseded by [spec 060](060-atomic-write-batch-first-admin-provisioning.md): fixed — claim and
  user are one atomic write.**

## Implementation plan

- [x] Write this spec (branch `feature/spec-059-conditional-writes`).
- [x] `@forge-cms/db`: `WriteCondition`/result types + `DatabaseAdapter.updateIf`/`deleteIf`; export types.
- [x] `@forge-cms/db`: InMemory implementation; libSQL implementation (single guarded statement).
- [x] `@forge-cms/cloudflare`: D1 implementation.
- [x] `@forge-cms/testing`: `runDatabaseAdapterConditionalWriteContractTests`,
      `runLastAdminConcurrencyContractTests`, `createWriteGate`.
- [x] Wire the conditional-write contract into InMemory + real libSQL tests; real D1 (workerd) test.
- [x] `@forge-cms/auth`: `updateUser`/`deleteUser` on the primitive; delete compensation; init capability check.
- [x] Replace the spec 058 mitigation test with the deterministic suite on InMemory, real on-disk
      libSQL (two clients), and real D1 (workerd).
- [x] `pnpm check:api:update`, changesets, docs (`ARCHITECTURE.md`, `adapters.md`, `STATE.md`,
      `ROADMAP.md`/`0.6` status note), spec Outcome.
- [x] Full gates and reports.

## Test plan

See §6. Commands: `pnpm --filter @forge-cms/db test`, `pnpm --filter @forge-cms/auth test`,
`pnpm --filter @forge-cms/cloudflare test`, `pnpm test:cloudflare`, `pnpm test:libsql`, then the full
gate list.

## Acceptance criteria

1. `DatabaseAdapter` has `updateIf`/`deleteIf` with the signatures in §2; all three adapters implement
   them; `WriteCondition` and result types are exported from `@forge-cms/db`.
2. `runDatabaseAdapterConditionalWriteContractTests` passes on InMemory, real libSQL, and real local D1.
3. `UsersCollectionAuthAdapter` contains no `countAdmins`, no post-write re-verification and no
   compensation; last-admin protection is decided by one guarded database statement.
4. The concurrency suite passes on InMemory, real on-disk libSQL (independent clients) and real D1
   (workerd) for demote/demote, delete/delete, delete/demote, three-admin, non-conflicting and
   collection-scoping scenarios; the naive-control test demonstrates the harness reproduces the old race.
5. Existing auth behavior is unchanged (all pre-existing auth, session-freshness, bootstrap, API-key
   tests pass unmodified apart from the replaced spec 058 mitigation test).
6. `check:api` baseline updated intentionally; changesets added; no manual version bump.
7. `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`, `pnpm test:cloudflare`,
   `pnpm test:libsql`, `pnpm check:api`, `pnpm release:verify` green (E2E reported honestly).

## Open questions

(none)

## Outcome

Shipped as designed: `DatabaseAdapter.updateIf`/`deleteIf` with `WriteCondition` (`targetMatches`,
`keepAtLeast`), implemented as one guarded statement on libSQL and D1 and one synchronous turn on
InMemory; `UsersCollectionAuthAdapter` moved onto them with the pre-check, post-write verification and
compensation deleted. The last-admin race is closed on libSQL and D1, proven by deterministic two-writer
tests on real on-disk libSQL (independent clients) and real local D1 (workerd). Verification results are
in `docs/STATE.md`'s spec 059 entry.

Deviations and things learned while building it, none changing the design:

1. **InMemory parties share one adapter instance.** §6 says "separate adapter instances over one
   store"; a second `InMemoryDatabaseAdapter` is a second store, so InMemory contenders share the
   database instance and differ only in their own `UsersCollectionAuthAdapter`. libSQL (own client per
   party, one file) and D1 (own adapter per party, one binding) are genuinely separate.
2. **Real libSQL uses an on-disk file.** `file::memory:` gives every connection its own empty database,
   so it cannot host two independent clients. The test loads `node:fs`/`node:os` through a variable
   specifier with a local type instead of adding `@types/node` to a package whose source must stay
   edge-safe.
3. **The D1 unit-test mock is not contract evidence.** As predicted in §6 it is a regex SQL
   interpreter; it only backs SQL-shape/binding-order and failure-propagation tests (with a small
   capturing fake). Real D1 carries the contract.
4. **`assertValidWriteCondition` is exported** from `@forge-cms/db` (in its own `write-condition.ts`,
   to avoid an `index.ts` ↔ adapter import cycle) so libSQL, D1 and InMemory reject a bad `others`
   identically; it shows up in the API baseline.
5. **What the old implementation does under the gate.** Not permanent zero: its write-then-verify order
   lets both writes land before either check, so both parties then compensate and refuse
   (`applied: 0, refused: 2`) — an over-refusal, having passed through a real zero-admin window. Only the
   naive control reaches a permanent zero. This was observed on InMemory and on real D1.
6. **Test-tooling gotcha.** `packages/cloudflare`'s workerd tests resolve `@forge-cms/auth` through its
   `dist`; a stale `dist` silently runs the previous implementation (it presented as "all parties
   refused" and looked like a D1 bug). `pnpm build` (or turbo, which orders it) before `test:cloudflare`.
7. **Pre-existing failure found, not caused:** `apps/tiny-project`'s `e2e/golden-path.spec.ts` fails on
   clean `main` (see STATE.md). Not fixed here.

Open follow-ups recorded in §7 and "Adjacent findings": the atomic write batch (D02/D03), the burned
bootstrap claim, and the unguarded generic users-collection CRUD path.
