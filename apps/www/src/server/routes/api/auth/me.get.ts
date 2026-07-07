import { defineEventHandler, createError, getRequestURL } from 'h3';
import { getServerRuntime } from '../../../api/runtime';

/**
 * GET /api/auth/me
 *
 * Returns the current authenticated user by validating the Bearer token
 * against the configured auth adapter (InMemory or External).
 */
export default defineEventHandler(async (event) => {
  const serverRuntime = await getServerRuntime(event.context.cloudflare?.env);
  const request = new Request(getRequestURL(event).toString(), {
    headers: event.node.req.headers as Record<string, string>
  });

  try {
    const user = await serverRuntime.adapters.auth.requireAuth(request);
    return { data: user };
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
  }
});
