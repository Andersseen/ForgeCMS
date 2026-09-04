import { getLogger, validateCollection } from '@forge-cms/core';
import type { AccessQuery, CmsUser, CollectionDefinition, DraftStatus } from '@forge-cms/core';
import type { DatabaseRecord, DatabaseWhere, SortInput } from '@forge-cms/db';
import { isUniqueConstraintError as isDbUniqueConstraintError } from '@forge-cms/db';
import type { OperationContext } from './context.js';
import {
  AccessDeniedError,
  ForgeError,
  InvalidInputError,
  NotFoundError,
  UniqueConstraintError,
  ValidationFailedError
} from './errors.js';
import { documentMatches, mergeWhere, resolveAccess } from './access.js';
import { validateSort, validateWhere } from './query-validation.js';
import { applyAutoSlugs, applyFieldDefaults } from './defaults.js';
import type { AccessDecision } from './access.js';
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
import { createVersion, versionsEnabled } from './versions.js';
import {
  isLocalizedCollection,
  storeLocalizedDocument,
  resolveLocalizedDocument
} from './localization.js';
import {
  checkDeleteRestrictions,
  handleCascadeDelete,
  handleSetNullOnDelete
} from './relation-integrity.js';

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
 * Resolves the collection's access rule for an operation.
 *
 * A rule that is not configured yields `undefined`, which every caller treats as "allowed" — the
 * Local API has no route-level fallback to defer to, and the HTTP layer applies its own
 * `allowedRoles` gate *before* calling in.
 */
async function checkAccess(
  collection: CollectionDefinition,
  operation: 'read' | 'create' | 'update' | 'delete',
  args: {
    user?: CmsUser | null;
    overrideAccess?: boolean;
    id?: string;
    data?: Record<string, unknown>;
    doc?: Record<string, unknown>;
  }
): Promise<AccessDecision> {
  if (args.overrideAccess !== false) return { allowed: true };

  const decision = await resolveAccess(collection.access?.[operation], {
    user: args.user ?? null,
    operation,
    collection,
    ...(args.id !== undefined && { id: args.id }),
    ...(args.data !== undefined && { data: args.data }),
    ...(args.doc !== undefined && { doc: args.doc })
  });

  if (decision === undefined) return { allowed: true };
  if (!decision.allowed) throw new AccessDeniedError();
  return decision;
}

/**
 * The `_status` constraint for a read. Anonymous callers only ever see published documents,
 * whatever they ask for.
 *
 * `defaultStatus` differs by operation, preserving spec 017's behaviour: a **list** stays
 * published-only unless the caller opts in (`?status=draft|all`), because a listing is the surface
 * that leaks unfinished content; a **single read by id** shows drafts to any authenticated caller,
 * since they had to know the id already.
 */
function statusConstraint(
  collection: CollectionDefinition,
  status: DraftStatus | 'all' | undefined,
  user: CmsUser | null,
  overrideAccess: boolean,
  defaultStatus: DraftStatus | 'all'
): DatabaseWhere | undefined {
  if (collection.drafts !== true) return undefined;

  // Trusted server-side calls see everything unless they ask for a specific status.
  if (overrideAccess) {
    if (status === undefined || status === 'all') return undefined;
    return { _status: status };
  }

  if (!user) return { _status: 'published' };

  const effective = status ?? defaultStatus;
  if (effective === 'all') return undefined;
  return { _status: effective };
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
  const collection = getCollectionOrThrow(ctx, args.collection);
  const user = args.user ?? null;
  const overrideAccess = args.overrideAccess !== false;

  await runBeforeOperationHooks(collection, { operation: 'create', user, overrideAccess });
  await checkAccess(collection, 'create', { ...args, data: args.data });

  if (args.overrideAccess === false) {
    try {
      await assertWritableFields(args.data, collection, user, 'create');
    } catch (err) {
      if (err instanceof FieldAccessError) throw new AccessDeniedError(err.message);
      throw err;
    }
  }

  // Defaults and auto-slugs are resolved before any hook runs, so a hook still gets the last word
  // and validation only ever sees the final value.
  const seeded = applyAutoSlugs(collection, applyFieldDefaults(collection, args.data));

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

  const record = await runWrite(args.collection, () =>
    ctx.adapters.database.create(args.collection, data)
  );

  // Create initial version if versions are enabled
  if (versionsEnabled(collection)) {
    await createVersion(ctx, {
      collection: args.collection,
      documentId: record.id as string,
      data,
      user
    });
  }

  await runAfterChangeHooks(collection, {
    operation: 'create',
    data,
    result: record,
    doc: record,
    user,
    overrideAccess
  });

  const [doc] = await prepareForRead(ctx, collection, [record], args);
  const result = doc ?? record;

  await runAfterOperationHooks(collection, { operation: 'create', user, overrideAccess, result });
  return result;
}

