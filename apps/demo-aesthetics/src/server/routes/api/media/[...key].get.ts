import { createError, defineEventHandler, getRouterParam } from 'h3';
import { getServerRuntime } from '../../../api/runtime';

/**
 * Serves an uploaded file out of the storage adapter.
 *
 * FINDING 21: spec 016 stores the bytes and writes a `url` onto the document, but nothing serves
 * them back — `StorageAdapter` has no HTTP story and `InMemoryStorageAdapter.getPublicUrl` returns
 * a made-up `https://forge.test/storage/<key>`. Without this route every uploaded image in the
 * media library is a broken link in local development.
 */
export default defineEventHandler(async (event) => {
  const key = getRouterParam(event, 'key');
  if (!key) throw createError({ statusCode: 400, statusMessage: 'Missing key' });

  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const object = await runtime.adapters.storage.get(decodeURIComponent(key));
  if (!object) throw createError({ statusCode: 404, statusMessage: 'File not found' });

  return new Response(object.body as ArrayBuffer, {
    headers: {
      'content-type': object.contentType ?? 'application/octet-stream',
      'cache-control': 'public, max-age=60'
    }
  });
});
