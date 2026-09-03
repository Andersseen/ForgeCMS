import { defineEventHandler, toWebRequest } from 'h3';
import type { ApiContext } from '@forge-cms/api';
import { handleSignup } from '@forge-cms/runtime';
import { getServerRuntime } from '../../../api/runtime';

/**
 * POST /api/auth/signup
 *
 * Thin wrapper over `@forge-cms/runtime`'s `handleSignup`. Disabled by default (404) — set
 * `FORGE_ENABLE_SIGNUP=1` (a Cloudflare Pages env var in production, or the local/e2e process env) to
 * turn it on. Off by default so the real deployed app doesn't accept public signups just because the
 * primitive exists (spec 054 §7) — enabling it is a deliberate deploy-time decision, not this route's.
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
