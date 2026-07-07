import { defineEventHandler } from 'h3';
import { getServerRuntime } from '../api/runtime';

/**
 * Optional auth middleware.
 *
 * Injects `forgeUser` into the event context if a valid token is present.
 * Does not block the request — routes decide whether they require auth.
 */
export default defineEventHandler(async (event) => {
  const authHeader = event.node.req.headers.authorization;
  if (!authHeader) return;

  const serverRuntime = await getServerRuntime(event.context.cloudflare?.env);

  try {
    const user = await serverRuntime.adapters.auth.validateSession(
      authHeader.replace('Bearer ', '')
    );
    if (user) {
      event.context.forgeUser = user.user;
    }
  } catch {
    // Invalid token, continue without a user
  }
});
