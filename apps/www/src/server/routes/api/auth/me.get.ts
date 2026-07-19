import { defineEventHandler, createError, toWebRequest } from 'h3';
import { getServerRuntime } from '../../../api/runtime';

/**
 * GET /api/auth/me
 *
 * Returns the current authenticated user by validating the Bearer token
 * against the configured auth adapter.
 */
export default defineEventHandler(async (event) => {
  const serverRuntime = await getServerRuntime(event.context.cloudflare?.env);
  const request = toWebRequest(event);

  try {
    const user = await serverRuntime.adapters.auth.requireAuth(request);
    return { data: user };
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
  }
});
