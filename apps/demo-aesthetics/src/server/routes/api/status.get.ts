import { defineEventHandler } from 'h3';
import { getServerRuntime } from '../../api/runtime';

/** Which adapters this deployment ended up with, and how much content they hold. */
export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const db = runtime.adapters.database;

  const counts: Record<string, number> = {};
  for (const collection of runtime.getCollections()) {
    counts[collection.slug] = await db.count(collection.slug);
  }

  return {
    data: {
      database: db.name,
      auth: runtime.adapters.auth.name,
      storage: runtime.adapters.storage.name,
      collections: counts
    }
  };
});
