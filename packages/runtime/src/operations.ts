import { getLogger, validateCollection } from '@forge-cms/core';
import type { AccessQuery, CmsUser, CollectionDefinition, DraftStatus } from '@forge-cms/core';
import type {
  AtomicWriteOperation,
  DatabaseRecord,
  DatabaseWhere,
  SortInput,
  WriteCondition
} from '@forge-cms/db';
import {
  ATOMIC_WRITE_MAX_OPERATIONS,
  isAtomicWriteConditionError,
  isUniqueConstraintError as isDbUniqueConstraintError
} from '@forge-cms/db';
import type { OperationContext } from './context.js';
import {
  AccessDeniedError,
  ConcurrentModificationError,
  ForgeError,
  InvalidInputError,
  NotFoundError,
  UniqueConstraintError,
  ValidationFailedError
} from './errors.js';
import { documentMatches, mergeWhere } from './access.js';
import { assertNotAuthManaged } from './auth-managed.js';
import { validateSort, validateWhere } from './query-validation.js';
import { canonicalizeDates } from './dates.js';
import { applyAutoSlugs, applyFieldDefaults } from './defaults.js';
import { checkAccess, statusConstraint } from './read-policy.js';
import {
  runAfterChangeHooks,
  runAfterDeleteHooks,
  runAfterOperationHooks,
  runAfterReadHooks,
  runBeforeChangeHooks,
  runBeforeDeleteHooks,
  runBeforeOperationHooks,
  runBeforeReadHooks,
  runBeforeValidateHooks,
  runFieldHooks
} from './hooks.js';
import { assertWritableFields, filterReadableFields, FieldAccessError } from './field-access.js';
import { populateRecord, populateRecords } from './populate.js';
import { screenCreateInput, screenHookOutput, screenUpdateInput } from './system-fields.js';
import {
  buildSnapshot,
  buildVersionRecord,
  diffAgainst,
  isVersionIdentityConflict,
  readLatestVersionNumber,
  readVersionForRestore,
  restoreTarget,
  versionsCollectionSlug,
  versionsEnabled
} from './versions.js';
import type { RestorableVersion, RestoreVersionArgs } from './versions.js';
import {
  isLocalizedCollection,
  isLocalizedField,
  storeLocalizedDocument,
  resolveLocalizedDocument
} from './localization.js';
import {
  collectWrittenTargets,
  echoedReferenceGuard,
  planRelationDelete,
  setNullPatch,
  targetAssertions,
  verifyTargetsExist
} from './relation-lifecycle.js';
import type { PlannedDelete, PlannedSetNull } from './relation-lifecycle.js';
import { afterStamp } from './concurrency.js';
import {
  claimUploadIntent,
  deletionIntent,
  finishDeletion,
  recordUploadIntent,
  settleFailedUpload
} from './storage-intents.js';

/** A page of documents plus everything a paginator needs. */
export interface PaginatedDocs<TDoc = DatabaseRecord> {
  docs: TDoc[];
  /** Total documents matching the query, ignoring limit/offset. */
  totalDocs: number;
  limit: number | undefined;
  offset: number;
  /** 1-based page number derived from limit/offset; always 1 when unpaginated. */
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface BaseOperationArgs {
  collection: string;
  /**
   * The user the operation runs as. `null`/omitted means anonymous.
   */
  user?: CmsUser | null;
  /**
   * Skip collection- and field-level access checks. Defaults to **true**: a direct Local API call
   * comes from trusted server code that has already decided it is allowed to do this. The HTTP layer
   * always passes `false` so requests from the network are checked.
   */
  overrideAccess?: boolean;
  /** `1` replaces relation ids with the related document. Only one level is supported. */
  depth?: 0 | 1;
  /** Locale for reading/writing localized fields. */
  locale?: string;
}

export interface FindArgs extends BaseOperationArgs {
  where?: DatabaseWhere;
  limit?: number;
  offset?: number;
  sort?: SortInput;
  /** Only meaningful when `sort` is a plain field name; a multi-field `sort` carries its own per-field order. */
  order?: 'asc' | 'desc';
  /** Only meaningful on a `drafts: true` collection. Defaults to `published`. */
  status?: DraftStatus | 'all';
}

export interface FindByIDArgs extends BaseOperationArgs {
  id: string;
}

/** Same read pipeline as {@link find}, narrowed to at most one document (spec 050 §5). */
export interface FindOneArgs extends BaseOperationArgs {
  where?: DatabaseWhere;
  sort?: SortInput;
  order?: 'asc' | 'desc';
  status?: DraftStatus | 'all';
}

export interface CountArgs extends BaseOperationArgs {
  where?: DatabaseWhere;
  status?: DraftStatus | 'all';
}

export interface CreateArgs extends BaseOperationArgs {
  data: Record<string, unknown>;
}

export interface UpdateArgs extends BaseOperationArgs {
  id: string;
  data: Record<string, unknown>;
  /**
   * Overrides the default (unlabeled) version snapshot's label when this update creates one — used by
   * {@link restoreVersion} so a restore creates exactly one version, labeled, instead of restoring
   * through a second bespoke write path (spec 058 §2).
   */
  versionLabel?: string;
}

export interface DeleteArgs extends BaseOperationArgs {
  id: string;
}

function getCollectionOrThrow(ctx: OperationContext, slug: string): CollectionDefinition {
  const collection = ctx.getCollection(slug);
  if (!collection) throw new NotFoundError(`Collection '${slug}' not found`);
  return collection;
}

function notFound(slug: string, id: string): NotFoundError {
  return new NotFoundError(`Record '${id}' not found in '${slug}'`);
}

/**
 * Runs a database write, converting `@forge-cms/db`'s adapter-level `UniqueConstraintError` into this
 * package's `ForgeError` subclass. `@forge-cms/db` and `@forge-cms/cloudflare` cannot depend on
 * `@forge-cms/runtime` (see ARCHITECTURE.md's dependency graph), so every adapter throws the same
 * db-level error and this is the one place that translates it for callers.
 */
async function runWrite<T>(collection: string, op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    if (isDbUniqueConstraintError(err)) throw new UniqueConstraintError(collection, err.fields);
    throw err;
  }
}

/**
 * The database for a versioned write. Document + snapshot must be one atomic batch (spec 062), so an
 * adapter without `atomicWrite()` is refused rather than silently downgraded to two separate writes.
 * `syncSchema()` already refuses it up front; this is the same check at the point of use.
 */
function atomicDatabase(ctx: OperationContext, collection: CollectionDefinition) {
  const database = ctx.adapters.database;
  if (typeof (database as Partial<typeof database>).atomicWrite !== 'function') {
    throw new Error(
      `Collection '${collection.slug}' has versions enabled, which requires a DatabaseAdapter ` +
        `implementing atomicWrite() (specs 060/062); '${database.name}' does not.`
    );
  }
  return database;
}

/**
 * A relation target named by a write was deleted after the write verified it existed (spec 064 §4): the
 * batch's `assertCount` failed and nothing was written. Reported as a conflict, never as bad input —
 * "the target was missing to begin with" is only ever reported from the pre-batch read.
 */
function targetVanished(collection: CollectionDefinition, id: string): ConcurrentModificationError {
  return new ConcurrentModificationError(
    collection.slug,
    id,
    `A document referenced by this write to '${collection.slug}' was deleted by another request while ` +
      `it was in progress; nothing was written. Reload and try again.`
  );
}

