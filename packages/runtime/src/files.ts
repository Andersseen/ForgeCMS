import type { ApiContext } from '@forge-cms/api';
import type { AnyForgeCmsRuntime } from './runtime.js';
import { AccessDeniedError, NotFoundError } from './errors.js';
import { resolveOptionalUser } from './handlers.js';
import { findStorageOwner } from './storage-intents.js';

export interface FileHandlerOptions<TEnv = unknown> {
  runtime: AnyForgeCmsRuntime<TEnv>;
  /**
   * `cache-control` for a hit served to an **anonymous** caller. Defaults to a conservative minute. A
   * hit for an authenticated caller is always `private, no-store` (spec 067): shared caches must not
   * hand a file one user may read to another who may not.
   */
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
 *
 * **Access (spec 067).** A file is served only as part of the upload document that owns it: the document
 * of the key's collection whose Forge-recorded `_storageKey` is this key. That document must be readable
 * by the caller through the normal read pipeline (collection and row access, draft visibility), exactly
 * as the Local API `findByID` with `overrideAccess: false` allows. It applies the collection's own
 * `access.read`, **not** route-level options such as `requireAuth`/`allowedRoles` — a collection
 * whose reads are gated only at its route must declare `access.read` to gate its files too. A key no
 * document owns, or one whose document the
 * caller cannot read, is the same `404` — it confirms nothing. A public bucket or CDN URL is outside
 * this handler and outside Forge's access control.
 */
export async function handleFile<TEnv = unknown>(
  context: ApiContext<TEnv>,
  options: FileHandlerOptions<TEnv>
): Promise<Response> {
  const raw = context.params?.['key'];
  if (!raw) return json({ error: 'Missing file key' }, 400);

  let key: string;
  try {
    key = decodeURIComponent(raw);
  } catch {
    return json({ error: 'Malformed file key' }, 400);
  }
  const { runtime } = options;

  try {
    const owner = await findStorageOwner(runtime, key);
    if (!owner) return notFound(key);

    const user = await resolveOptionalUser(context, runtime);
    try {
      await runtime.findByID({
        collection: owner.collection,
        id: owner.id,
        user,
        overrideAccess: false,
        depth: 0
      });
    } catch (err) {
      if (err instanceof NotFoundError || err instanceof AccessDeniedError) return notFound(key);
      throw err;
    }

    const object = await runtime.adapters.storage.get(key);
    if (!object?.body) return notFound(key);

    return new Response(object.body, {
      status: 200,
      headers: {
        'content-type': object.contentType ?? 'application/octet-stream',
        'cache-control':
          user === null ? (options.cacheControl ?? 'public, max-age=60') : 'private, no-store',
        ...(object.size !== undefined && { 'content-length': String(object.size) })
      }
    });
  } catch {
    // No driver or storage message reaches the client (it can name buckets, tables or credentials).
    return json({ error: 'Failed to read file' }, 500);
  }
}

function notFound(key: string): Response {
  return json({ error: `File '${key}' not found` }, 404);
}

/** Error bodies are never cached: an anonymous `404` must not be served to the owner who may read it. */
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
}
