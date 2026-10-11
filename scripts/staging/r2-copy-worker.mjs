/**
 * Disposable Worker for the R03 metadata-preserving R2 copy (spec 090). Wrangler 4.91's `r2 object put` has no
 * custom-metadata option, so bytes + httpMetadata + customMetadata are copied through the R2 binding API.
 * Bindings: SOURCE, TARGET (both staging buckets) and the secret COPY_TOKEN. Deployed for the copy, then deleted.
 *
 *   POST /copy    body {"keys": [...]}   → copies exactly those keys SOURCE → TARGET, returns per-key sha256/size/meta
 *   POST /inspect body {"keys": [...]}   → reads the keys from TARGET and returns the same record
 */
const toHex = (buffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function describe(object) {
  const bytes = await object.arrayBuffer();
  return {
    size: bytes.byteLength,
    sha256: toHex(await crypto.subtle.digest('SHA-256', bytes)),
    contentType: object.httpMetadata?.contentType ?? null,
    customMetadata: object.customMetadata ?? {},
    bytes
  };
}

export async function copyObjects(source, target, keys) {
  const out = {};
  for (const key of keys) {
    const object = await source.get(key);
    if (!object) {
      out[key] = { error: 'missing in source' };
      continue;
    }
    const { bytes, ...record } = await describe(object);
    await target.put(key, bytes, {
      httpMetadata: object.httpMetadata,
      customMetadata: object.customMetadata
    });
    out[key] = record;
  }
  return out;
}

export async function inspectObjects(bucket, keys) {
  const out = {};
  for (const key of keys) {
    const object = await bucket.get(key);
    if (!object) {
      out[key] = null;
      continue;
    }
    const { bytes: _bytes, ...record } = await describe(object);
    out[key] = record;
  }
  return out;
}

export default {
  async fetch(request, env) {
    if (
      request.method !== 'POST' ||
      request.headers.get('authorization') !== `Bearer ${env.COPY_TOKEN}`
    ) {
      return new Response('forbidden', { status: 403 });
    }
    const { keys } = await request.json();
    if (!Array.isArray(keys) || keys.some((k) => typeof k !== 'string')) {
      return new Response('bad keys', { status: 400 });
    }
    const path = new URL(request.url).pathname;
    if (path === '/copy') return Response.json(await copyObjects(env.SOURCE, env.TARGET, keys));
    if (path === '/inspect') return Response.json(await inspectObjects(env.TARGET, keys));
    return new Response('not found', { status: 404 });
  }
};
