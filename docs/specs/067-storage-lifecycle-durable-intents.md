# 067 — Upload storage lifecycle: durable intents and access-checked reads

- **Status:** done <!-- directed by the maintainer: "dale con segunda parte" (D04 part 2) -->
- **Author:** agent draft (maintainer directive: roadmap 0.6 D04, second and last part)
- **Date:** 2026-09-28
- **Branch:** `feature/spec-065-auth-managed-delete-relation-integrity` (third commit; one PR for 065–067)
- **Affected packages/apps:** @forge-cms/runtime, @forge-cms/testing, @forge-cms/cloudflare (tests only),
  apps/demo-aesthetics (one E2E), docs (uploads, STATE, ROADMAP, roadmap 0.6 D01/D04)

## Context / Why

D04's last part is the DB ↔ object-storage lifecycle. D01 requires it too: "no claim of a transaction
spanning D1 and R2 … any compensation design specifies **durable recovery after process termination**,
not only catch blocks". Spec 066 also left one localization item open: concurrent locale edits on a
collection.

**Reproduced first, on the unfixed code** (runtime probes, InMemory and on-disk libSQL):

1. **Orphan after a failed upload.** A multipart create whose document failed validation, with the
   compensating object delete also failing, left the object in storage with nothing recording it:
   `status 400`, one stored object, zero documents. A process dying between `storage.put` and the
   document commit leaves the same state, since the compensation is only a `catch` block.
2. **Orphan after a delete.** Deleting an upload document whose object delete failed left
   `docs 0, objects 1`, plus a log line (which logged the raw error object).
3. **`handleFile` ignored access entirely.**
   - An anonymous request received `200 secret-bytes` for a **draft** document readable only by its
     owner.
   - A key in the bucket that no document owns was served too.
4. **Collection locale race.** Two libSQL clients editing `en` and `es` of one document at once
   both got `fulfilled`, and the stored map was `{ en: 'hello', es: 'buenas' }`: the `en` edit was
   silently lost.

Also probed and **not** a bug: an `afterChange` hook failing after an upload's document committed is
swallowed, so the object was not deleted. The new design still handles that ordering (below).

## Goal

No object can be left owned by no document without a durable record that recovers it. No document can
point at an object Forge deleted. A stored file is readable exactly by those who can read its
document. Concurrent locale edits of a collection document cannot lose one.

## Non-goals

- A transaction spanning the database and object storage (impossible on D1/R2), a jobs framework, or
  automatic background reconciliation.
