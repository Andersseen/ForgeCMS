import { defineEventHandler, setResponseStatus } from 'h3';
import { getServerRuntime, type DemoRuntime } from '../../api/runtime';
import { startupFailureBody } from '../../api/startup';

/**
 * Which adapters this deployment ended up with, and how much content they hold. If the runtime cannot
 * start, a `503` names the failed stage (auth, configuration, database, seed) without any secret —
 * the post-deploy check (`scripts/verify-deployment.mjs`) prints it.
 */
export default defineEventHandler(async (event) => {
  let runtime: DemoRuntime;
  try {
    runtime = await getServerRuntime(event.context.cloudflare?.env);
  } catch (error) {
    setResponseStatus(event, 503);
    return startupFailureBody(error);
  }
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
