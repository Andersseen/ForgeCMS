import { defineEventHandler, createError, toWebRequest } from 'h3';
import type { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { getServerRuntime } from '../../../api/runtime';

/**
 * GET /api/auth/users
 *
 * Returns the list of users without password hashes.
 */
export default defineEventHandler(async (event) => {
  const serverRuntime = await getServerRuntime(event.context.cloudflare?.env);
  const auth = serverRuntime.adapters.auth as UsersCollectionAuthAdapter;

  try {
    await auth.requireAuth(toWebRequest(event));
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
  }

  const users = await auth.listUsers();
  return { data: users };
});
