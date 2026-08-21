import { validateCollection } from '@forge-cms/core';
import type { CmsUser, GlobalDefinition } from '@forge-cms/core';
import type { DatabaseRecord } from '@forge-cms/db';
import type { OperationContext } from './context.js';
import {
  AccessDeniedError,
  ForgeError,
  InvalidInputError,
  NotFoundError,
  ValidationFailedError
} from './errors.js';
import { resolveAccess } from './access.js';
import { applyFieldDefaults } from './defaults.js';
import type { AccessDecision } from './access.js';
import {
  runAfterChangeHooks,
  runAfterOperationHooks,
  runAfterReadHooks,
  runBeforeChangeHooks,
  runBeforeOperationHooks,
  runBeforeValidateHooks,
  runFieldHooks
} from './hooks.js';
import { assertWritableFields, filterReadableFields, FieldAccessError } from './field-access.js';

const GLOBAL_ID = 'global';

export interface GlobalBaseArgs {
  global: string;
  user?: CmsUser | null;
  overrideAccess?: boolean;
}

export interface GetGlobalArgs extends GlobalBaseArgs {
  depth?: 0 | 1;
}

export interface UpdateGlobalArgs extends GlobalBaseArgs {
  data: Record<string, unknown>;
}

function getGlobalOrThrow(ctx: OperationContext, slug: string): GlobalDefinition {
  const global = ctx.getGlobal(slug);
  if (!global) throw new NotFoundError(`Global '${slug}' not found`);
  return global;
}

async function checkGlobalAccess(
  global: GlobalDefinition,
  operation: 'read' | 'update',
  args: {
    user?: CmsUser | null;
    overrideAccess?: boolean;
    data?: Record<string, unknown>;
    doc?: Record<string, unknown>;
  }
): Promise<AccessDecision> {
  if (args.overrideAccess !== false) return { allowed: true };

  const decision = await resolveAccess(global.access?.[operation], {
    user: args.user ?? null,
    operation,
    collection: { ...global, upload: false },
    ...(args.data !== undefined && { data: args.data }),
    ...(args.doc !== undefined && { doc: args.doc })
  });

  if (decision === undefined) return { allowed: true };
  if (!decision.allowed) throw new AccessDeniedError();
  return decision;
}

async function runRejectableStage<T>(stage: () => Promise<T>, label: string): Promise<T> {
  try {
    return await stage();
  } catch (err) {
    if (err instanceof ForgeError) throw err;
    throw new InvalidInputError(err instanceof Error ? err.message : `${label} failed`);
  }
}

async function prepareGlobalForRead(
  ctx: OperationContext,
  global: GlobalDefinition,
  record: DatabaseRecord | null,
  args: { user?: CmsUser | null; overrideAccess?: boolean }
): Promise<DatabaseRecord | null> {
  if (!record) return null;

  const user = args.user ?? null;
  const overrideAccess = args.overrideAccess !== false;

  let doc = record;

  if (args.overrideAccess === false) {
    doc = await filterReadableFields(doc, { ...global, upload: false }, user);
  }

  const withFieldHooks = await runFieldHooks({ ...global, upload: false }, 'afterRead', {
    data: doc,
    operation: 'read',
    user,
    overrideAccess
  });

  return runAfterReadHooks(
    { ...global, upload: false },
    { user, overrideAccess, doc: withFieldHooks }
  );
}

/**
 * Reads the singleton global document. Returns `null` if the global has never been written.
 */
export async function getGlobal(
  ctx: OperationContext,
  args: GetGlobalArgs
): Promise<DatabaseRecord | null> {
  const global = getGlobalOrThrow(ctx, args.global);
  const user = args.user ?? null;
  const overrideAccess = args.overrideAccess !== false;

  await runBeforeOperationHooks(
    { ...global, upload: false },
    { operation: 'read', user, overrideAccess }
  );

  await checkGlobalAccess(global, 'read', args);

  const record = await ctx.adapters.database.findById(`_global_${global.slug}`, GLOBAL_ID);

  if (!record) {
    await runAfterOperationHooks(
      { ...global, upload: false },
      { operation: 'read', user, overrideAccess, result: null }
    );
    return null;
  }

  const doc = await prepareGlobalForRead(ctx, global, record, args);

  await runAfterOperationHooks(
    { ...global, upload: false },
    { operation: 'read', user, overrideAccess, result: doc }
  );
  return doc;
}

/**
 * Creates or updates the singleton global document. Unlike collections, globals always have
 * exactly one document — the first write creates it, subsequent writes update it.
 */
export async function updateGlobal(
  ctx: OperationContext,
  args: UpdateGlobalArgs
): Promise<DatabaseRecord> {
  const global = getGlobalOrThrow(ctx, args.global);
  const user = args.user ?? null;
  const overrideAccess = args.overrideAccess !== false;
  const collectionProxy = { ...global, upload: false };

  await runBeforeOperationHooks(collectionProxy, { operation: 'update', user, overrideAccess });

  const existing = await ctx.adapters.database.findById(`_global_${global.slug}`, GLOBAL_ID);

  await checkGlobalAccess(global, 'update', {
    ...args,
    ...(existing !== null && { doc: existing })
  });

  if (args.overrideAccess === false) {
    try {
      await assertWritableFields(args.data, collectionProxy, user, existing ? 'update' : 'create');
    } catch (err) {
      if (err instanceof FieldAccessError) throw new AccessDeniedError(err.message);
      throw err;
    }
  }

  const seeded = applyFieldDefaults(collectionProxy, args.data);

  let data = await runRejectableStage(
    async () =>
      runBeforeValidateHooks(collectionProxy, {
        operation: existing ? 'update' : 'create',
        data: await runFieldHooks(collectionProxy, 'beforeValidate', {
          data: seeded,
          operation: existing ? 'update' : 'create',
          user,
          overrideAccess
        }),
        user,
        overrideAccess
      }),
    'beforeValidate hook'
  );

  if (global.drafts === true && data._status === undefined) {
    data = { ...data, _status: 'draft' };
  }

  if (data._status !== undefined && data._status !== 'draft' && data._status !== 'published') {
    throw new InvalidInputError(
      `Invalid status '${String(data._status)}', expected 'draft' or 'published'`
    );
  }

  const validation = validateCollection(collectionProxy, data);
  if (!validation.valid) throw new ValidationFailedError(validation.errors);

  data = await runRejectableStage(
    async () =>
      runBeforeChangeHooks(collectionProxy, {
        operation: existing ? 'update' : 'create',
        data: await runFieldHooks(collectionProxy, 'beforeChange', {
          data,
          ...(existing !== null && { previousData: existing }),
          operation: existing ? 'update' : 'create',
          user,
          overrideAccess
        }),
        ...(existing !== null && { previousData: existing }),
        user,
        overrideAccess
      }),
    'beforeChange hook'
  );

  const globalCollection = `_global_${global.slug}`;
  let record: DatabaseRecord;

  if (existing) {
    record = await ctx.adapters.database.update(globalCollection, GLOBAL_ID, data);
  } else {
    record = await ctx.adapters.database.create(globalCollection, { ...data, id: GLOBAL_ID });
  }

  await runAfterChangeHooks(collectionProxy, {
    operation: existing ? 'update' : 'create',
    data,
    ...(existing !== null && { previousData: existing }),
    result: record,
    doc: record,
    user,
    overrideAccess
  });

  const doc = await prepareGlobalForRead(ctx, global, record, args);
  const result = doc ?? record;

  await runAfterOperationHooks(collectionProxy, {
    operation: 'update',
    user,
    overrideAccess,
    result
  });
  return result;
}
