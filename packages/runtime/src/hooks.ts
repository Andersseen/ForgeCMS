import type { CollectionDefinition, HookContext } from '@forge-cms/core';

export async function runBeforeChangeHooks(
  collection: CollectionDefinition,
  ctx: Omit<HookContext, 'collection'>
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
  ctx: Omit<HookContext, 'collection'> & { result: Record<string, unknown> }
): Promise<void> {
  const hooks = collection.hooks?.afterChange;
  if (!hooks || hooks.length === 0) return;

  for (const hook of hooks) {
    try {
      await hook({ ...ctx, collection });
    } catch (err) {
      console.error(`afterChange hook failed for collection '${collection.slug}':`, err);
    }
  }
}
