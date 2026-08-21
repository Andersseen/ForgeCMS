import { defineEventHandler, readBody } from 'h3';
import { handleGlobalUpdate } from '@forge-cms/runtime';
import { getServerRuntime } from '../../../../api/runtime';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const body = await readBody(event);
  const globalSlug = event.context.params?.['global'];
  if (!globalSlug) {
    return new Response(
      JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'Missing global parameter' } }),
      {
        status: 400,
        headers: { 'content-type': 'application/json' }
      }
    );
  }

  return handleGlobalUpdate(
    {
      request: new Request(event.node.req.url ?? '/', {
        method: 'PUT',
        headers: event.node.req.headers as Record<string, string>,
        body: JSON.stringify(body)
      }),
      params: { global: globalSlug },
      env: event.context.cloudflare?.env
    },
    { runtime, allowedRoles: ['admin'] }
  );
});
