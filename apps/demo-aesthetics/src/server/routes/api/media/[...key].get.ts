import { defineEventHandler, toWebRequest } from 'h3';
import { handleFile } from '@forge-cms/runtime';
import { getServerRuntime } from '../../../api/runtime';
import { routeParam } from '../../../api/route-param';

/**
 * Serves an uploaded file out of the storage adapter.
 *
 * The path matches what the adapters hand back as a public URL, so the document's `url` field just
 * works: `InMemoryStorageAdapter` returns `/api/media/<key>` by default, and `R2StorageAdapter`
 * does the same unless it is given a CDN base. Reading the bytes is `@forge-cms/runtime`'s job
 * (spec 040) — this file only translates h3's params.
 */
export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);

  return handleFile(
    {
      request: toWebRequest(event),
      params: { key: routeParam(event, 'key') },
      env: event.context.cloudflare?.env
    },
    { runtime }
  );
});
