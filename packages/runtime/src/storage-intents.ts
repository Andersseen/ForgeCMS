import type { CollectionDefinition } from '@forge-cms/core';
import { defineField, getLogger } from '@forge-cms/core';
import type { AtomicWriteOperation, DatabaseAdapter, DatabaseRecord } from '@forge-cms/db';
import type { OperationContext } from './context.js';

/**
 * Durable storage-cleanup intents (spec 067). A database transaction cannot include object storage, so
 * every step where an object can end up owned by no document leaves a row here **first**, in the
 * database, and removes it only once the object is accounted for:
 *
 * - **Upload:** an `upload` intent is written *before* the object is stored, and removed in the **same
 *   batch** that creates the owning document. A process that dies between storing the object and
 *   committing the document leaves the intent behind.
 * - **Delete:** a `delete` intent is written in the **same batch** that deletes the owning document, and
 *   removed once the object is deleted. A failed or interrupted object delete leaves it behind.
 *
 * A remaining intent means exactly "this object belongs to no document; delete it". {@link reconcileStorage}
 * works them off. Nothing here is transactional with the bucket; the row is what survives a crash.
 */
export const STORAGE_INTENTS_COLLECTION = '_forge_storage_intents';

/** How long an `upload` intent is left alone: its upload may still be committing its document. */
export const DEFAULT_UPLOAD_GRACE_MS = 60 * 60 * 1000;

/**
 * The internal collection, built without `defineCollection()` because its identifier validation
 * reserves the `_forge_` prefix for Forge's own tables — the same pattern as `_forge_bootstrap`.
 */
export function storageIntentsDefinition(): CollectionDefinition {
  return {
    slug: STORAGE_INTENTS_COLLECTION,
    access: {
      read: () => false,
      create: () => false,
      update: () => false,
      delete: () => false
    },
    fields: {
      key: defineField.text({ required: true, index: true }),
      reason: defineField.text({ required: true }),
      collection: defineField.text({ required: true })
    }
  };
}

export function hasUploadCollections(collections: readonly CollectionDefinition[]): boolean {
  return collections.some((collection) => collection.upload === true);
}

/** Records, before the object is stored, that `key` may end up owned by nothing. Returns the intent id. */
export async function recordUploadIntent(
  database: DatabaseAdapter,
  collection: string,
  key: string
): Promise<string> {
  const intent = await database.create(STORAGE_INTENTS_COLLECTION, {
    key,
    reason: 'upload',
    collection
  });
  return intent.id as string;
}

/**
 * The batch operation that turns an upload intent into ownership: it joins the document's own create
 * batch, and must apply — if reconciliation already claimed the intent (it is deleting the object), the
 * document is not created either.
 */
export function claimUploadIntent(intentId: string): AtomicWriteOperation {
  return {
    type: 'deleteIf',
    collection: STORAGE_INTENTS_COLLECTION,
    id: intentId,
    condition: {},
    requireApplied: true
  };
}

/**
 * After a failed upload create. The object belongs to nothing **only if this call can claim the
 * intent**: the document batch removes it on commit, so a claim that does not apply means the document
 * committed (a later step failed) or a reconciler took over, and either way the object is left alone.
 * Claim-first, like {@link reconcileStorage}: a batch whose outcome the driver could not report (a lost
 * connection) and that commits afterwards finds its own claim gone and rolls back, so no document can
 * point at the object deleted here. A failed object delete puts a `delete` intent back for reconciliation.
 */
export async function settleFailedUpload(
  ctx: OperationContext,
  intentId: string,
  key: string
): Promise<void> {
  const database = ctx.adapters.database;
  let claimed = false;
  try {
    claimed = (await database.deleteIf(STORAGE_INTENTS_COLLECTION, intentId, {})).applied;
    if (!claimed) return;
    await ctx.adapters.storage.delete(key);
  } catch (err) {
    if (!claimed) {
      logCleanupFailure(key, 'after a failed upload', err, 'kept');
      return;
    }
    await restoreIntent(ctx, key, keyCollection(key), err, 'after a failed upload');
  }
}

/** The `delete` intent a document delete writes in its own batch. */
export function deletionIntent(collection: string, key: string): AtomicWriteOperation {
  return {
    type: 'create',
    collection: STORAGE_INTENTS_COLLECTION,
    data: { key, reason: 'delete', collection }
  };
}

/** After the delete committed: remove the object, then its intent; a failure leaves the intent. */
export async function finishDeletion(
  ctx: OperationContext,
  intentId: string,
  key: string
): Promise<void> {
  try {
    await ctx.adapters.storage.delete(key);
    await ctx.adapters.database.delete(STORAGE_INTENTS_COLLECTION, intentId);
  } catch (err) {
    logCleanupFailure(key, 'after document deletion', err, 'kept');
  }
}

export interface ReconcileStorageOptions {
  /** `upload` intents younger than this are skipped — their upload may still be committing. Default 1 hour. */
  uploadGraceMs?: number;
  /** At most this many intents per call. Default 100. */
  limit?: number;
  /** "Now", for tests. */
  now?: Date;
}

export interface ReconcileStorageReport {
  /** Objects deleted (or already absent), whose intents are now gone. */
  deleted: string[];
  /** Intents dropped without touching storage, because their object turned out to be owned. */
  kept: string[];
  /** `upload` intents still inside their grace period. */
  pending: number;
  /** Object deletes that failed; their intents remain for the next run. Messages only, no secrets. */
  failed: { key: string; error: string }[];
}

