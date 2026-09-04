import { defineEventHandler, toWebRequest } from 'h3';
import type { ApiContext } from '@forge-cms/api';
import { handleLogin } from '@forge-cms/runtime';
import { getServerRuntime } from '../../../api/runtime';

/** POST /api/auth/login — thin wrapper over `@forge-cms/runtime`'s `handleLogin`. */
export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const context: ApiContext = {
    request: toWebRequest(event),
    env: event.context.cloudflare?.env
  };
  return handleLogin(context, { runtime, cookie: { secure: !!event.context.cloudflare?.env } });
});