- Local API upload, presigned uploads, image variants, S3.
- Changing create/delete access for uploads (already the collection's own), or upload size and type
  limits (already the handler's `upload` options).
- The two cross-cutting items spec 066 recorded, which apply to collections and globals alike:
  write responses ignoring read access, and update-access query timing.

## Design

### 1. Storage intents (`storage-intents.ts`)

A Forge-owned table `_forge_storage_intents { key, reason: 'upload' | 'delete', collection }`, built
like `_forge_bootstrap`. `ForgeCmsRuntime.syncSchema()` creates it when any collection is
upload-enabled. **A row means exactly: "the object at `key` belongs to no document; delete it."**

The whole upload sequence lives in one Local API operation, `operations.uploadFile(ctx, args, file)`
(package-private, called by `handleCreate`). Found in the rules review: the first draft drove it from
the HTTP handler, and a later Local API upload path would have had to repeat the ordering. The
handler only parses multipart and applies its size and type limits. One `try` covers everything after
the intent exists, including `getPublicUrl`, which the pre-067 code did not clean up after.
File ownership has one definition, `findStorageOwner`, used by `handleFile` and by reconciliation.

| Step           | Database                                                                                                  | Storage       | If it fails or the process dies here                                     |
| -------------- | --------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------ |
| Upload 1       | `create` intent `upload`                                                                                  | —             | nothing stored; intent without object (harmless)                         |
| Upload 2       | —                                                                                                         | `put(key)`    | object + intent → reconciled                                             |
| Upload 3       | **one batch**: `deleteIf(intent, requireApplied)` + document create (+ snapshot, + relation assertions)   | —             | batch rolled back → object + intent → `uploadFile` cleanup or reconcile  |
| Upload cleanup | **claim** the intent (`deleteIf`); only if it applied → `delete(key)`                                     | `delete(key)` | claim not applied → object kept; delete fails → `delete` intent restored |
| Delete 1       | **one batch**: document delete(s) + `create` intent `delete` per upload document (+ cascades, assertions) | —             | batch rolled back → nothing changed                                      |
| Delete 2       | delete intent                                                                                             | `delete(key)` | failure leaves intent → reconciled                                       |

**Upload cleanup only deletes the object after claiming the intent.** The document batch removes the
intent on commit, so a claim that does not apply means the document committed (or a reconciler took
over). A later failure, for example an after-hook, therefore can never delete a committed document's
object.

The claim also covers a batch whose outcome the driver could not report (a lost connection) and that
commits afterwards: it finds its own claim gone and rolls back. The first draft checked the intent and
then deleted the object, which left that window open (found in the spec review).

**Batch size.** Every deleted upload document adds one intent operation. The relation planner counts
them against `ATOMIC_WRITE_MAX_OPERATIONS` (25) before any hook runs, as spec 064 does, so an
oversized delete is refused and never chunked.

### 2. `reconcileStorage(runtime, options)` / `runtime.reconcileStorage(options)`

For each intent, oldest first, up to `limit` (default 100):

1. **Grace period.** An `upload` intent younger than `uploadGraceMs` (default 1 hour) is skipped and
   counted as `pending`, because its upload may still be committing.
2. **Ownership check.** If a document of the intent's collection records the key as `_storageKey`,
   the object will be **kept**. This runs _before_ the claim, so a failing read leaves the intent in
   place. The first draft checked after claiming, and a read error lost the intent (found in review).
3. **Claim.** `deleteIf(intent, {})`. Only one caller can apply it. If it did not apply, another
   reconciler or the upload's own commit got there first, and the intent is skipped. If the key is
   owned, the claimed intent is just dropped and reported in `kept`.
4. **Delete.** `storage.delete(key)` (`deleted`).

**Errors.** Any error for one intent is reported in `failed` with its _message_ only, and the run goes
on. If the intent was already claimed, a `delete` intent is put back for the next run.

**Race with a committing upload.** If reconciliation claims an upload intent whose document is still
committing, that document's batch fails its own `requireApplied` claim. The document is not created
(`409`), and `uploadFile`'s cleanup finds no intent and leaves the already-deleted object alone. A
document can never point at a deleted object.

**Residual.** A process that dies between the claim and the object delete leaks that single object:
it is stored with no intent. This is chosen over the opposite ordering, which could delete an object
a racing commit had just claimed.

Not called automatically. It is meant for a scheduled job (Cloudflare Cron Trigger) or an operator
script.

### 3. `handleFile` read access (`files.ts`)

- **Owner.** The owning document is the one in the key's namespace collection (`<collection>/…`,
  which must be upload-enabled) whose `_storageKey` equals the key.
- **Read check.** The caller comes from the request (`resolveOptionalUser`, the same rule as every
  handler). Then `runtime.findByID({ collection, id, user, overrideAccess: false })` applies
  collection and row access and draft visibility.
- **Not found.** No owner, `NotFoundError` or `AccessDeniedError` all give the same `404`. Nothing
  about existence is confirmed.
- **Cache headers.** Anonymous hits get `cacheControl` (default `public, max-age=60`). Authenticated
  hits get `private, no-store`, so a shared cache cannot hand one user's file to another.
- **Errors.** A thrown storage or driver error returns a generic `500` body; the message is not
  echoed.
- **Migration.** Upload rows recorded before spec 063 have no `_storageKey`, so they have no owner and
  now return `404` through `handleFile`. Operators backfill `_storageKey` from the key part of
  `url`. Public bucket or CDN URLs are outside Forge's access control, as before.

### 4. Collection locale merges (`operations.ts`)

- **The guard.** An update written with `locale` that merges into stored localized maps adds
  `{ updated_at: <read value> }` to its write condition. It is combined with spec 064's echoed-reference
  guard when both apply.
- **Stamp.** The shared `afterStamp` (moved from spec 066's globals code to `concurrency.ts`) makes
  the write's own stamp strictly later.
- **Versioned collections** carry it in their `updateIf` too.
- **On conflict** the update gets `409 CONCURRENT_MODIFICATION`; its message now names both possible
  causes.

### 5. Logging

Cleanup failures log the storage key and the error _message_ only. Before, the raw error object was
logged, and it can carry request or credential details.

## D01 behavior table: DB + object-storage rows

| Operation                               | Atomic?                                                     | Hooks                                               | Errors                                    | Safe to retry           | How partial work is observed       |
| --------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------- | ----------------------- | ---------------------------------- |
| Upload create                           | document + intent claim atomic; object store is not         | before-hooks may run; after-hooks only after commit | validation/access `4xx`; claim lost `409` | yes (new key each time) | `upload` intent rows               |
| Upload-document delete (incl. cascades) | document(s) + deletion intents atomic; object delete is not | as spec 064                                         | as spec 064                               | yes                     | `delete` intent rows               |
| Reconciliation                          | per intent: claim atomic; object delete is not              | none                                                | report `failed`                           | yes, idempotent         | `pending` / `failed` in the report |

No transaction across D1 and R2 is claimed anywhere.

## Test plan

- **`packages/runtime/src/storage-lifecycle.test.ts`**, InMemory plus one on-disk libSQL case:
  - a successful upload leaves no intent;
  - failed create + failed cleanup → intent; pending inside the grace period, then deleted;
  - crash between put and commit → recovered;
  - reconciliation claiming a committing upload's intent → the document is not created, and the
    object is gone;
  - failed object delete after a document delete → intent; a failed reconcile puts it back; the
    next run deletes it;
  - a normal delete leaves no intent;
  - a stale intent for an owned key keeps the object;
  - a cascade whose intents exceed the batch cap is refused with nothing deleted;
  - `handleFile`: owner-only read, public read with public cache, draft hidden, unowned and
    foreign keys `404`, no error echo.
- **`runLocaleMergeContractTests`** (plain and versioned collection), both writers held by
  `createWriteGate` with no pause. Runs on InMemory, on-disk libSQL and local D1.
- **Real D1 + R2 (workerd, `storage-lifecycle.test.ts`):**
  - an R2 delete failure after the D1 delete → a D1 intent, then reconciled;
  - a failed create with R2 cleanup failure → an intent, then reconciled;
  - `handleFile` serves an owned key and `404`s a stray one.
- **Browser (`apps/demo-aesthetics/e2e/media-upload.spec.ts`):** an admin uploads through the real
  form; the image loads through `handleFile`; the URL is `200` anonymously for the public media
  collection; a stray key under `media/` is `404`. The demo's dev storage is in memory; the R2 half is
  the workerd suite above.

## Acceptance criteria

1. Every failure or crash point of upload and delete leaves either a consistent state or a durable
   intent that `reconcileStorage` resolves.
2. No document is ever left pointing at an object Forge deleted.
3. `handleFile` serves a key only to callers who can read its owning document; everything else is `404`.
4. Concurrent locale edits of a collection document cannot both succeed with one lost.
5. Cleanup logs carry no error objects.
6. InMemory, libSQL and D1 (+ R2) agree. All repository gates, `test:libsql`, `test:cloudflare`,
   `check:api`, `release:verify` and the three E2Es are green.

## Open questions

None.

## Outcome

Shipped as designed. D04 is complete: spec 066 covers globals and localization, and this spec covers
the file lifecycle. The one D04 item left to R01 by the roadmap itself is a browser upload against the
certified **R2** profile. Here the browser journey runs on the demo's in-memory storage, and R2 is
covered in workerd.

Recorded residuals:

- a reconciler that dies between claim and object delete leaks one object;
- `updated_at` compare-and-set cannot see clock skew between processes;
- the two cross-cutting access items from spec 066.

Production D1/R2 and remote Turso were not exercised.