/**
 * Maps what a rolled-back document + snapshot batch threw to the runtime's typed errors (spec 062 §3).
 * The version table's `(documentId, versionNumber)` index is an internal detail: on update it means
 * another writer committed first (`ConcurrentModificationError`); on create it means the id is already
 * taken by an existing — possibly deleted — document's history, reported like any duplicate id. The
 * internal table name never reaches the caller.
 *
 * With relation-target assertions in the batch (spec 064) an `AtomicWriteConditionError` on create can
 * only be an assertion (creates never have to apply); on update it is either an assertion or the plain
 * `update` of a document deleted meanwhile — the database does not say which, so both are a `409`.
 */
function toVersionedWriteError(
  err: unknown,
  collection: CollectionDefinition,
  id: string,
  operation: 'create' | 'update',
  hasAssertions: boolean
): unknown {
  if (isVersionIdentityConflict(err, collection)) {
    return operation === 'create'
      ? new UniqueConstraintError(collection.slug, ['id'])
      : new ConcurrentModificationError(collection.slug, id);
  }
  if (isDbUniqueConstraintError(err)) return new UniqueConstraintError(collection.slug, err.fields);
  if (isAtomicWriteConditionError(err)) {
    if (!hasAssertions) return notFound(collection.slug, id);
    return operation === 'create'
      ? targetVanished(collection, id)
      : new ConcurrentModificationError(
          collection.slug,
          id,
          `Document '${id}' in '${collection.slug}', or a document this update references, was changed ` +
            `or deleted by another request while this one was in progress; nothing was written. Reload ` +
            `it and try again.`
        );
  }
  return err;
}

/**
 * Versioned create (spec 062 §2): the document and its version 1 in one `atomicWrite()`, preceded by
 * the write's relation-target assertions (spec 064) — one batch, never a second transaction. The batch
 * is declarative and cannot feed a generated id from one operation into the next, so the id is allocated
 * here — a trusted caller's explicit `id` if it supplied one (spec 063 §2), otherwise a UUID, which is
 * what the adapters would have generated. `row` is what the document row persists (content plus any
 * Forge-owned metadata such as `_storageKey`); the snapshot is built from content only.
 */
async function createWithSnapshot(
  ctx: OperationContext,
  collection: CollectionDefinition,
  input: {
    row: Record<string, unknown>;
    id: string | undefined;
    user: CmsUser | null;
    assertions: AtomicWriteOperation[];
  }
): Promise<DatabaseRecord> {
  const database = atomicDatabase(ctx, collection);
  const id = input.id ?? crypto.randomUUID();
  const { row, user, assertions } = input;

  let results: Awaited<ReturnType<typeof database.atomicWrite>>;
  try {
    results = await database.atomicWrite([
      ...assertions,
      { type: 'create', collection: collection.slug, data: { ...row, id } },
      {
        type: 'create',
        collection: versionsCollectionSlug(collection.slug),
        data: buildVersionRecord({
          documentId: id,
          versionNumber: 1,
          data: buildSnapshot(collection, row),
          user,
          full: true
        })
      }
    ]);
  } catch (err) {
    throw toVersionedWriteError(err, collection, id, 'create', assertions.length > 0);
  }

  const created = results[assertions.length];
  if (created?.type !== 'create') throw new Error('atomicWrite returned no created document');
  return created.record;
}

/**
 * The document write and snapshot of a prepared versioned update (spec 062 §3), as batch operations.
 * `versionNumber` is one past the latest version observed *before* the document was read, so if anyone
 * committed in between, the snapshot collides with theirs on the unique `(documentId, versionNumber)`
 * index and the whole batch — document patch included — rolls back. Shared by `update()` and by the
 * set-null updates a relation delete folds into its own batch (spec 064 §5), so there is one mechanism.
 */
function versionedUpdateOperations(
  prepared: PreparedUpdate,
  echoGuard?: DatabaseWhere
): AtomicWriteOperation[] {
  const { collection, id, data, existing } = prepared;
  return [
    echoGuard === undefined
      ? { type: 'update', collection: collection.slug, id, data }
      : {
          type: 'updateIf',
          collection: collection.slug,
          id,
          data,
          condition: { targetMatches: echoGuard },
          requireApplied: true
        },
    {
      type: 'create',
      collection: versionsCollectionSlug(collection.slug),
      data: buildVersionRecord({
        documentId: id,
        versionNumber: prepared.latestVersion + 1,
        // `{ ...existing, ...data }` is exactly what the batch leaves in the row: it only commits if
        // no one else wrote this document since `existing` was read.
        data: buildSnapshot(collection, { ...existing, ...data }),
        user: prepared.user,
        full: true,
        ...(prepared.versionLabel !== undefined && { label: prepared.versionLabel })
      })
    }
  ];
}

/**
 * Commits a prepared update: a versioned document with its snapshot (spec 062), and any relation-target
 * assertions (spec 064) in the same single batch. A non-versioned update with nothing to assert keeps
 * the plain single-call write.
 */
async function commitUpdate(
  ctx: OperationContext,
  prepared: PreparedUpdate,
  assertions: AtomicWriteOperation[],
  echoGuard?: DatabaseWhere
): Promise<DatabaseRecord> {
  const { collection, id, data } = prepared;

  if (prepared.versioned) {
    const database = atomicDatabase(ctx, collection);
    let results: Awaited<ReturnType<typeof database.atomicWrite>>;
    try {
      results = await database.atomicWrite([
        ...assertions,
        ...versionedUpdateOperations(prepared, echoGuard)
      ]);
    } catch (err) {
      throw toVersionedWriteError(
        err,
        collection,
        id,
        'update',
        assertions.length > 0 || echoGuard !== undefined
      );
    }
    const updated = results[assertions.length];
    if (updated?.type === 'update' || (updated?.type === 'updateIf' && updated.applied)) {
      return updated.record;
    }
    throw new Error('atomicWrite returned no updated document');
  }

  if (assertions.length === 0 && echoGuard === undefined) {
    return runWrite(collection.slug, () => ctx.adapters.database.update(collection.slug, id, data));
  }

  // Not required to apply: a document that is gone, or no longer holds the references this update
  // re-sends, is `applied: false` (nothing written), so the only thing that can fail the batch is a
  // target assertion.
  let results: Awaited<ReturnType<typeof ctx.adapters.database.atomicWrite>>;
  try {
    results = await ctx.adapters.database.atomicWrite([
      ...assertions,
      {
        type: 'updateIf',
        collection: collection.slug,
        id,
        data,
        condition: echoGuard === undefined ? {} : { targetMatches: echoGuard }
      }
    ]);
  } catch (err) {
    if (isAtomicWriteConditionError(err)) throw targetVanished(collection, id);
    if (isDbUniqueConstraintError(err))
      throw new UniqueConstraintError(collection.slug, err.fields);
    throw err;
  }
  const updated = results[assertions.length];
  if (updated?.type !== 'updateIf') throw new Error('atomicWrite returned no update result');
  if (updated.applied) return updated.record;
  // Which of the two it was only picks the error: nothing was written either way.
  if (!(await ctx.adapters.database.findById(collection.slug, id))) {
    throw notFound(collection.slug, id);
  }
  throw new ConcurrentModificationError(
    collection.slug,
    id,
    `Document '${id}' in '${collection.slug}' was changed by another request while this update was in ` +
      `progress (it no longer matches the caller's update access, another locale was edited, or a ` +
      `reference this update re-sends was cleared); nothing was written. Reload it and try again.`
  );
}

/**
 * Commits a new non-versioned document. With relation-target assertions the create joins them in one
 * batch (spec 064 §4); a create never has to apply, so a failed batch condition is always an assertion.
 */
