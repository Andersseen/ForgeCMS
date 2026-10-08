import { defineEventHandler, toWebRequest } from 'h3';
import { handleFile } from '@forge-cms/runtime';
import { getServerRuntime } from '../../../api/runtime';
import { routeParam } from '../../../api/route-param';

/**
 * Serves an uploaded file out of the storage adapter (spec 083). `/api/media/<key>` is the default
 * public URL of every Forge storage adapter, including `@forge-cms/s3`. Access is `handleFile`'s: the
 * owning `media` document must be readable by the caller; this route only translates h3's params.
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
