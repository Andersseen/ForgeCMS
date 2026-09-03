import { defineEventHandler, toWebRequest } from 'h3';
import type { ApiContext } from '@forge-cms/api';
import { handleLogout } from '@forge-cms/runtime';
import { getServerRuntime } from '../../../api/runtime';

/**
 * POST /api/auth/logout
 *
 * Thin wrapper over `@forge-cms/runtime`'s `handleLogout` — clears the session cookie. Didn't exist at
 * all before spec 054.
 */
export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const context: ApiContext = {
    request: toWebRequest(event),
    env: event.context.cloudflare?.env
  };
  return handleLogout(context, { runtime, cookie: { secure: !!event.context.cloudflare?.env } });
});
