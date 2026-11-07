import { defineEventHandler } from 'h3';
import { handleLogin } from '@forge-cms/runtime';

import {
  envOf,
  payloadTooLarge,
  runtimeFor,
  secureCookies,
  webRequest
} from '../../../lib/session';

/** POST /api/account/login — a native H3 route over ForgeCMS's own `handleLogin` (sets the session cookie). */
export default defineEventHandler(async (event) => {
  const request = await webRequest(event);
  if (!request) return payloadTooLarge();
  const runtime = await runtimeFor(event);
  return handleLogin(
    { request, env: envOf(event) },
    { runtime, cookie: { secure: secureCookies(event) } }
  );
});
