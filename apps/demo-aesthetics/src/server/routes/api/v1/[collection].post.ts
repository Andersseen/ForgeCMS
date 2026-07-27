import { defineEventHandler, getRouterParam, toWebRequest } from 'h3';
import type { ApiContext } from '@forge-cms/api';
import { handleCreate } from '@forge-cms/runtime';
import { getServerRuntime } from '../../../api/runtime';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const context: ApiContext = {
    request: toWebRequest(event),
    params: { collection: getRouterParam(event, 'collection') ?? '' },
    env: event.context.cloudflare?.env
  };
  // `allowedRoles` is a per-route constant, so the generic CRUD route cannot host the public
  // booking form — that lives at POST /api/site/bookings instead (finding 5).
  return handleCreate(context, { runtime, allowedRoles: ['admin', 'editor'] });
});
