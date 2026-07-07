import { defineEventHandler, createError, getRequestURL } from 'h3';
import { getServerRuntime } from '../../../api/runtime';

/**
 * GET /api/auth/me
 *
 * Devuelve el usuario autenticado actual validando el Bearer token
 * contra el auth adapter configurado (InMemory o External).
 */
export default defineEventHandler(async (event) => {
  const serverRuntime = await getServerRuntime();
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