async function commitCreate(
  ctx: OperationContext,
  collection: CollectionDefinition,
  row: Record<string, unknown>,
  assertions: AtomicWriteOperation[]
): Promise<DatabaseRecord> {
  if (assertions.length === 0) {
    return runWrite(collection.slug, () => ctx.adapters.database.create(collection.slug, row));
  }
  let results: Awaited<ReturnType<typeof ctx.adapters.database.atomicWrite>>;
  try {
    results = await ctx.adapters.database.atomicWrite([
      ...assertions,
      { type: 'create', collection: collection.slug, data: row }
    ]);
  } catch (err) {
    if (isAtomicWriteConditionError(err)) {
      throw targetVanished(collection, typeof row.id === 'string' ? row.id : '(new)');
    }
    if (isDbUniqueConstraintError(err))
      throw new UniqueConstraintError(collection.slug, err.fields);
    throw err;
  }
  const created = results[assertions.length];
  if (created?.type !== 'create') throw new Error('atomicWrite returned no created document');
  return created.record;
}

/**
 * Validates the relation targets a write introduces and returns the assertions that keep them valid
 * until it commits (spec 064 §4). A known-missing target is a `400` here, before any write.
 */
async function relationTargetGuards(
  ctx: OperationContext,
  collection: CollectionDefinition,
  data: Record<string, unknown>,
  existing?: Record<string, unknown>,
  /** A create's explicit id: a self reference names the document the same batch creates. */
  selfId?: string
): Promise<AtomicWriteOperation[]> {
  const targets = collectWrittenTargets(collection.fields, data, existing);
  const self = selfId !== undefined ? targets.get(collection.slug) : undefined;
  if (self && selfId !== undefined) {
    self.ids.delete(selfId);
    if (self.ids.size === 0) targets.delete(collection.slug);
  }
  if (targets.size === 0) return [];
  await verifyTargetsExist(ctx, targets);
  return targetAssertions(targets);
}

/**
 * Runs a stage that may reject the write. A hook throwing a plain `Error` is a rejection of the
 * caller's payload (400), not a server fault — preserving the spec-013 contract that a throwing
 * `beforeChange` hook fails the request with its own message.
 */
async function runRejectableStage<T>(stage: () => Promise<T>, label: string): Promise<T> {
  try {
    return await stage();
  } catch (err) {
    if (err instanceof ForgeError) throw err;
    throw new InvalidInputError(err instanceof Error ? err.message : `${label} failed`);
  }
}

function assertDraftStatus(collection: CollectionDefinition, data: Record<string, unknown>): void {
  if (collection.drafts !== true || data._status === undefined) return;
  if (data._status !== 'draft' && data._status !== 'published') {
    throw new InvalidInputError(
      `Invalid status '${String(data._status)}', expected 'draft' or 'published'`
    );
  }
}

/** The shared read-side tail: populate relations, strip unreadable fields, run read hooks. */
async function prepareForRead(
  ctx: OperationContext,
  collection: CollectionDefinition,
  records: DatabaseRecord[],
  args: { user?: CmsUser | null; overrideAccess?: boolean; depth?: 0 | 1; locale?: string }
): Promise<DatabaseRecord[]> {
  const user = args.user ?? null;
  const overrideAccess = args.overrideAccess !== false;
  let docs = records;

  if (args.depth === 1) {
    docs = await populateRecords(docs, collection, ctx, { user, overrideAccess });
  }

  if (args.overrideAccess === false) {
    docs = await Promise.all(docs.map((doc) => filterReadableFields(doc, collection, user)));
  }

  // Resolve localized fields if locale is specified
  if (args.locale && isLocalizedCollection(collection)) {
    docs = docs.map((doc) => resolveLocalizedDocument(doc, collection, args.locale));
  }

  docs = await Promise.all(
    docs.map(async (doc) => {
      const withFieldHooks = await runFieldHooks(collection, 'afterRead', {
        data: doc,
        operation: 'read',
        user,
        overrideAccess
      });
      return runAfterReadHooks(collection, { user, overrideAccess, doc: withFieldHooks });
    })
  );

  return docs;
}

async function prepareReadQuery(
  collection: CollectionDefinition,
  args: {
    where?: DatabaseWhere;
    status?: DraftStatus | 'all';
    user?: CmsUser | null;
    overrideAccess?: boolean;
  },
  defaultStatus: DraftStatus | 'all'
): Promise<DatabaseWhere | undefined> {
  const user = args.user ?? null;
  const overrideAccess = args.overrideAccess !== false;

  // Validate the caller-supplied `where` before it is ever merged with a (trusted) access constraint
  // or reaches an adapter — the one gate shared by find/count/findOne (spec 050 §4/§8).
  validateWhere(collection, args.where);

  const decision = await checkAccess(collection, 'read', args);

  let where = mergeWhere(args.where, decision.where);
  where = mergeWhere(
    where,
    statusConstraint(collection, args.status, user, args.overrideAccess !== false, defaultStatus)
  );
  // `runBeforeReadHooks` speaks core's public, deliberately-flat `AccessQuery` hook contract; `where`
  // here is the richer runtime-internal `DatabaseWhere` (possibly a nested and/or group after
  // mergeWhere) — cast at the boundary in both directions, same as `resolveAccess` does the same
  // crossing in reverse.
  where = (await runBeforeReadHooks(collection, {
    user,
    overrideAccess,
    query: (where ?? {}) as AccessQuery
  })) as DatabaseWhere;

  return where !== undefined && Object.keys(where).length > 0 ? where : undefined;
}

export async function find(ctx: OperationContext, args: FindArgs): Promise<PaginatedDocs> {
  const collection = getCollectionOrThrow(ctx, args.collection);
  const user = args.user ?? null;
  const overrideAccess = args.overrideAccess !== false;

  await runBeforeOperationHooks(collection, { operation: 'read', user, overrideAccess });
  validateSort(collection, args.sort);

  const where = await prepareReadQuery(collection, args, 'published');
  const findOptions = {
    collection: args.collection,
    ...(args.limit !== undefined && { limit: args.limit }),
    ...(args.offset !== undefined && { offset: args.offset }),
    ...(where !== undefined && { where }),
    ...(args.sort !== undefined && { sort: args.sort }),
    ...(args.order !== undefined && { order: args.order })
  };

  const [records, totalDocs] = await Promise.all([
    ctx.adapters.database.findMany(findOptions),
    ctx.adapters.database.count(args.collection, where)
  ]);

  const docs = await prepareForRead(ctx, collection, records, args);
  const result = paginate(docs, totalDocs, args.limit, args.offset ?? 0);

  await runAfterOperationHooks(collection, { operation: 'read', user, overrideAccess, result });
  return result;
}

/**
 * Same read pipeline as {@link find} (access, hooks, drafts, locale, relation population), narrowed
 * to the first matching document — or `null` rather than throwing when there is none (spec 050 §4).
 * Unlike `find`, this never calls `count()`: there is no pagination metadata to compute, so the query
 * goes straight to the adapter with `limit: 1` (a real database-side `LIMIT`, not "fetch everything and
 * take the first" — spec 050 §21).
 */
export async function findOne(
  ctx: OperationContext,
  args: FindOneArgs
): Promise<DatabaseRecord | null> {
  const collection = getCollectionOrThrow(ctx, args.collection);
  const user = args.user ?? null;
  const overrideAccess = args.overrideAccess !== false;

  await runBeforeOperationHooks(collection, { operation: 'read', user, overrideAccess });
  validateSort(collection, args.sort);

  const where = await prepareReadQuery(collection, args, 'published');
  const findOptions = {
    collection: args.collection,
    limit: 1,
    ...(where !== undefined && { where }),
    ...(args.sort !== undefined && { sort: args.sort }),
    ...(args.order !== undefined && { order: args.order })
  };

  const records = await ctx.adapters.database.findMany(findOptions);
  const docs = await prepareForRead(ctx, collection, records, args);
  const result = docs[0] ?? null;

  await runAfterOperationHooks(collection, { operation: 'read', user, overrideAccess, result });
  return result;
}

