import { defineEventHandler, setResponseStatus } from 'h3';
import type { ForgeCmsRuntime } from '@forge-cms/runtime';
import { getServerRuntime, type ServerEnv } from '../../api/runtime';
import { startupFailureBody } from '../../api/startup';

/**
 * Adapter names and record counts. If the runtime cannot start, a `503` names the failed stage (auth,
 * configuration, database, seed) without any secret — the post-deploy check prints it.
 */
export default defineEventHandler(async (event) => {
  let runtime: ForgeCmsRuntime<ServerEnv>;
  try {
    runtime = await getServerRuntime(event.context.cloudflare?.env);
  } catch (error) {
    setResponseStatus(event, 503);
    return startupFailureBody(error);
  }
  const db = runtime.adapters.database;

  // Concurrent: each count is a D1 round trip, which is slow far from the database.
  const counts = await Promise.all(runtime.getCollections().map((c) => db.count(c.slug)));
  const totalRecords = counts.reduce((sum, n) => sum + n, 0);

  return {
    data: {
      database: {
        name: db.name,
        records: totalRecords
      },
      auth: {
        name: runtime.adapters.auth.name,
        configured: runtime.adapters.auth.name !== 'in-memory'
      },
      storage: {
        name: runtime.adapters.storage.name,
        files: 0 // not yet tracked — no storage adapter reports a file count today
      },
      api: {
        version: 'v1',
        status: 'online'
      }
    }
  };
});
