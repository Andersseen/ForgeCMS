import { defineEventHandler } from 'h3';
import type { ApiContext } from '@forge-cms/api';
import { handleLogin } from '@forge-cms/runtime';
import { getServerRuntime } from '../../../api/runtime';
import { toCancellableWebRequest } from '../../../api/auth-request';

/**
 * POST /api/auth/login
 *
 * Thin wrapper over `@forge-cms/runtime`'s `handleLogin` — validates `{ email, password }` against
 * the users collection, returns `{ data: { user, token } }`, and starts an HttpOnly session cookie.
 */
export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const context: ApiContext = {
    request: toCancellableWebRequest(event),
    env: event.context.cloudflare?.env
  };
  return handleLogin(context, { runtime, cookie: { secure: !!event.context.cloudflare?.env } });
});
