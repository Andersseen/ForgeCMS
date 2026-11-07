import { defineEventHandler } from 'h3';
import { handleLogout } from '@forge-cms/runtime';

import {
  envOf,
  payloadTooLarge,
  runtimeFor,
  secureCookies,
  webRequest
} from '../../../lib/session';

/** POST /api/account/logout — ForgeCMS's `handleLogout` (clears the cookie, enforces same-origin). */
export default defineEventHandler(async (event) => {
  const request = await webRequest(event);
  if (!request) return payloadTooLarge();
  const runtime = await runtimeFor(event);
  return handleLogout(
    { request, env: envOf(event) },
    { runtime, cookie: { secure: secureCookies(event) } }
  );
});
