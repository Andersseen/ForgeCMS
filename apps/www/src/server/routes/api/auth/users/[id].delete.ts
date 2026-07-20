import { defineEventHandler, getRouterParam, createError } from 'h3';
import type { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { getServerRuntime } from '../../../../api/runtime';
import { createAuthRequest } from '../../../../api/auth-request';

/**
 * DELETE /api/auth/users/:id
 *
 * Deletes a user.
 */
export default defineEventHandler(async (event) => {
  const serverRuntime = await getServerRuntime(event.context.cloudflare?.env);
  const auth = serverRuntime.adapters.auth as UsersCollectionAuthAdapter;

  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing user id' });
  }

  try {
    await auth.requireAuth(createAuthRequest(event));
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
  }

  await auth.deleteUser(id);
  return new Response(null, { status: 204 });
});
