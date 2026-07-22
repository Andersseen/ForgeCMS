import type {
  AccessQuery,
  AnyField,
  CmsUser,
  CollectionDefinition,
  FieldHook,
  HookContext,
  HookOperation
} from '@forge-cms/core';

type ChangeCtx = Omit<HookContext, 'collection'>;

/**
 * Runs side-effect hooks without letting a failure roll back work that already happened. These run
 * after the write is committed, so throwing would report failure for an operation that succeeded.
 */
async function runSideEffects<TCtx>(
  hooks: ((ctx: TCtx) => unknown | Promise<unknown>)[] | undefined,
  ctx: TCtx,
  label: string,
  collection: CollectionDefinition
): Promise<void> {
  if (!hooks || hooks.length === 0) return;
  for (const hook of hooks) {
    try {
      await hook(ctx);
    } catch (err) {
      console.error(`${label} hook failed for collection '${collection.slug}':`, err);
    }
  }
}

/** Runs first on every operation, before access control resolves. */
export async function runBeforeOperationHooks(
  collection: CollectionDefinition,
  ctx: { operation: HookOperation; user?: CmsUser | null }
): Promise<void> {
  await runSideEffects(
    collection.hooks?.beforeOperation,
    { ...ctx, collection },
    'beforeOperation',
    collection
  );
}

/** Runs last on every operation, with whatever is about to be returned. */
export async function runAfterOperationHooks(
  collection: CollectionDefinition,
  ctx: { operation: HookOperation; user?: CmsUser | null; result: unknown }
): Promise<void> {
  await runSideEffects(
    collection.hooks?.afterOperation,
    { ...ctx, collection },
    'afterOperation',
    collection
  );
}

/**
 * Runs before validation, so a hook can normalise or derive a value that then has to pass the
 * schema. Throwing rejects the write, same as `beforeChange`.
 */
export async function runBeforeValidateHooks(
  collection: CollectionDefinition,
  ctx: ChangeCtx
): Promise<Record<string, unknown>> {
  const hooks = collection.hooks?.beforeValidate;
  if (!hooks || hooks.length === 0) return ctx.data;

  let data = ctx.data;
  for (const hook of hooks) {
    data = await hook({ ...ctx, collection, data });
  }
  return data;
}

export async function runBeforeChangeHooks(
  collection: CollectionDefinition,
  ctx: ChangeCtx
): Promise<Record<string, unknown>> {
  const hooks = collection.hooks?.beforeChange;
  if (!hooks || hooks.length === 0) return ctx.data;

  let data = ctx.data;
  for (const hook of hooks) {
    data = await hook({ ...ctx, collection, data });
  }
  return data;
}

export async function runAfterChangeHooks(
  collection: CollectionDefinition,
  ctx: ChangeCtx & { result: Record<string, unknown>; doc?: Record<string, unknown> }
): Promise<void> {
  // `doc` is the spec-021 name, `result` the spec-013 one. Both are passed so hooks written against
  // either shape keep working.
  const doc = ctx.doc ?? ctx.result;
  await runSideEffects(
    collection.hooks?.afterChange,
    { ...ctx, collection, doc, result: ctx.result },
    'afterChange',
    collection
  );
}

/** Runs once per read operation and may narrow the query before it is issued. */
export async function runBeforeReadHooks(
  collection: CollectionDefinition,
  ctx: { user?: CmsUser | null; query: AccessQuery }
): Promise<AccessQuery> {
  const hooks = collection.hooks?.beforeRead;
  if (!hooks || hooks.length === 0) return ctx.query;

  let query = ctx.query;
  for (const hook of hooks) {
    query = await hook({ ...ctx, collection, operation: 'read', query });
  }
  return query;
}

/** Runs per document on the way out. Returns the document to hand to the caller. */
export async function runAfterReadHooks(
  collection: CollectionDefinition,
  ctx: { user?: CmsUser | null; doc: Record<string, unknown> }
): Promise<Record<string, unknown>> {
  const hooks = collection.hooks?.afterRead;
  if (!hooks || hooks.length === 0) return ctx.doc;

  let doc = ctx.doc;
  for (const hook of hooks) {
    doc = await hook({ ...ctx, collection, operation: 'read', doc });
  }
  return doc;
}

export async function runBeforeDeleteHooks(
  collection: CollectionDefinition,
  ctx: { user?: CmsUser | null; id: string; doc: Record<string, unknown> }
): Promise<void> {
  const hooks = collection.hooks?.beforeDelete;
  if (!hooks || hooks.length === 0) return;
  // Unlike the after* hooks, a throwing beforeDelete aborts the delete — that is the point of having
  // one (referential-integrity guards, "this document is still in use" checks).
  for (const hook of hooks) {
    await hook({ ...ctx, collection, operation: 'delete' });
  }
}

export async function runAfterDeleteHooks(
  collection: CollectionDefinition,
  ctx: { user?: CmsUser | null; id: string; doc: Record<string, unknown> }
): Promise<void> {
  await runSideEffects(
    collection.hooks?.afterDelete,
    { ...ctx, collection, operation: 'delete' as const },
    'afterDelete',
    collection
  );
}

type FieldHookName = 'beforeValidate' | 'beforeChange' | 'afterRead';

function hooksFor(field: AnyField, name: FieldHookName): FieldHook[] | undefined {
  return field.options.hooks?.[name];
}

/**
 * Threads each field's value through its own hook chain. Only top-level fields are covered: nested
 * fields inside `group`/`array`/`blocks` are validated recursively but do not run field hooks yet.
 */
export async function runFieldHooks(
  collection: CollectionDefinition,
  name: FieldHookName,
  ctx: {
    data: Record<string, unknown>;
    previousData?: Record<string, unknown>;
    operation: HookOperation;
    user?: CmsUser | null;
  }
): Promise<Record<string, unknown>> {
  const entries = Object.entries(collection.fields).filter(
    ([, field]) => (hooksFor(field, name)?.length ?? 0) > 0
  );
  if (entries.length === 0) return ctx.data;

  const data = { ...ctx.data };
  for (const [fieldName, field] of entries) {
    let value = data[fieldName];
    for (const hook of hooksFor(field, name) ?? []) {
      value = await hook({
        value,
        data,
        ...(ctx.previousData !== undefined && { previousValue: ctx.previousData[fieldName] }),
        fieldName,
        collection,
        operation: ctx.operation,
        user: ctx.user ?? null
      });
    }
    data[fieldName] = value;
  }
  return data;
}
