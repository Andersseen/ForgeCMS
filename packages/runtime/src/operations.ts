import { validateCollection } from '@forge-cms/core';
import type { CmsUser, CollectionDefinition, DraftStatus } from '@forge-cms/core';
import type { DatabaseRecord, DatabaseWhere } from '@forge-cms/db';
import type { OperationContext } from './context.js';
import {
  AccessDeniedError,
  ForgeError,
  InvalidInputError,
  NotFoundError,
  ValidationFailedError
} from './errors.js';
import { documentMatches, mergeWhere, resolveAccess } from './access.js';
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
}

export interface FindArgs extends BaseOperationArgs {
  where?: DatabaseWhere;
  limit?: number;
  offset?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  /** Only meaningful on a `drafts: true` collection. Defaults to `published`. */
  status?: DraftStatus | 'all';
}

export interface FindByIDArgs extends BaseOperationArgs {
  id: string;
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
  args: { user?: CmsUser | null; overrideAccess?: boolean; depth?: 0 | 1 }
): Promise<DatabaseRecord[]> {
  const user = args.user ?? null;
  let docs = records;

  if (args.depth === 1) {
    docs = await populateRecords(docs, collection, ctx);
  }

  if (args.overrideAccess === false) {
    docs = await Promise.all(docs.map((doc) => filterReadableFields(doc, collection, user)));
  }

  docs = await Promise.all(
    docs.map(async (doc) => {
      const withFieldHooks = await runFieldHooks(collection, 'afterRead', {
        data: doc,
        operation: 'read',
        user
      });
      return runAfterReadHooks(collection, { user, doc: withFieldHooks });
    })
  );

  return docs;
}

export async function find(ctx: OperationContext, args: FindArgs): Promise<PaginatedDocs> {
  const collection = getCollectionOrThrow(ctx, args.collection);
  const user = args.user ?? null;

  await runBeforeOperationHooks(collection, { operation: 'read', user });

  const decision = await checkAccess(collection, 'read', args);

  let where = mergeWhere(args.where, decision.where);
  where = mergeWhere(
    where,
    statusConstraint(collection, args.status, user, args.overrideAccess !== false, 'published')
  );
  where = (await runBeforeReadHooks(collection, { user, query: where ?? {} })) as DatabaseWhere;

  const hasWhere = where !== undefined && Object.keys(where).length > 0;
  const findOptions = {
    collection: args.collection,
    ...(args.limit !== undefined && { limit: args.limit }),
    ...(args.offset !== undefined && { offset: args.offset }),
    ...(hasWhere && { where }),
    ...(args.sort !== undefined && { sort: args.sort }),
    ...(args.order !== undefined && { order: args.order })
  };

  const [records, totalDocs] = await Promise.all([
    ctx.adapters.database.findMany(findOptions),
    ctx.adapters.database.count(args.collection, hasWhere ? where : undefined)
  ]);

  const docs = await prepareForRead(ctx, collection, records, args);
  const result = paginate(docs, totalDocs, args.limit, args.offset ?? 0);

  await runAfterOperationHooks(collection, { operation: 'read', user, result });
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

  await runBeforeOperationHooks(collection, { operation: 'read', user });

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

  await runAfterOperationHooks(collection, { operation: 'read', user, result });
  return result;
}

export async function count(ctx: OperationContext, args: CountArgs): Promise<number> {
  const collection = getCollectionOrThrow(ctx, args.collection);
  const user = args.user ?? null;

  const decision = await checkAccess(collection, 'read', args);

  let where = mergeWhere(args.where, decision.where);
  where = mergeWhere(
    where,
    statusConstraint(collection, args.status, user, args.overrideAccess !== false, 'published')
  );

  return ctx.adapters.database.count(
    args.collection,
    where && Object.keys(where).length > 0 ? where : undefined
  );
}

export async function create(ctx: OperationContext, args: CreateArgs): Promise<DatabaseRecord> {
  const collection = getCollectionOrThrow(ctx, args.collection);
  const user = args.user ?? null;

  await runBeforeOperationHooks(collection, { operation: 'create', user });
  await checkAccess(collection, 'create', { ...args, data: args.data });

  if (args.overrideAccess === false) {
    try {
      await assertWritableFields(args.data, collection, user, 'create');
    } catch (err) {
      if (err instanceof FieldAccessError) throw new AccessDeniedError(err.message);
      throw err;
    }
  }

  let data = await runRejectableStage(
    async () =>
      runBeforeValidateHooks(collection, {
        operation: 'create',
        data: await runFieldHooks(collection, 'beforeValidate', {
          data: args.data,
          operation: 'create',
          user
        }),
        user
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
        data: await runFieldHooks(collection, 'beforeChange', { data, operation: 'create', user }),
        user
      }),
    'beforeChange hook'
  );

  const record = await ctx.adapters.database.create(args.collection, data);

  await runAfterChangeHooks(collection, {
    operation: 'create',
    data,
    result: record,
    doc: record,
    user
  });

  const [doc] = await prepareForRead(ctx, collection, [record], args);
  const result = doc ?? record;

  await runAfterOperationHooks(collection, { operation: 'create', user, result });
  return result;
}

export async function update(ctx: OperationContext, args: UpdateArgs): Promise<DatabaseRecord> {
  const collection = getCollectionOrThrow(ctx, args.collection);
  const user = args.user ?? null;

  await runBeforeOperationHooks(collection, { operation: 'update', user });

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

  let data = await runRejectableStage(
    async () =>
      runBeforeValidateHooks(collection, {
        operation: 'update',
        data: await runFieldHooks(collection, 'beforeValidate', {
          data: args.data,
          previousData: existing,
          operation: 'update',
          user
        }),
        previousData: existing,
        user
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
          user
        }),
        previousData: existing,
        user
      }),
    'beforeChange hook'
  );

  const record = await ctx.adapters.database.update(args.collection, args.id, data);

  await runAfterChangeHooks(collection, {
    operation: 'update',
    data,
    previousData: existing,
    result: record,
    doc: record,
    user
  });

  const [doc] = await prepareForRead(ctx, collection, [record], args);
  const result = doc ?? record;

  await runAfterOperationHooks(collection, { operation: 'update', user, result });
  return result;
}

export async function deleteDocument(
  ctx: OperationContext,
  args: DeleteArgs
): Promise<DatabaseRecord> {
  const collection = getCollectionOrThrow(ctx, args.collection);
  const user = args.user ?? null;

  await runBeforeOperationHooks(collection, { operation: 'delete', user });

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
    () => runBeforeDeleteHooks(collection, { user, id: args.id, doc: existing }),
    'beforeDelete hook'
  );
  await ctx.adapters.database.delete(args.collection, args.id);
  await runAfterDeleteHooks(collection, { user, id: args.id, doc: existing });

  await runAfterOperationHooks(collection, { operation: 'delete', user, result: existing });
  return existing;
}

export { populateRecord, populateRecords };
