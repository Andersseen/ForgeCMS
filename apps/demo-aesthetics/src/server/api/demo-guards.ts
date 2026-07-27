import type { CollectionDefinition, CollectionHooks } from '@forge-cms/core';
import { MAX_DOCUMENTS, MIN_DOCUMENTS, clearReadCache } from './demo-limits';
import { getRuntimeRef } from './runtime-ref';

/**
 * Turns the numbers in `demo-limits.ts` into ordinary collection hooks.
 *
 * Two rules, both about keeping a public demo usable and affordable:
 *
 * - **A ceiling per collection.** After a create, anything past the ceiling is pruned oldest-first,
 *   so the demo never grows without bound but a visitor's write still succeeds. Pruning beats
 *   refusing here: "your booking was rejected because someone else made 200" is a worse demo than
 *   quietly forgetting last week's.
 * - **A floor per collection.** A delete that would take a collection below its floor is refused,
 *   so nobody can empty the treatment menu and leave the public site looking broken.
 *
 * A third rule is about the demo *feeling* right rather than being cheap: any write drops the
 * public read cache, so "publish this and reload the site" is true immediately instead of within a
 * minute. It only clears this isolate's cache — the demo's promise holds for the visitor who made
 * the change, which is the one who is looking.
 *
 * No CMS feature was added for any of this: it is all `beforeDelete` / `afterChange` / `afterDelete`.
 */

async function countDocuments(slug: string): Promise<number> {
  const runtime = getRuntimeRef();
  if (!runtime) return 0;
  return runtime.count({ collection: slug });
}

/**
 * Deletes the oldest rows beyond `ceiling`.
 *
 * Sorting by `created_at` only works because every adapter stamps it (spec 040 — the in-memory one
 * did not, so this would have silently pruned arbitrary rows in local development).
 */
async function pruneOldest(slug: string, ceiling: number): Promise<void> {
  const runtime = getRuntimeRef();
  if (!runtime) return;

  const total = await runtime.count({ collection: slug });
  const excess = total - ceiling;
  if (excess <= 0) return;

  const { docs } = await runtime.find({
    collection: slug,
    sort: 'created_at',
    order: 'asc',
    limit: excess,
    status: 'all'
  });

  for (const doc of docs) {
    await runtime.delete({ collection: slug, id: String(doc.id) });
  }
}

function mergeHooks(
  existing: CollectionHooks | undefined,
  added: CollectionHooks
): CollectionHooks {
  if (!existing) return added;

  const merged: CollectionHooks = { ...existing };
  for (const [stage, hooks] of Object.entries(added) as [keyof CollectionHooks, unknown[]][]) {
    const current = (existing[stage] ?? []) as unknown[];
    // The collection's own hooks run first: the demo's limits are a policy on top of the content
    // model, never a replacement for it.
    (merged as Record<string, unknown>)[stage] = [...current, ...hooks];
  }
  return merged;
}

function guardsFor(slug: string): CollectionHooks {
  const ceiling = MAX_DOCUMENTS[slug];
  const floor = MIN_DOCUMENTS[slug];

  const hooks: CollectionHooks = {
    afterChange: [() => clearReadCache()],
    afterDelete: [() => clearReadCache()]
  };

  if (floor !== undefined) {
    hooks.beforeDelete = [
      async ({ collection }) => {
        if ((await countDocuments(slug)) - 1 < floor) {
          throw new Error(
            `The demo keeps at least ${floor} documents in ${collection.slug} so the public site stays intact.`
          );
        }
      }
    ];
  }

  if (ceiling !== undefined) {
    hooks.afterChange = [
      ...(hooks.afterChange ?? []),
      async ({ operation }) => {
        if (operation !== 'create') return;
        await pruneOldest(slug, ceiling);
      }
    ];
  }

  return hooks;
}

/** Wraps a collection with the demo's limits. Applied to every collection in `collections.ts`. */
export function withDemoGuards(collection: CollectionDefinition): CollectionDefinition {
  return { ...collection, hooks: mergeHooks(collection.hooks, guardsFor(collection.slug)) };
}
