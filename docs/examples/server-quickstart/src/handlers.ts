import type { ApiContext } from '@forge-cms/api';
import { handleCreate, handleList, type ForgeCmsRuntime } from '@forge-cms/runtime';
import type { ServerEnv } from './runtime.js';

// The HTTP handlers take a Web `Request` and return a Web `Response`, so they mount into any
// framework (Nitro/h3, Hono, Express through a Request adapter, a Cloudflare Worker).
export function notesApi(runtime: ForgeCmsRuntime<ServerEnv>, env: ServerEnv) {
  const context = (request: Request): ApiContext => ({
    request,
    params: { collection: 'notes' },
    env
  });
  return {
    list: (request: Request) => handleList(context(request), { runtime }),
    create: (request: Request) =>
      handleCreate(context(request), { runtime, allowedRoles: ['admin', 'editor'] })
  };
}
