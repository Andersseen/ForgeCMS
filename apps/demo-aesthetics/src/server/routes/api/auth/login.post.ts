import { defineEventHandler, toWebRequest } from 'h3';
import type { ApiContext } from '@forge-cms/api';
import { handleLogin } from '@forge-cms/runtime';
import { getServerRuntime } from '../../../api/runtime';

/**
 * POST /api/auth/login
 *
 * Thin wrapper over `@forge-cms/runtime`'s `handleLogin` (spec 054 companion fix — this route
 * previously hand-rolled `auth.login()` directly and never set the `forge_session` cookie, which broke
 * once the shared Angular client started relying on cookies instead of `localStorage`).
 */
export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const context: ApiContext = {
    request: toWebRequest(event),
    env: event.context.cloudflare?.env
  };
  return handleLogin(context, { runtime, cookie: { secure: !!event.context.cloudflare?.env } });
});
