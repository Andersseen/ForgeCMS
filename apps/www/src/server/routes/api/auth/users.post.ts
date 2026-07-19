import { defineEventHandler, readBody, createError, toWebRequest } from 'h3';
import type { UsersCollectionAuthAdapter, CreateUserInput } from '@forge-cms/auth';
import { getServerRuntime } from '../../../api/runtime';

/**
 * POST /api/auth/users
 *
 * Creates a new user.
 */
export default defineEventHandler(async (event) => {
  const serverRuntime = await getServerRuntime(event.context.cloudflare?.env);
  const auth = serverRuntime.adapters.auth as UsersCollectionAuthAdapter;

  try {
    await auth.requireAuth(toWebRequest(event));
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
  }

  let body: Partial<CreateUserInput>;
  try {
    body = await readBody(event);
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON body' });
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