function paginate(
  docs: DatabaseRecord[],
  totalDocs: number,
  limit: number | undefined,
  offset: number
): PaginatedDocs {
  const totalPages = limit !== undefined && limit > 0 ? Math.ceil(totalDocs / limit) : 1;
  const page = limit !== undefined && limit > 0 ? Math.floor(offset / limit) + 1 : 1;

  return {
    docs,
    totalDocs,
    limit,
    offset,
    page,
    totalPages,
    hasNextPage: offset + docs.length < totalDocs,
    hasPrevPage: offset > 0
  };
}

export async function findByID(
  ctx: OperationContext,
  args: FindByIDArgs & { status?: DraftStatus | 'all' }
): Promise<DatabaseRecord> {
  const collection = getCollectionOrThrow(ctx, args.collection);
  const user = args.user ?? null;
  const overrideAccess = args.overrideAccess !== false;

  await runBeforeOperationHooks(collection, { operation: 'read', user, overrideAccess });

  const decision = await checkAccess(collection, 'read', { ...args, id: args.id });

  const record = await ctx.adapters.database.findById(args.collection, args.id);
  if (!record) throw notFound(args.collection, args.id);

  // A document the caller may not reach must 404, not 403: a 403 confirms the id exists.
  if (decision.where && !documentMatches(record, decision.where)) {
    throw notFound(args.collection, args.id);
  }

  const status = statusConstraint(
    collection,
    args.status,
    user,
    args.overrideAccess !== false,
    'all'
  );
  if (status && !documentMatches(record, status)) {
    throw notFound(args.collection, args.id);
  }

  const [doc] = await prepareForRead(ctx, collection, [record], args);
  const result = doc ?? record;

  await runAfterOperationHooks(collection, { operation: 'read', user, overrideAccess, result });
  return result;
}

export async function count(ctx: OperationContext, args: CountArgs): Promise<number> {
  const collection = getCollectionOrThrow(ctx, args.collection);
  const user = args.user ?? null;
  const overrideAccess = args.overrideAccess !== false;

  await runBeforeOperationHooks(collection, { operation: 'read', user, overrideAccess });

  const where = await prepareReadQuery(collection, args, 'published');
  const result = await ctx.adapters.database.count(args.collection, where);
  await runAfterOperationHooks(collection, { operation: 'read', user, overrideAccess, result });
  return result;
}

export async function create(ctx: OperationContext, args: CreateArgs): Promise<DatabaseRecord> {
  return createDocument(ctx, args, undefined);
}

/**
 * The multipart upload pipeline's create (spec 063 §5) — **package-private**: exported for
 * `handlers.ts` only, never from the package entry point. `storageKey` is the key Forge itself just
 * generated and stored the object under; it is merged into the persisted row only, outside caller
 * `data` and hook `data`, so no caller of the public mutation surface can choose or rewrite it.
 */
export async function createUpload(
  ctx: OperationContext,
  args: CreateArgs,
  upload: { storageKey: string; intentId: string }
): Promise<DatabaseRecord> {
  const collection = getCollectionOrThrow(ctx, args.collection);
  if (collection.upload !== true) {
    throw new Error(`Collection '${args.collection}' is not upload-enabled`);
  }
  return createDocument(ctx, args, upload);
}

/**
 * The whole upload create (spec 067) — **package-private**, called by `handleCreate` for a multipart
 * body: records a durable storage intent, stores the object under a Forge-generated key, then creates
 * the document with the key and the intent claim in one batch. Any failure after the intent exists
 * settles it: the object is deleted only while the intent is still there (the document never
 * committed); otherwise the intent stays for `reconcileStorage()`. The file's `filename`, `url`,
 * `contentType` and `filesize` fill whichever of those fields the collection declares, under `args.data`.
 */
export async function uploadFile(
  ctx: OperationContext,
  args: CreateArgs,
  file: File
): Promise<DatabaseRecord> {
  const collection = getCollectionOrThrow(ctx, args.collection);
  if (collection.upload !== true) {
    throw new Error(`Collection '${args.collection}' is not upload-enabled`);
  }
  assertNotAuthManaged(ctx, args.collection);

  const storageKey = `${collection.slug}/${crypto.randomUUID()}-${file.name}`;
  const intentId = await recordUploadIntent(ctx.adapters.database, collection.slug, storageKey);
  try {
    await ctx.adapters.storage.put({ key: storageKey, body: file, contentType: file.type });
    const url = await ctx.adapters.storage.getPublicUrl(storageKey);
    const derived: Record<string, unknown> = {
      filename: file.name,
      url,
      contentType: file.type,
      filesize: file.size
    };
    const data: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(derived)) {
      if (collection.fields[name]) data[name] = value;
    }
    return await createDocument(
      ctx,
      { ...args, data: { ...data, ...args.data } },
      { storageKey, intentId }
    );
  } catch (err) {
    await settleFailedUpload(ctx, intentId, storageKey);
    throw err;
  }
}

async function createDocument(
  ctx: OperationContext,
  args: CreateArgs,
  upload: { storageKey: string; intentId: string } | undefined
): Promise<DatabaseRecord> {
  const collection = getCollectionOrThrow(ctx, args.collection);
  assertNotAuthManaged(ctx, args.collection);
  const user = args.user ?? null;
  const overrideAccess = args.overrideAccess !== false;

  await runBeforeOperationHooks(collection, { operation: 'create', user, overrideAccess });
  await checkAccess(collection, 'create', { ...args, data: args.data });

  // Spec 063: Forge-owned metadata never comes from the caller. A trusted caller's explicit `id` is
  // held aside (hooks never see or change it) and re-attached at persistence.
  const { content, id: explicitId } = screenCreateInput(args.data, overrideAccess);

  if (args.overrideAccess === false) {
    try {
      await assertWritableFields(content, collection, user, 'create');
    } catch (err) {
      if (err instanceof FieldAccessError) throw new AccessDeniedError(err.message);
      throw err;
    }
  }

  // Defaults and auto-slugs are resolved before any hook runs, so a hook still gets the last word
  // and validation only ever sees the final value.
  const seeded = applyAutoSlugs(collection, applyFieldDefaults(collection, content));

  // Process localized fields if the collection has locales configured
  const processedData =
    isLocalizedCollection(collection) && args.locale
      ? storeLocalizedDocument(seeded, collection, args.locale)
      : seeded;

  let data = await runRejectableStage(
    async () =>
      runBeforeValidateHooks(collection, {
        operation: 'create',
        data: await runFieldHooks(collection, 'beforeValidate', {
          data: processedData,
          operation: 'create',
          user,
          overrideAccess
        }),
        user,
        overrideAccess
      }),
    'beforeValidate hook'
  );
  data = screenHookOutput(data, {}, 'beforeValidate', args.collection);

  assertDraftStatus(collection, data);
  if (collection.drafts === true && data._status === undefined) {
    data = { ...data, _status: 'draft' };
  }

  const validation = validateCollection(collection, data);
  if (!validation.valid) throw new ValidationFailedError(validation.errors);

  data = await runRejectableStage(
    async () =>
      runBeforeChangeHooks(collection, {
        operation: 'create',
        data: await runFieldHooks(collection, 'beforeChange', {
          data,
          operation: 'create',
          user,
          overrideAccess
        }),
        user,
        overrideAccess
      }),
    'beforeChange hook'
  );
  data = screenHookOutput(data, {}, 'beforeChange', args.collection);
  // One date representation at rest and on the wire (spec 076).
  data = canonicalizeDates(collection.fields, data);

  // Every relation target this document names must exist, now and when it commits (spec 064 §4).
  const assertions = await relationTargetGuards(ctx, collection, data, undefined, explicitId);
  // An upload's storage intent is removed in the same batch that creates its owner (spec 067), so the
  // intent exists exactly as long as the object is owned by nothing.
  if (upload) assertions.push(claimUploadIntent(upload.intentId));

  // Forge-owned metadata joins the content only here, at the persistence boundary (spec 063 §4/§5).
  const row = upload !== undefined ? { ...data, _storageKey: upload.storageKey } : data;

  // A versioned document and its version 1 commit together or not at all (spec 062 §2).
  const record = versionsEnabled(collection)
    ? await createWithSnapshot(ctx, collection, { row, id: explicitId, user, assertions })
    : await commitCreate(
        ctx,
        collection,
        explicitId !== undefined ? { ...row, id: explicitId } : row,
        assertions
      );

  await runAfterChangeHooks(collection, {
    operation: 'create',
    data,
    result: record,
    doc: record,
    user,
    overrideAccess
  });

  const result = await writeResult(ctx, collection, record, args);

  await runAfterOperationHooks(collection, { operation: 'create', user, overrideAccess, result });
  return result;
}

