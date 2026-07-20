import { defineEventHandler, readBody, createError } from 'h3';
import type { UsersCollectionAuthAdapter, CreateUserInput } from '@forge-cms/auth';
import { getServerRuntime } from '../../../api/runtime';
import { createAuthRequest } from '../../../api/auth-request';

/**
 * POST /api/auth/users
 *
 * Creates a new user.
 */
export default defineEventHandler(async (event) => {
  const serverRuntime = await getServerRuntime(event.context.cloudflare?.env);
  const auth = serverRuntime.adapters.auth as UsersCollectionAuthAdapter;

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

  if (!body.email || !body.password) {
    throw createError({ statusCode: 400, statusMessage: 'Missing email or password' });
  }

  const result = await auth.createUser({
    email: body.email,
    password: body.password,
    ...(body.name !== undefined && { name: body.name }),
    role: body.role ?? 'viewer'
  });

  if (!result) {
    throw createError({ statusCode: 409, statusMessage: 'Email already in use' });
  }

  return { data: result.user };
});
