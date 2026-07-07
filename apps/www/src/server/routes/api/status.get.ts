import { defineEventHandler } from 'h3';
import { getServerRuntime } from '../../api/runtime';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const db = runtime.adapters.database;

  let totalRecords = 0;
  for (const collection of runtime.getCollections()) {
    const docs = await db.findMany({ collection: collection.slug });
    totalRecords += docs.length;
  }

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