export async function update(ctx: OperationContext, args: UpdateArgs): Promise<DatabaseRecord> {
  return updateDocument(ctx, args);
}

/**
 * Everything an update decided before writing (spec 064 §5): the stored document it was decided
 * against, the final patch after hooks and screening, and — for a versioned collection — the version
 * number observed before that read. Produced by {@link prepareUpdate}, committed either on its own
 * ({@link commitUpdate}) or folded into a relation delete's batch, then finished by {@link finalizeUpdate}.
 */
interface PreparedUpdate {
  collection: CollectionDefinition;
  id: string;
  args: UpdateArgs;
  user: CmsUser | null;
  overrideAccess: boolean;
  existing: DatabaseRecord;
  data: Record<string, unknown>;
  versioned: boolean;
  latestVersion: number;
  versionLabel: string | undefined;
  /** The caller's update-access query, re-checked inside the write itself (spec 068). */
  accessWhere: DatabaseWhere | undefined;
}

/**
 * The update pipeline up to — never including — the write: `beforeOperation`, version-number read (spec
 * 062 §3: before the document), document read, access, system-field screening, field-write access,
 * locale storage, `beforeValidate`, validation, `beforeChange`. One implementation for `update()`,
 * `restoreVersion()` and relation set-null (spec 064), so none of them can drift.
 *
 * `restore` (only ever passed by {@link restoreVersion}) replaces `args.data` with the difference between
 * that version's content and the document as read *here* — after the version number was observed — so a
 * restore is serialized exactly like any other update (spec 062 §6). `patch` computes the request from
 * the document as read here (relation set-null); returning `null` means there is nothing to change, and
 * the preparation stops (`null`) before any further hook.
 */
async function prepareUpdate(
  ctx: OperationContext,
  args: UpdateArgs,
  options: {
    restore?: RestorableVersion;
    patch?: (existing: DatabaseRecord) => Record<string, unknown> | null;
  } = {}
): Promise<PreparedUpdate | null> {
  const collection = getCollectionOrThrow(ctx, args.collection);
  assertNotAuthManaged(ctx, args.collection);
  const user = args.user ?? null;
  const overrideAccess = args.overrideAccess !== false;

  await runBeforeOperationHooks(collection, { operation: 'update', user, overrideAccess });

  // Spec 062 §3: the latest version number is read BEFORE the document. A write that commits version
  // N+1 therefore proves nobody committed between this observation and the document read below — the
  // unique (documentId, versionNumber) index turns any such interleaving into a rolled-back conflict.
  const versioned = versionsEnabled(collection);
  const latestVersion = versioned
    ? await readLatestVersionNumber(ctx.adapters.database, collection, args.id)
    : 0;

  const existing = await ctx.adapters.database.findById(args.collection, args.id);
  if (!existing) throw notFound(args.collection, args.id);

  let requested: Record<string, unknown>;
  if (options.restore) {
    requested = diffAgainst(restoreTarget(collection, options.restore), existing);
  } else if (options.patch) {
    const patch = options.patch(existing);
    if (patch === null) return null;
    requested = patch;
  } else {
    requested = args.data;
  }

  const decision = await checkAccess(collection, 'update', {
    ...args,
    id: args.id,
    data: requested,
    doc: existing
  });
  if (decision.where && !documentMatches(existing, decision.where)) {
    throw new AccessDeniedError();
  }

  // Spec 063: echoes of the stored metadata are dropped; changing `id`, a timestamp or `_storageKey`
  // is refused for every caller, `overrideAccess` included.
  const input = screenUpdateInput(requested, existing);

  if (args.overrideAccess === false) {
    try {
      await assertWritableFields(input, collection, user, 'update');
    } catch (err) {
      if (err instanceof FieldAccessError) throw new AccessDeniedError(err.message);
      throw err;
    }
  }

  // Process localized fields if the collection has locales configured
  const processedData =
    isLocalizedCollection(collection) && args.locale
      ? storeLocalizedDocument(input, collection, args.locale, existing)
      : input;

  let data = await runRejectableStage(
    async () =>
      runBeforeValidateHooks(collection, {
        operation: 'update',
        data: await runFieldHooks(collection, 'beforeValidate', {
          data: applyAutoSlugs(collection, processedData, existing),
          previousData: existing,
          operation: 'update',
          user,
          overrideAccess
        }),
        previousData: existing,
        user,
        overrideAccess
      }),
    'beforeValidate hook'
  );
  data = screenHookOutput(data, existing, 'beforeValidate', args.collection);

  assertDraftStatus(collection, data);

  // Validate the merged document so required fields already stored do not fail a partial update,
  // then report only the errors the caller can actually act on: fields they are touching, or fields
  // that are still missing entirely.
  const merged = { ...existing, ...data };
  const validation = validateCollection(collection, merged);
  if (!validation.valid) {
    const relevant = validation.errors.filter((e) => {
      const top = e.field.split('.')[0] ?? e.field;
      return data[top] !== undefined || existing[top] === undefined;
    });
    if (relevant.length > 0) throw new ValidationFailedError(relevant);
  }

  data = await runRejectableStage(
    async () =>
      runBeforeChangeHooks(collection, {
        operation: 'update',
        data: await runFieldHooks(collection, 'beforeChange', {
          data,
          previousData: existing,
          operation: 'update',
          user,
          overrideAccess
        }),
        previousData: existing,
        user,
        overrideAccess
      }),
    'beforeChange hook'
  );
  data = screenHookOutput(data, existing, 'beforeChange', args.collection);
  data = canonicalizeDates(collection.fields, data);

  return {
    collection,
    id: args.id,
    args,
    user,
    overrideAccess,
    existing,
    data,
    versioned,
    latestVersion,
    versionLabel: args.versionLabel,
    accessWhere: decision.where
  };
}

/** The post-commit half of an update: `afterChange`, the read pipeline, `afterOperation`. */
async function finalizeUpdate(
  ctx: OperationContext,
  prepared: PreparedUpdate,
  record: DatabaseRecord
): Promise<DatabaseRecord> {
  const { collection, data, existing, user, overrideAccess } = prepared;
  await runAfterChangeHooks(collection, {
    operation: 'update',
    data,
    previousData: existing,
    result: record,
    doc: record,
    user,
    overrideAccess
  });

  const result = await writeResult(ctx, collection, record, prepared.args);

  await runAfterOperationHooks(collection, { operation: 'update', user, overrideAccess, result });
  return result;
}

