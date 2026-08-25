import type {
  AccessQuery,
  AnyField,
  ArrayFieldOptions,
  BlocksFieldOptions,
  CmsUser,
  CollectionDefinition,
  FieldHook,
  FieldMap,
  GroupFieldOptions,
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
  ctx: { operation: HookOperation; user?: CmsUser | null; overrideAccess?: boolean }
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
  ctx: {
    operation: HookOperation;
    user?: CmsUser | null;
    overrideAccess?: boolean;
    result: unknown;
  }
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
  ctx: { user?: CmsUser | null; overrideAccess?: boolean; query: AccessQuery }
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
  ctx: { user?: CmsUser | null; overrideAccess?: boolean; doc: Record<string, unknown> }
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
  ctx: {
    user?: CmsUser | null;
    overrideAccess?: boolean;
    id: string;
    doc: Record<string, unknown>;
  }
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
  ctx: {
    user?: CmsUser | null;
    overrideAccess?: boolean;
    id: string;
    doc: Record<string, unknown>;
  }
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function runFieldHookChain(
  field: AnyField,
  name: FieldHookName,
  ctx: {
    value: unknown;
    data: Record<string, unknown>;
    previousValue?: unknown;
    fieldName: string;
    collection: CollectionDefinition;
    operation: HookOperation;
    user?: CmsUser | null;
    overrideAccess?: boolean;
  }
): Promise<unknown> {
  let value = ctx.value;
  for (const hook of hooksFor(field, name) ?? []) {
    value = await hook({
      value,
      data: ctx.data,
      ...(ctx.previousValue !== undefined && { previousValue: ctx.previousValue }),
      fieldName: ctx.fieldName,
      collection: ctx.collection,
      operation: ctx.operation,
      user: ctx.user ?? null,
      ...(ctx.overrideAccess !== undefined && { overrideAccess: ctx.overrideAccess })
    });
  }
  return value;
}

async function runFieldMapHooks(
  fields: FieldMap,
  name: FieldHookName,
  ctx: {
    data: Record<string, unknown>;
    previousData?: Record<string, unknown>;
    pathPrefix?: string;
    collection: CollectionDefinition;
    operation: HookOperation;
    user?: CmsUser | null;
    overrideAccess?: boolean;
  }
): Promise<Record<string, unknown>> {
  let data = { ...ctx.data };

  for (const [fieldName, field] of Object.entries(fields)) {
    const path = ctx.pathPrefix ? `${ctx.pathPrefix}.${fieldName}` : fieldName;
    const hasOwnValue = Object.prototype.hasOwnProperty.call(data, fieldName);
    const hasHooks = (hooksFor(field, name)?.length ?? 0) > 0;
    let value = data[fieldName];
    value = await runFieldHookChain(field, name, {
      value,
      data,
      ...(ctx.previousData !== undefined && { previousValue: ctx.previousData[fieldName] }),
      fieldName: path,
      collection: ctx.collection,
      operation: ctx.operation,
      ...(ctx.user !== undefined && { user: ctx.user }),
      ...(ctx.overrideAccess !== undefined && { overrideAccess: ctx.overrideAccess })
    });
    let shouldAssign = hasOwnValue || hasHooks;

    if (field.kind === 'group' && isPlainRecord(value)) {
      const previousValue = ctx.previousData?.[fieldName];
      value = await runFieldMapHooks((field.options as GroupFieldOptions).fields, name, {
        data: value,
        ...(isPlainRecord(previousValue) && { previousData: previousValue }),
        pathPrefix: path,
        collection: ctx.collection,
        operation: ctx.operation,
        ...(ctx.user !== undefined && { user: ctx.user }),
        ...(ctx.overrideAccess !== undefined && { overrideAccess: ctx.overrideAccess })
      });
      shouldAssign = true;
    }

    if (field.kind === 'array' && Array.isArray(value)) {
      const previousRows = ctx.previousData?.[fieldName];
      value = await Promise.all(
        value.map(async (row, index) => {
          if (!isPlainRecord(row)) return row;
          const previousRow = Array.isArray(previousRows) ? previousRows[index] : undefined;
          return runFieldMapHooks((field.options as ArrayFieldOptions).fields, name, {
            data: row,
            ...(isPlainRecord(previousRow) && { previousData: previousRow }),
            pathPrefix: `${path}.${index}`,
            collection: ctx.collection,
            operation: ctx.operation,
            ...(ctx.user !== undefined && { user: ctx.user }),
            ...(ctx.overrideAccess !== undefined && { overrideAccess: ctx.overrideAccess })
          });
        })
      );
      shouldAssign = true;
    }

    if (field.kind === 'blocks' && Array.isArray(value)) {
      const previousRows = ctx.previousData?.[fieldName];
      const blocks = new Map(
        (field.options as BlocksFieldOptions).blocks.map((block) => [block.slug, block])
      );
      value = await Promise.all(
        value.map(async (row, index) => {
          if (!isPlainRecord(row) || typeof row.blockType !== 'string') return row;
          const block = blocks.get(row.blockType);
          if (!block) return row;
          const previousRow = Array.isArray(previousRows) ? previousRows[index] : undefined;
          return runFieldMapHooks(block.fields as FieldMap, name, {
            data: row,
            ...(isPlainRecord(previousRow) && { previousData: previousRow }),
            pathPrefix: `${path}.${index}`,
            collection: ctx.collection,
            operation: ctx.operation,
            ...(ctx.user !== undefined && { user: ctx.user }),
            ...(ctx.overrideAccess !== undefined && { overrideAccess: ctx.overrideAccess })
          });
        })
      );
      shouldAssign = true;
    }

    if (shouldAssign) {
      data = { ...data, [fieldName]: value };
    }
  }

  return data;
}

/** Threads every top-level and nested field's value through its hook chain. */
export async function runFieldHooks(
  collection: CollectionDefinition,
  name: FieldHookName,
  ctx: {
    data: Record<string, unknown>;
    previousData?: Record<string, unknown>;
    operation: HookOperation;
    user?: CmsUser | null;
    overrideAccess?: boolean;
  }
): Promise<Record<string, unknown>> {
  return runFieldMapHooks(collection.fields, name, { ...ctx, collection });
}
