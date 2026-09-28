# 068 — Write access consistency: read-filtered responses, write-time access queries

- **Status:** done <!-- directed by the maintainer: "dale con siguiente paso" after spec 067 -->
- **Author:** agent draft (follow-up both D04 reviews recorded, specs 066 and 067)
- **Date:** 2026-09-28
- **Branch:** `feature/spec-065-auth-managed-delete-relation-integrity` (fourth commit; one PR for 065–068)
- **Affected packages/apps:** @forge-cms/runtime, @forge-cms/testing, @forge-cms/cloudflare (tests only),
  docs (access-control, STATE, ROADMAP)

## Context / Why

The spec 066 and 067 reviews recorded two cross-cutting gaps, shared by collections and globals, and
left them for one fix.

**Reproduced first, on the unfixed code** (runtime probes, InMemory and on-disk libSQL). The setup:
`docs` is readable only by its `owner` and updatable/deletable by anyone; global `site` is readable only
while `region: 'eu'`. Bob is not the owner.

1. **Write responses ignored read access.**
   - Bob cannot read Alice's document (`findByID` → `NOT_FOUND`), yet `update(…, data: {})` returned
     it in full.
   - An access-checked `delete()` returned the **raw** row, including a field whose read rule is
     `() => false` (`secret: 's3cret'`).
   - A global hidden by its read rule (`getGlobalDocument` → `null`) came back in full from
     `updateGlobalDocument`.
2. **Update/delete access queries were check-then-act.** Rules: `update`/`delete` → `{ region: 'eu' }`.
   Bob's write, holding a separate libSQL client, was held after its access check. An independent
   trusted writer then set `region: 'us'`, and Bob's write was released.
   - Update: `fulfilled`, and the row became `{ title: 'bob edit', region: 'us' }`, a write outside
     Bob's scope.
   - Delete: `fulfilled`, and a row outside his scope was deleted.

## Goal

What a write returns follows the caller's read access. A row-level update or delete grant must hold
at the moment the write commits.

## Non-goals

- Changing trusted (`overrideAccess: true`) results, or the HTTP envelope (`{ data }` for create and
  update, `204` for delete).
- Evaluating a `create` rule's query against the new document. Collections never have; the query of
  a create rule has no stored row to constrain.
- H04 and other 0.6 work.

## Design

### 1. Read-filtered write results (`writeResult` / `canRead` in `operations.ts`, `canReadGlobal` in `globals.ts`)

For an access-checked call (`overrideAccess: false`), after the write commits, the runtime applies
the single-document read gate `findByID` uses:

- the collection's (or global's) `read` rule;
- its query matched against the written row;
- draft visibility (an anonymous caller cannot read a draft).

If that gate passes, the result goes through the normal read preparation: field-read projection,
locale, `depth`, `afterRead` hooks. If it fails, the result is **`{ id }`** (`{ id: 'global' }` for a
global). The write itself is unaffected; this is only what is disclosed.

This applies to create, update (including restore and a relation delete's set-null finalization, which
are trusted) and delete. A trusted delete keeps returning the stored row as before. An access-checked
delete now returns the read-prepared row or `{ id }`.

`afterOperation` hooks receive the same result the caller does.

Two points were found in the spec review:

- **Same arguments as `findByID`.** `canRead` passes the read rule exactly what `findByID` does (no
  `doc`), so a rule that inspects `doc` answers identically in both places.
- **Existing-document `preview`** (which has an HTTP route) now also requires this read gate, and
  answers `404` otherwise. Before, update access alone returned the stored document merged with the
  preview data.

### 2. Access queries inside the write

A query-returning rule becomes part of the write's own condition:

- **Collection update:** `PreparedUpdate.accessWhere` is ANDed (`allOf`) with the echoed-reference
  guard (spec 064) and the locale CAS (spec 067) into the `updateIf` `targetMatches`. Plain updates
  take the conditional path when any guard exists; versioned updates carry it in their batch.
- **Collection delete:**
  - the plain single delete becomes `deleteIf(targetMatches: where)` (`deleteRoot`). A row that is
    gone is a `404`; a row that exists but no longer matches is a `409`;
  - in a relation batch, the root delete becomes a `requireApplied` `deleteIf`.
- **Global update:** `writeGlobal` ANDs it with the locale CAS into a `requireApplied` `updateIf`.
- **On failure:** `409 CONCURRENT_MODIFICATION`. The error messages now name "no longer matches the
  caller's update/delete access" among the possible causes. Nothing is written.

The pre-write check stays: it gives the precise `403` when the row is already out of scope when read.

## Test plan

- **`packages/runtime/src/write-access.test.ts`**, response semantics:
  - an update of an unreadable document → `{ id }`;
  - a create the caller cannot read back → `{ id }`;
  - a readable create strips read-denied fields;
  - an access-checked delete strips them, or returns `{ id }`, while a trusted delete is unchanged;
  - a global update response follows the global's read query.
- **`runWriteAccessContractTests`** (new `createWriteHold`, which holds contender 0's next write of any
  kind). Runs on InMemory, on-disk libSQL (independent clients) and local D1 (workerd, independent
  adapters). Scenarios:
  - an update whose row leaves the caller's scope while held → `409`, row unchanged;
  - the same for a delete (the row survives);
  - the same for a global update;
  - in-scope update and delete still apply.
- **Contract, versioned and cascading writes** (added after review): a versioned update, and a delete
  whose root has a cascading dependent, each leaving scope while held → `409`, nothing changed.
- **Unit tests** (added after review): preview of an update-only document → `404`, and a `doc`-inspecting
  read rule answers the same for `findByID` and for a write result.
- **Changed tests:** two existing tests asserted an anonymous caller reading back a draft it had just
  created. They now use an authenticated caller, or check the stored row, because under this spec an
  anonymous caller receives `{ id }` for a draft, as `findByID` would hide it.
- **Demo (`apps/demo-aesthetics`).** Its content-model tests read back an anonymous visitor's booking,
  a collection only staff may read. They now check the stored row with a trusted read. This is the
  typical visible effect for an application: a public "submit a form" create returns `{ id }` when
  the visitor cannot read the collection. The demo's booking form only ever used `id`.

## Acceptance criteria

1. No access-checked write returns data the caller could not read through `findByID`/`getGlobal`.
2. A query-returning update/delete rule is enforced at commit, on all three backends, for plain,
   versioned, cascading and global writes.
3. Trusted results and the HTTP envelope are unchanged.
4. All repository gates, `test:libsql`, `test:cloudflare`, `check:api`, `release:verify` and the three
   E2Es are green.

## Open questions

None.

## Outcome

Shipped as designed, plus the two review fixes above (`preview`, and `canRead` matching `findByID`).
Both cross-cutting items recorded by the D04 reviews are closed.

Recorded, not changed:

- **Status codes depend on the rule's shape.** A write whose row vanished concurrently and that
  carries a query rule is a `409` (its conditional write did not apply). The same write under a
  boolean rule stays as before: a `404` for a versioned update, and a no-op for a relation batch's
  root delete.
- **Route-level gates and read hooks.** The read gate here is the collection's `access.read` rule.
  Route-level `allowedRoles` and `beforeOperation('read')` hooks are not consulted for write results,
  as for `handleFile` (spec 067).
- **Clients.** Callers that write without read access now receive `{ id }`. The admin upload picker
  then shows an entry without url or label; the Angular client's generic return types do not express
  that shape.

The remaining 0.6 packet is H04 (host-level auth limits).