export async function update(ctx: OperationContext, args: UpdateArgs): Promise<DatabaseRecord> {
  const collection = getCollectionOrThrow(ctx, args.collection);
  const user = args.user ?? null;
  const overrideAccess = args.overrideAccess !== false;

  await runBeforeOperationHooks(collection, { operation: 'update', user, overrideAccess });

  const existing = await ctx.adapters.database.findById(args.collection, args.id);
  if (!existing) throw notFound(args.collection, args.id);

  const decision = await checkAccess(collection, 'update', {
    ...args,
    id: args.id,
    data: args.data,
    doc: existing
  });
  if (decision.where && !documentMatches(existing, decision.where)) {
    throw new AccessDeniedError();
  }

  if (args.overrideAccess === false) {
    try {
      await assertWritableFields(args.data, collection, user, 'update');
    } catch (err) {
      if (err instanceof FieldAccessError) throw new AccessDeniedError(err.message);
      throw err;
    }
  }

  // Process localized fields if the collection has locales configured
  const processedData =
    isLocalizedCollection(collection) && args.locale
      ? storeLocalizedDocument(args.data, collection, args.locale, existing)
      : args.data;

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

  const record = await runWrite(args.collection, () =>
    ctx.adapters.database.update(args.collection, args.id, data)
  );

  // Create a version snapshot if versions are enabled
  if (versionsEnabled(collection)) {
    await createVersion(ctx, {
      collection: args.collection,
      documentId: args.id,
      data,
      user
    });
  }

  await runAfterChangeHooks(collection, {
    operation: 'update',
    data,
    previousData: existing,
    result: record,
    doc: record,
    user,
    overrideAccess
  });

  const [doc] = await prepareForRead(ctx, collection, [record], args);
  const result = doc ?? record;

  await runAfterOperationHooks(collection, { operation: 'update', user, overrideAccess, result });
  return result;
}

const MEDIA_URL_PREFIX = '/api/media/';

/**
 * Resolves the storage key a stored upload's underlying object lives under: the `_storageKey` every
 * upload-created document carries, or (for an older/manually-created record without one) a fallback
 * parsed from its `url`, matching the default `/api/media/<collection>/<key>` shape `handleFile` and
 * every `StorageAdapter`'s default `getPublicUrl` use.
 */
function resolveStorageKey(collectionSlug: string, doc: DatabaseRecord): string | null {
  const storageKey = doc._storageKey;
  if (typeof storageKey === 'string' && storageKey.length > 0) return storageKey;

  const url = doc.url;
  if (typeof url !== 'string') return null;
  const prefix = `${MEDIA_URL_PREFIX}${collectionSlug}/`;
  const idx = url.indexOf(prefix);
  return idx === -1 ? null : url.slice(idx + MEDIA_URL_PREFIX.length);
}

export async function deleteDocument(
  ctx: OperationContext,
  args: DeleteArgs
): Promise<DatabaseRecord> {
  const collection = getCollectionOrThrow(ctx, args.collection);
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

  await runRejectableStage(
    () => runBeforeDeleteHooks(collection, { user, overrideAccess, id: args.id, doc: existing }),
    'beforeDelete hook'
  );

  // Check relation integrity constraints
  await checkDeleteRestrictions(ctx, collection, args.id);

  // Handle cascade and set-null before deleting
  await handleCascadeDelete(ctx, collection, args.id);
  await handleSetNullOnDelete(ctx, collection, args.id);

  // The database delete must succeed — and only then does the underlying storage object get
  // removed. Deleting the object first (or on a rejected/failed database delete) would orphan the
  // document from its file; deleting it only after confirms the document is really gone.
  await ctx.adapters.database.delete(args.collection, args.id);

  if (collection.upload === true) {
    const storageKey = resolveStorageKey(args.collection, existing);
    if (storageKey) {
      try {
        await ctx.adapters.storage.delete(storageKey);
      } catch (cleanupErr) {
        // The document is already gone; failing the whole operation over cleanup would be worse
        // than a best-effort delete that gets logged and left for manual follow-up.
        getLogger().error(
          `Failed to clean up storage object '${storageKey}' after document deletion`,
          cleanupErr
        );
      }
    }
  }

  await runAfterDeleteHooks(collection, { user, overrideAccess, id: args.id, doc: existing });

  await runAfterOperationHooks(collection, {
    operation: 'delete',
    user,
    overrideAccess,
    result: existing
  });
  return existing;
}

export { populateRecord, populateRecords };
