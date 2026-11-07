import { defineEventHandler } from 'h3';
import { handleMe } from '@forge-cms/runtime';

import { envOf, runtimeFor, webRequest } from '../../../lib/session';

/** GET /api/account/me — ForgeCMS's `handleMe`. */
export default defineEventHandler(async (event) => {
  const request = await webRequest(event);
  const runtime = await runtimeFor(event);
  return handleMe({ request: request!, env: envOf(event) }, { runtime });
});
