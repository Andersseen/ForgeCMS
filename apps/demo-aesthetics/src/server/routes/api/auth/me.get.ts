import { defineEventHandler, createError, toWebRequest } from 'h3';
import { getServerRuntime } from '../../../api/runtime';

/** GET /api/auth/me — the current user, or 401. */
export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);

  try {
    const user = await runtime.adapters.auth.requireAuth(toWebRequest(event));
    return { data: user };
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
  }
});