/**
 * Works off the storage intents left by crashed or failed uploads and deletes (spec 067): each remaining
 * object that belongs to no document is deleted, and its intent removed. Safe to run at any time and
 * repeatedly, from several processes at once:
 *
 * - An intent is first **claimed** — deleted by a conditional delete that only one caller can apply — so
 *   no two reconcilers, and no still-committing upload, can both act on it (the upload's own claim then
 *   fails and its document is not created).
 * - An object is never deleted while a document owns it: an intent whose key a document of its
 *   collection records as `_storageKey` is dropped and the object kept.
 * - A failed object delete puts the intent back for the next run. Only a process that dies between the
 *   claim and the object delete can leak that one object (a stored object with no intent); it can never
 *   leave a document pointing at a deleted object.
 *
 * Run it from a scheduled job (e.g. a Cloudflare Cron Trigger) or an operator script. It is not called
 * automatically.
 */
export async function reconcileStorage(
  ctx: OperationContext,
  options: ReconcileStorageOptions = {}
): Promise<ReconcileStorageReport> {
  const database = ctx.adapters.database;
  const now = (options.now ?? new Date()).getTime();
  const grace = options.uploadGraceMs ?? DEFAULT_UPLOAD_GRACE_MS;
  const report: ReconcileStorageReport = { deleted: [], kept: [], pending: 0, failed: [] };
  // Without an upload collection there is no intents table (`syncSchema()` only creates it where
  // uploads exist) and nothing to reconcile. Reading it anyway threw "not registered" (spec 073).
  if (!hasUploadCollections(ctx.getCollections())) return report;

  const intents = await database.findMany({
    collection: STORAGE_INTENTS_COLLECTION,
    limit: options.limit ?? 100,
    sort: 'created_at',
    order: 'asc'
  });

  for (const intent of intents) {
    const key = intent.key as string;
    const collection = intent.collection as string;
    if (intent.reason === 'upload' && now - createdAt(intent) < grace) {
      report.pending++;
      continue;
    }

    let claimed = false;
    try {
      // Ownership first: if a document records the key, the object stays. Checked before the claim, so
      // a failing read leaves the intent in place; a commit racing in between consumes the intent and
      // our claim below then does not apply.
      const owned = (await findStorageOwner(ctx, key, collection)) !== null;
      claimed = (await database.deleteIf(STORAGE_INTENTS_COLLECTION, intent.id as string, {}))
        .applied;
      if (!claimed) continue; // another reconciler, or the upload's own commit, got it first
      if (owned) {
        report.kept.push(key);
        continue;
      }
      await ctx.adapters.storage.delete(key);
      report.deleted.push(key);
    } catch (err) {
      report.failed.push({ key, error: messageOf(err) });
      if (claimed) await restoreIntent(ctx, key, collection, err, 'during reconciliation');
    }
  }
  return report;
}

/**
 * The upload document that owns `key`: in the upload-enabled collection `collection` (default: the one
 * the key is namespaced under, `<collection>/…`), the document whose Forge-recorded `_storageKey` is
 * `key`. The single definition of file ownership (spec 067), used by `handleFile` and reconciliation.
 */
export async function findStorageOwner(
  ctx: OperationContext,
  key: string,
  collection: string | undefined = key.split('/')[0]
): Promise<{ collection: string; id: string } | null> {
  const definition = collection ? ctx.getCollection(collection) : undefined;
  if (!definition || definition.upload !== true) return null;
  const [owner] = await ctx.adapters.database.findMany({
    collection: definition.slug,
    where: { _storageKey: key },
    limit: 1
  });
  return owner ? { collection: definition.slug, id: owner.id as string } : null;
}

function createdAt(intent: DatabaseRecord): number {
  const value = typeof intent.created_at === 'string' ? Date.parse(intent.created_at) : NaN;
  return Number.isNaN(value) ? 0 : value;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Puts a `delete` intent back after a claimed object could not be deleted, so the next run retries. */
async function restoreIntent(
  ctx: OperationContext,
  key: string,
  collection: string,
  err: unknown,
  when: string
): Promise<void> {
  try {
    await ctx.adapters.database.create(STORAGE_INTENTS_COLLECTION, {
      key,
      reason: 'delete',
      collection
    });
    logCleanupFailure(key, when, err, 'kept');
  } catch (restoreErr) {
    logCleanupFailure(key, when, err, 'lost');
    getLogger().error(
      `Could not restore the storage intent for '${key}': ${messageOf(restoreErr)}`
    );
  }
}

function keyCollection(key: string): string {
  return key.split('/')[0] ?? '';
}

/** The key and the error's message only — never the error object, which can carry request/credential details. */
function logCleanupFailure(key: string, when: string, err: unknown, intent: 'kept' | 'lost'): void {
  getLogger().error(
    `Failed to delete storage object '${key}' ${when}: ${messageOf(err)}. ` +
      (intent === 'kept'
        ? `Its storage intent remains; run reconcileStorage() to retry (spec 067).`
        : `Its storage intent could not be kept, so the object is now orphaned and must be removed by ` +
          `hand (spec 067).`)
  );
}
