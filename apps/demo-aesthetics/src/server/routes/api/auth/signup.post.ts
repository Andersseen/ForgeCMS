import { defineEventHandler, toWebRequest } from 'h3';
import type { ApiContext } from '@forge-cms/api';
import { handleSignup } from '@forge-cms/runtime';
import { getServerRuntime } from '../../../api/runtime';

/**
 * POST /api/auth/signup
 *
 * Thin wrapper over `@forge-cms/runtime`'s `handleSignup`. Disabled by default (404) — set
 * `FORGE_ENABLE_SIGNUP=1` to turn it on (used by the dedicated signup e2e spec, spec 054 §7/§27). The
 * real deployed demo does not set this; `demo-guard.ts`'s `FROZEN_PATHS` also keeps `/api/auth/users`
 * off there, independent of this flag.
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
