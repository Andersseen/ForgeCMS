import type { ApiContext } from '@forge-cms/api';
import type { AnyForgeCmsRuntime } from './runtime.js';

export interface FileHandlerOptions<TEnv = unknown> {
  runtime: AnyForgeCmsRuntime<TEnv>;
  /** `cache-control` for a hit. Defaults to a conservative minute. */
  cacheControl?: string;
}

/**
 * Serves a stored file back over HTTP.
 *
 * Spec 016 stores uploaded bytes through the `StorageAdapter` and writes a public URL onto the
 * document, but nothing served those bytes — so on any deployment without a public bucket (local
 * development, the in-memory adapter, a private R2) every uploaded image was a broken link. Mount
 * this on the path your storage adapter's public URL points at:
 *
 * ```ts
 * // apps/<app>/src/server/routes/api/media/[...key].get.ts
 * export default defineEventHandler((event) =>
 *   handleFile({ request: toWebRequest(event), params: { key: getRouterParam(event, 'key') ?? '' } }, { runtime })
 * );
 * ```
 */
export async function handleFile<TEnv = unknown>(
  context: ApiContext<TEnv>,
  options: FileHandlerOptions<TEnv>
): Promise<Response> {
  const raw = context.params?.['key'];
  if (!raw) {
    return new Response(JSON.stringify({ error: 'Missing file key' }), {
      status: 400,
      headers: { 'content-type': 'application/json' }
    });
  }

  const key = decodeURIComponent(raw);

  try {
    const object = await options.runtime.adapters.storage.get(key);
    if (!object?.body) {
      return new Response(JSON.stringify({ error: `File '${key}' not found` }), {
        status: 404,
        headers: { 'content-type': 'application/json' }
      });
    }

    return new Response(object.body, {
      status: 200,
      headers: {
        'content-type': object.contentType ?? 'application/octet-stream',
        'cache-control': options.cacheControl ?? 'public, max-age=60',
        ...(object.size !== undefined && { 'content-length': String(object.size) })
      }
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to read file' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}
