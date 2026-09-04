import { defineEventHandler, toWebRequest } from 'h3';
import type { ApiContext } from '@forge-cms/api';
import { handleSignup } from '@forge-cms/runtime';
import { getServerRuntime } from '../../../api/runtime';

/**
 * POST /api/auth/signup — thin wrapper over `handleSignup`. Disabled (404) unless
 * `FORGE_ENABLE_SIGNUP=1`, matching `apps/www`'s convention.
 */
export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const context: ApiContext = {
    request: toWebRequest(event),
    env: event.context.cloudflare?.env
  };
  const enabled =
    event.context.cloudflare?.env?.FORGE_ENABLE_SIGNUP === '1' ||
    process.env['FORGE_ENABLE_SIGNUP'] === '1';
  return handleSignup(context, {
    runtime,
    enabled,
    cookie: { secure: !!event.context.cloudflare?.env }
  });
});
