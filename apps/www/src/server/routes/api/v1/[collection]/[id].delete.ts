import { defineEventHandler, getRouterParam, toWebRequest } from 'h3';
import type { ApiContext } from '@forge-cms/api';
import { handleDelete } from '@forge-cms/runtime';
import { getServerRuntime } from '../../../../api/runtime';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const context: ApiContext = {
    request: toWebRequest(event),
    params: {
      collection: getRouterParam(event, 'collection') ?? '',
      id: getRouterParam(event, 'id') ?? ''
    },
    env: event.context.cloudflare?.env
  };
  return handleDelete(context, { runtime, allowedRoles: ['admin', 'editor'] });
});
