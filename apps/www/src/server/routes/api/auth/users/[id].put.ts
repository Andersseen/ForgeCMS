import { defineEventHandler, getRouterParam, readBody, createError } from 'h3';
import type { UsersCollectionAuthAdapter, CreateUserInput } from '@forge-cms/auth';
import { getServerRuntime } from '../../../../api/runtime';
import { createAuthRequest } from '../../../../api/auth-request';

/**
 * PUT /api/auth/users/:id
 *
 * Updates an existing user.
 */
export default defineEventHandler(async (event) => {
  const serverRuntime = await getServerRuntime(event.context.cloudflare?.env);
  const auth = serverRuntime.adapters.auth as UsersCollectionAuthAdapter;

  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing user id' });
  }

  let body: Partial<CreateUserInput>;
  try {
    body = await readBody(event);
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON body' });
  }

  try {
    await auth.requireRole(createAuthRequest(event), 'admin');
  } catch (err) {
    const statusCode = err instanceof Error && err.message === 'Forbidden' ? 403 : 401;
    throw createError({
      statusCode,
      statusMessage: err instanceof Error ? err.message : 'Unauthorized'
    });
  }

  const updated = await auth.updateUser(id, body);
  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'User not found' });
  }

  return { data: updated };
});
