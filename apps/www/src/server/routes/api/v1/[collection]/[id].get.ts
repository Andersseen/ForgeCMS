import { defineEventHandler, toWebRequest } from 'h3';
import type { ApiContext } from '@forge-cms/api';
import { handleRead } from '@forge-cms/runtime';
import { getServerRuntime } from '../../../../api/runtime';
import { routeParam } from '../../../../api/route-param';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const context: ApiContext = {
    request: toWebRequest(event),
    params: {
      collection: routeParam(event, 'collection'),
      id: routeParam(event, 'id')
    },
    env: event.context.cloudflare?.env
  };
  return handleRead(context, { runtime });
});