async function updateDocument(
  ctx: OperationContext,
  args: UpdateArgs,
  restore?: RestorableVersion
): Promise<DatabaseRecord> {
  const prepared = await prepareUpdate(ctx, args, restore ? { restore } : {});
  if (!prepared) throw new Error('update preparation produced no change'); // unreachable without `patch`

  // Only relation values this update changes are validated (spec 064 §4) — a partial update never
  // fails over a reference it does not touch.
  const assertions = await relationTargetGuards(
    ctx,
    prepared.collection,
    prepared.data,
    prepared.existing
  );
  // …and the references it re-sends unchanged must still be there when it commits.
  const echoGuard = echoedReferenceGuard(
    prepared.collection.fields,
    prepared.data,
    prepared.existing
  );
  // A locale write merged into the stored per-locale maps must not overwrite a concurrent edit of
  // another locale: it commits only while the row is still the one it merged from (spec 067).
  const localeGuard = localeMergeGuard(prepared);
  if (localeGuard) await afterStamp(prepared.existing.updated_at);
  // A query-returning update rule is a row-level grant: the row must still match it when the write
  // commits, not only when it was read (spec 068).
  const guard = allOf([echoGuard, localeGuard, prepared.accessWhere]);
  const record = await commitUpdate(ctx, prepared, assertions, guard);
  return finalizeUpdate(ctx, prepared, record);
}

/**
 * What a write returns (spec 068). A trusted write (or a caller who may read the result) gets the
 * document through the normal read preparation (field access, locale, population, afterRead hooks). An
 * access-checked caller whose *read* access does not reach the written document — the collection's read
 * rule denies it, its query does not match, or it is a draft they could not read — gets only its `id`:
 * being allowed to write a document is not permission to read it back.
 */
async function writeResult(
  ctx: OperationContext,
  collection: CollectionDefinition,
  record: DatabaseRecord,
  args: BaseOperationArgs & { locale?: string; depth?: 0 | 1 }
): Promise<DatabaseRecord> {
  if (args.overrideAccess === false && !(await canRead(collection, record, args.user ?? null))) {
    return { id: record.id };
  }
  const [doc] = await prepareForRead(ctx, collection, [record], args);
  return doc ?? record;
}

/** The single-document read gate `findByID` applies, as a yes/no for an already-loaded row. */
async function canRead(
  collection: CollectionDefinition,
  record: DatabaseRecord,
  user: CmsUser | null
): Promise<boolean> {
  let decision: Awaited<ReturnType<typeof checkAccess>>;
  try {
    // Exactly `findByID`'s arguments — no `doc`, so a read rule answers the same here as there.
    decision = await checkAccess(collection, 'read', {
      user,
      overrideAccess: false,
      id: record.id as string
    });
  } catch (err) {
    if (err instanceof AccessDeniedError) return false;
    throw err;
  }
  if (decision.where && !documentMatches(record, decision.where)) return false;
  const status = statusConstraint(collection, undefined, user, false, 'all');
  return !status || documentMatches(record, status);
}

/** The conjunction of the defined conditions, or `undefined` when there are none. */
function allOf(conditions: (DatabaseWhere | undefined)[]): DatabaseWhere | undefined {
  const defined = conditions.filter((c): c is DatabaseWhere => c !== undefined);
  if (defined.length === 0) return undefined;
  return defined.length === 1 ? defined[0] : { and: defined };
}

/** `updated_at` compare-and-set for an update that merged a `locale` into stored per-locale maps. */
function localeMergeGuard(prepared: PreparedUpdate): DatabaseWhere | undefined {
  const { collection, args, data, existing } = prepared;
  if (args.locale === undefined || !isLocalizedCollection(collection)) return undefined;
  if (typeof existing.updated_at !== 'string') return undefined;
  const merges = Object.keys(data).some((name) => {
    const field = collection.fields[name];
    return field !== undefined && isLocalizedField(field);
  });
  return merges ? { updated_at: existing.updated_at } : undefined;
}

/**
 * Restores a document to a specific historical version — spec 058 §2, made atomic by spec 062. The raw
 * snapshot is read (trusted — restore's authorization gate is `update()`'s own update-access check on
 * the *current* document, see spec 058 §2) and handed to this module's own update pipeline, which turns
 * it into a patch of only the fields that differ from the current document (spec 062 §6) and then runs
 * the normal update-access / row-policy / field-write / validation / hook pipeline. The patch and one
 * snapshot labeled `Restored from version N` commit in one atomic batch, so a forbidden, invalid or
 * conflicting restore leaves both the document and its history unchanged.
 *
 * System metadata (`id`, `created_at`, `updated_at`, `_storageKey`) is never restored. A full (spec 062)
 * snapshot sets every currently declared field, so a snapshot that predates a now-required field fails
 * current validation instead of producing an invalid document.
 */
export async function restoreVersion(
  ctx: OperationContext,
  args: RestoreVersionArgs
): Promise<DatabaseRecord> {
  const collection = getCollectionOrThrow(ctx, args.collection);
  // A restore is an update; refuse it before reading the snapshot so the answer never depends on it.
  assertNotAuthManaged(ctx, args.collection);
  if (!versionsEnabled(collection)) {
    throw new Error(`Collection '${args.collection}' does not have versions enabled`);
  }

  const restorable = await readVersionForRestore(ctx, collection, args.versionId);

  return updateDocument(
    ctx,
    {
      collection: args.collection,
      id: restorable.version.documentId,
      data: {},
      ...(args.user !== undefined && { user: args.user }),
      ...(args.overrideAccess !== undefined && { overrideAccess: args.overrideAccess }),
      versionLabel: `Restored from version ${restorable.version.versionNumber}`
    },
    restorable
  );
}

/**
 * The storage object a deleted upload document owns: only the `_storageKey` Forge's own upload
 * pipeline recorded (spec 063 §6). There is deliberately no fallback derived from `url` — that is a
 * declared, caller-writable content field, and deleting whatever it points at let any caller with
 * create/update + delete access destroy another document's object.
 */
function ownedStorageKey(doc: DatabaseRecord): string | null {
  const storageKey = doc._storageKey;
  return typeof storageKey === 'string' && storageKey.length > 0 ? storageKey : null;
}

/**
 * Compare-and-set against the document a relation delete planned with (spec 064 §5): it is only
 * written if nobody changed it since. A row without `updated_at` (written outside the pipeline) can only
 * be guarded by existence. Millisecond precision — see the spec's concurrency notes.
 */
function unchangedSince(doc: DatabaseRecord): WriteCondition {
  return typeof doc.updated_at === 'string'
    ? { targetMatches: { updated_at: doc.updated_at } }
    : {};
}

function warnNoStorageKey(collection: CollectionDefinition, doc: DatabaseRecord): void {
  getLogger().warn?.(
    `Upload document '${collection.slug}/${String(doc.id)}' has no Forge-recorded storage key; no ` +
      `storage object will be deleted (spec 063 §6)`
  );
}

/**
 * Deletes a document together with its whole relation graph (spec 064 §5) — plan, prepare, **one**
 * `atomicWrite`, finalize:
 *
 * 1. **Plan** (reads only): root `beforeOperation`, read, access; then {@link planRelationDelete} walks
 *    every cascade/set-null/restrict reference to its fixpoint, judges restrict and required set-null
 *    against the final state, and refuses a plan that cannot fit in one batch — before any `before*`
 *    hook of the graph and before any write.
 * 2. **Prepare** (hooks, validation; no writes): root `beforeDelete`; each cascaded document's
 *    `beforeOperation` + `beforeDelete`; each set-null document through the same {@link prepareUpdate}
 *    `update()` uses. Dependents run with `overrideAccess: true` — a consequence of an authorized delete,
 *    like a database's own `ON DELETE CASCADE` (spec 058 §5) — but never skip validation or hooks.
 * 3. **Commit**: set-null patches (versioned: spec 062's update + snapshot), cascaded deletes guarded by
 *    the `updated_at` they were planned with, the root delete, and finally one "no reference remains"
 *    `assertCount` per referring field — all in one batch, so a late failure or a reference created
 *    concurrently leaves every row unchanged.
 * 4. **Finalize** (after commit): storage cleanup for deleted upload documents, then after-hooks —
 *    dependents first, root last.
 *
 * Before-hooks are not transactional: a side effect they performed outside the database survives a
 * rollback of the batch (roadmap D01).
 */
