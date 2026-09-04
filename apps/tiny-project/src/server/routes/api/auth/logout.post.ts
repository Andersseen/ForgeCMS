import { defineEventHandler, toWebRequest } from 'h3';
import type { ApiContext } from '@forge-cms/api';
import { handleLogout } from '@forge-cms/runtime';
import { getServerRuntime } from '../../../api/runtime';

/** POST /api/auth/logout — thin wrapper over `handleLogout`. Clears the session cookie. */
export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const context: ApiContext = {
    request: toWebRequest(event),
    env: event.context.cloudflare?.env
  };
  return handleLogout(context, { runtime, cookie: { secure: !!event.context.cloudflare?.env } });
});
