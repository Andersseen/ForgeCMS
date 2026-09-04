import { defineEventHandler, toWebRequest } from 'h3';
import type { ApiContext } from '@forge-cms/api';
import { handleMe } from '@forge-cms/runtime';
import { getServerRuntime } from '../../../api/runtime';

/** GET /api/auth/me — thin wrapper over `handleMe`. */
export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const context: ApiContext = {
    request: toWebRequest(event),
    env: event.context.cloudflare?.env
  };
  return handleMe(context, { runtime });
});
