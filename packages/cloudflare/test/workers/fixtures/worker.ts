import type { ApiContext } from '@forge-cms/api';
import { defineCollection, defineField } from '@forge-cms/core';
import { ApiKeyAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime, handleList } from '@forge-cms/runtime';
import { D1DatabaseAdapter } from '../../../src/d1.adapter.js';

/**
 * `articles`/`tenant` fixture for the one HTTP-runtime integration test (spec 051 §10): a machine
 * caller needs the `articles:read` scope (permission) and its own `tenant` metadata determines which
 * rows it can see (row-level filtering), mirroring how `resolveAccess`'s `AccessResult` (boolean |
 * where-query) is meant to be used in a real multi-tenant deployment.
 */
export const articles = defineCollection({
  slug: 'articles',
  fields: {
    title: defineField.text({ required: true }),
    tenant: defineField.text({ required: true })
  },
  access: {
    read: ({ user }) => {
      const scopes = (user?.scopes as string[] | undefined) ?? [];
      if (!scopes.includes('articles:read')) return false;
      const tenant = user?.metadata?.['tenant'];
      return typeof tenant === 'string' ? { tenant } : false;
    }
  }
});

/**
 * Registered on the runtime (so a request for it resolves past `resolveRequest`'s 404 check) but
 * deliberately never synced — `adapters.database.syncSchema` below is only ever called with
 * `[articles]`. Proves a real D1 "missing table" failure surfaces through `handleList` as a clean,
 * non-leaking 500 (spec 051 §10/§13), not a 400/401/403 or a raw SQL error in the response body.
 */
export const unsynced = defineCollection({
  slug: 'unsynced',
  fields: { title: defineField.text({ required: true }) }
});

let runtimePromise: Promise<ForgeCmsRuntime> | undefined;

function getRuntime(env: unknown): Promise<ForgeCmsRuntime> {
  // Built lazily on first request, not at module scope — Workers forbids async I/O at module load,
  // and the D1/R2 bindings are not available there anyway (same rule `apps/www`'s `getServerRuntime`
  // follows).
  runtimePromise ??= (async () => {
    const database = new D1DatabaseAdapter();
    const auth = new ApiKeyAuthAdapter();
    const storage = new InMemoryStorageAdapter();

    // `apiKeyDatabase` must be the *same* `D1DatabaseAdapter` instance as `adapters.database` — the
    // spec-049 shared-instance configuration this test also proves still works against real D1.
    const runtime = new ForgeCmsRuntime({
      collections: [articles, unsynced],
      adapters: { database, auth, storage },
      env: { ...(env as object), apiKeyDatabase: database }
    });
    runtime.init();

    await runtime.adapters.database.syncSchema([articles]);
    await runtime.adapters.auth.syncSchema?.();

    return runtime;
  })();
  return runtimePromise;
}

export default {
  async fetch(request: Request, env: unknown): Promise<Response> {
    const runtime = await getRuntime(env);
    const collection = new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '';
    const context: ApiContext = { request, params: { collection }, env };
    return handleList(context, { runtime });
  }
};