export async function deleteDocument(
  ctx: OperationContext,
  args: DeleteArgs
): Promise<DatabaseRecord> {
  const collection = getCollectionOrThrow(ctx, args.collection);
  assertNotAuthManaged(ctx, args.collection);
  const user = args.user ?? null;
  const overrideAccess = args.overrideAccess !== false;

  await runBeforeOperationHooks(collection, { operation: 'delete', user, overrideAccess });

  const existing = await ctx.adapters.database.findById(args.collection, args.id);
  if (!existing) throw notFound(args.collection, args.id);

  const decision = await checkAccess(collection, 'delete', {
    ...args,
    id: args.id,
    doc: existing
  });
  if (decision.where && !documentMatches(existing, decision.where)) {
    throw new AccessDeniedError();
  }

  // 1. Plan — reads only.
  const plan = await planRelationDelete(ctx, { collection, doc: existing });
  const dependents = plan.deletes.slice(1);

  // 2. Prepare — hooks and validation, root first; nothing is written yet.
  await runRejectableStage(
    () => runBeforeDeleteHooks(collection, { user, overrideAccess, id: args.id, doc: existing }),
    'beforeDelete hook'
  );
  for (const dependent of dependents) {
    await prepareDependentDelete(dependent, user);
  }
  const updates: PreparedUpdate[] = [];
  // A set-null dependent's hooks may write other relation values; those are checked like any update's.
  const targetGuards: AtomicWriteOperation[] = [];
  for (const planned of plan.setNulls) {
    const prepared = await prepareSetNull(ctx, planned, user);
    if (!prepared) continue;
    updates.push(prepared);
    targetGuards.push(
      ...(await relationTargetGuards(ctx, prepared.collection, prepared.data, prepared.existing))
    );
  }

  // Each deleted upload document's object gets a durable deletion intent in the same batch (spec 067).
  const storageCleanups = plan.deletes.flatMap(({ collection: target, doc }) => {
    const key = target.upload === true ? ownedStorageKey(doc) : null;
    if (target.upload === true && key === null) warnNoStorageKey(target, doc);
    return key === null ? [] : [{ key, operation: deletionIntent(target.slug, key) }];
  });

  // 3. Commit — one batch, or the plain single delete when nothing else is involved.
  let updatedRecords: DatabaseRecord[] = [];
  let intentIds: string[] = [];
  if (
    dependents.length === 0 &&
    updates.length === 0 &&
    plan.assertions.length === 0 &&
    targetGuards.length === 0 &&
    storageCleanups.length === 0
  ) {
    await deleteRoot(ctx, collection, args.id, decision.where);
  } else {
    ({ updatedRecords, intentIds } = await commitRelationDelete(
      ctx,
      { collection, id: args.id },
      dependents,
      updates,
      [...targetGuards, ...plan.assertions],
      storageCleanups.map((cleanup) => cleanup.operation),
      decision.where
    ));
  }

  // 4. Finalize — storage first (so a slow or failing hook cannot skip it), then after-hooks,
  // dependents first and the root last, as before spec 064. A failed object delete keeps its intent.
  for (const [index, { key }] of storageCleanups.entries()) {
    const intentId = intentIds[index];
    if (intentId !== undefined) await finishDeletion(ctx, intentId, key);
  }
  for (const { collection: target, doc } of [...dependents].reverse()) {
    const hookArgs = { user, overrideAccess: true, id: doc.id as string, doc };
    await runAfterDeleteHooks(target, hookArgs);
    await runAfterOperationHooks(target, {
      operation: 'delete',
      user,
      overrideAccess: true,
      result: doc
    });
  }
  for (const [index, prepared] of updates.entries()) {
    await finalizeUpdate(ctx, prepared, updatedRecords[index] ?? prepared.existing);
  }

  await runAfterDeleteHooks(collection, { user, overrideAccess, id: args.id, doc: existing });
  // A trusted delete keeps returning the stored row; an access-checked one returns only what the caller
  // may read of it (spec 068) — before, it returned the raw row, read-denied fields included.
  const result =
    args.overrideAccess === false ? await writeResult(ctx, collection, existing, args) : existing;
  await runAfterOperationHooks(collection, {
    operation: 'delete',
    user,
    overrideAccess,
    result
  });
  return result;
}

/**
 * The plain single-document delete. With a query-returning delete rule the row must still match it at
 * the delete (spec 068): a row gone meanwhile is a `404`, one moved out of the caller's scope a `409`.
 */
async function deleteRoot(
  ctx: OperationContext,
  collection: CollectionDefinition,
  id: string,
  accessWhere: DatabaseWhere | undefined
): Promise<void> {
  if (accessWhere === undefined) {
    await ctx.adapters.database.delete(collection.slug, id);
    return;
  }
  const result = await ctx.adapters.database.deleteIf(collection.slug, id, {
    targetMatches: accessWhere
  });
  if (result.applied) return;
  if (!(await ctx.adapters.database.findById(collection.slug, id)))
    throw notFound(collection.slug, id);
  throw new ConcurrentModificationError(
    collection.slug,
    id,
    `Document '${id}' in '${collection.slug}' was changed by another request so that it no longer ` +
      `matches the caller's delete access; nothing was deleted. Reload it and try again.`
  );
}

/** A cascaded document's before-phase: the same hooks its own delete runs (trusted, spec 058 §5). */
async function prepareDependentDelete(planned: PlannedDelete, user: CmsUser | null): Promise<void> {
  const { collection, doc } = planned;
  await runBeforeOperationHooks(collection, { operation: 'delete', user, overrideAccess: true });
  await runRejectableStage(
    () =>
      runBeforeDeleteHooks(collection, {
        user,
        overrideAccess: true,
        id: doc.id as string,
        doc
      }),
    'beforeDelete hook'
  );
}

/**
 * A set-null dependent through the normal update preparation, with the patch computed from the document
 * as read there (spec 062's read order for a versioned dependent). `null` when there is nothing left to
 * clear — the document no longer references the deleted ids, or no longer exists; the batch's final
 * assertions still prove no reference survives.
 */
async function prepareSetNull(
  ctx: OperationContext,
  planned: PlannedSetNull,
  user: CmsUser | null
): Promise<PreparedUpdate | null> {
  try {
    return await prepareUpdate(
      ctx,
      {
        collection: planned.collection.slug,
        id: planned.id,
        data: {},
        overrideAccess: true,
        ...(user !== null && { user })
      },
      { patch: (doc) => setNullPatch(planned, doc) }
    );
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

/**
 * The single batch of a relation delete. Order: set-null patches, cascaded deletes, the root delete,
 * then the reference assertions — which therefore see the final state, including this batch's own
 * writes. Any failed condition (a dependent changed since it was planned, a reference created
 * concurrently, a dependent's snapshot losing its version race) rolls the whole batch back and is a
 * `409` about the root; nothing was written. Returns the committed row of each set-null update, in order.
 */
async function commitRelationDelete(
  ctx: OperationContext,
  root: { collection: CollectionDefinition; id: string },
  dependents: PlannedDelete[],
  updates: PreparedUpdate[],
  assertions: AtomicWriteOperation[],
  intents: AtomicWriteOperation[] = [],
  rootWhere?: DatabaseWhere
): Promise<{ updatedRecords: DatabaseRecord[]; intentIds: string[] }> {
  const operations: AtomicWriteOperation[] = [];
  const updateAt: number[] = [];
  for (const prepared of updates) {
    updateAt.push(operations.length);
    if (prepared.versioned) {
      atomicDatabase(ctx, prepared.collection);
      operations.push(...versionedUpdateOperations(prepared));
    } else {
      operations.push({
        type: 'updateIf',
        collection: prepared.collection.slug,
        id: prepared.id,
        data: prepared.data,
        condition: unchangedSince(prepared.existing),
        requireApplied: true
      });
    }
  }
  for (const { collection, doc } of dependents) {
    operations.push({
      type: 'deleteIf',
      collection: collection.slug,
      id: doc.id as string,
      condition: unchangedSince(doc),
      requireApplied: true
    });
  }
  // The caller's delete-access query must still hold when the batch commits (spec 068).
  operations.push(
    rootWhere === undefined
      ? { type: 'delete', collection: root.collection.slug, id: root.id }
      : {
          type: 'deleteIf',
          collection: root.collection.slug,
          id: root.id,
          condition: { targetMatches: rootWhere },
          requireApplied: true
        }
  );
  const intentsAt = operations.length;
  operations.push(...intents);
  operations.push(...assertions);
  // Hook-written relation values of set-null dependents can add target checks after planning counted
  // the batch; still refuse rather than chunk (spec 064 §5). Before-hooks have run by now; nothing is written.
  if (operations.length > ATOMIC_WRITE_MAX_OPERATIONS) {
    throw new InvalidInputError(
      `Cannot delete document '${root.id}' from '${root.collection.slug}': its dependents' hooks added ` +
        `relation checks that take it past ${ATOMIC_WRITE_MAX_OPERATIONS} database operations, the most ` +
        `ForgeCMS commits atomically in one operation. Nothing was changed.`
    );
  }

  let results: Awaited<ReturnType<typeof ctx.adapters.database.atomicWrite>>;
  try {
    results = await ctx.adapters.database.atomicWrite(operations);
  } catch (err) {
    const versionRace = updates.some(
      (prepared) => prepared.versioned && isVersionIdentityConflict(err, prepared.collection)
    );
    if (versionRace || isAtomicWriteConditionError(err)) {
      throw new ConcurrentModificationError(
        root.collection.slug,
        root.id,
        `Deleting document '${root.id}' from '${root.collection.slug}' conflicted with a concurrent ` +
          `change to it or to a document that references it; nothing was deleted or changed. Reload and ` +
          `try again.`
      );
    }
    if (isDbUniqueConstraintError(err)) throw new UniqueConstraintError(err.collection, err.fields);
    throw err;
  }

  const updatedRecords = updateAt.map((at) => {
    const result = results[at];
    if (result && (result.type === 'update' || (result.type === 'updateIf' && result.applied))) {
      return result.record;
    }
    throw new Error('atomicWrite returned no record for a set-null update');
  });
  const intentIds = intents.map((_, offset) => {
    const result = results[intentsAt + offset];
    if (result?.type !== 'create') throw new Error('atomicWrite returned no storage intent');
    return result.record.id as string;
  });
  return { updatedRecords, intentIds };
}

export interface PreviewArgs extends BaseOperationArgs {
  data: Record<string, unknown>;
  id?: string;
}

/**
 * A non-persistent simulation of a permitted create/update — spec 058 §3. Before this fix, preview
 * read the raw adapter row and merged caller-supplied `data` with **no** access enforcement at all
 * (no collection/row/field-write check, no draft-visibility check, no field-read projection): any
 * caller who could reach the endpoint could preview (and see every hidden field of) any document,
 * and could smuggle a forbidden field into the merged output because it was never persisted.
 *
 * Existing-document preview now requires the same **update** access an actual `update()` call would
 * (row-level policy included) plus the same draft-visibility a normal single-document read applies —
 * stricter than raw `update()` (which has no draft gate), because preview hands the full merged
 * document back to the caller to render, unlike a blind write. New-document preview requires **create**
 * access. Both require field-write access on every field in `data` when untrusted
 * (`overrideAccess: false`), and project the returned document through the same field-read rules a
 * normal read would (hidden fields never appear in the output). Depth-1 population forwards the
 * caller's `user`/`overrideAccess`, so a populated target obeys the §4 population-visibility fix
 * instead of always resolving as a trusted call.
 *
 * Zero adapter writes, zero version creation, zero committed-mutation hooks — unchanged from before
 * this fix; this function never called `create()`/`update()`/`createVersion()`.  Full
 * `validateCollection()` is deliberately not run: preview must be able to render an intentionally
 * incomplete draft, not just a document that would actually pass validation.
 */
export async function preview(ctx: OperationContext, args: PreviewArgs): Promise<DatabaseRecord> {
  const collection = getCollectionOrThrow(ctx, args.collection);
  const user = args.user ?? null;

  let existing: DatabaseRecord | null = null;
  let previewData: Record<string, unknown>;

  if (args.id) {
    existing = await ctx.adapters.database.findById(args.collection, args.id);
    if (!existing) throw notFound(args.collection, args.id);

    const decision = await checkAccess(collection, 'update', {
      user,
      ...(args.overrideAccess !== undefined && { overrideAccess: args.overrideAccess }),
      id: args.id,
      data: args.data,
      doc: existing
    });
    if (decision.where && !documentMatches(existing, decision.where)) {
      throw notFound(args.collection, args.id);
    }

    // Draft visibility: a normal single-document read hides an inaccessible draft from an anonymous
    // caller behind a 404 (never confirming the document exists) — preview must not be a back door
    // around that, since it returns the full document body for the caller to render.
    const draftStatus = statusConstraint(
      collection,
      undefined,
      user,
      args.overrideAccess !== false,
      'all'
    );
    if (draftStatus && !documentMatches(existing, draftStatus)) {
      throw notFound(args.collection, args.id);
    }

    // Preview returns the stored document merged with the changes, so the caller must also be able to
    // *read* it, exactly as `findByID` would allow (spec 068 review): update access alone is not a read.
    if (args.overrideAccess === false && !(await canRead(collection, existing, user))) {
      throw notFound(args.collection, args.id);
    }

    // Preview models a permitted update, so it takes the same content input (spec 063 §7).
    const input = screenUpdateInput(args.data, existing);

    if (args.overrideAccess === false) {
      try {
        await assertWritableFields(input, collection, user, 'update');
      } catch (err) {
        if (err instanceof FieldAccessError) throw new AccessDeniedError(err.message);
        throw err;
      }
    }

    previewData = { ...existing, ...input };
  } else {
    await checkAccess(collection, 'create', {
      user,
      ...(args.overrideAccess !== undefined && { overrideAccess: args.overrideAccess }),
      data: args.data
    });

    const { content, id } = screenCreateInput(args.data, args.overrideAccess !== false);

    if (args.overrideAccess === false) {
      try {
        await assertWritableFields(content, collection, user, 'create');
      } catch (err) {
        if (err instanceof FieldAccessError) throw new AccessDeniedError(err.message);
        throw err;
      }
    }

    previewData = id !== undefined ? { ...content, id } : content;
  }

  previewData = applyAutoSlugs(
    collection,
    applyFieldDefaults(collection, previewData),
    existing ?? undefined
  );
  // A preview renders like a read, so its dates take the stored representation (spec 076).
  previewData = canonicalizeDates(collection.fields, previewData);

  if (args.depth && args.depth > 0) {
    previewData = await populateRecord(previewData, collection, ctx, {
      user,
      ...(args.overrideAccess !== undefined && { overrideAccess: args.overrideAccess })
    });
  }

  if (args.overrideAccess === false) {
    previewData = await filterReadableFields(previewData, collection, user);
  }

  return previewData;
}

export { populateRecord, populateRecords };
