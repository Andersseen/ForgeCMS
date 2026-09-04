import { defineEventHandler, readBody, createError } from 'h3';
import type { CreateUserInput } from '@forge-cms/auth';
import { authFailureResponse } from '@forge-cms/runtime';
import { requireAdminAuth } from '../../../api/auth-request';

/** POST /api/auth/users — creates a new user. Admin-only. */
export default defineEventHandler(async (event) => {
  let body: Partial<CreateUserInput>;
  try {
    body = await readBody(event);
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON body' });
  }

  const auth = await requireAdminAuth(event);

  if (!body.email || !body.password) {
    throw createError({ statusCode: 400, statusMessage: 'Missing email or password' });
  }

  const result = await auth.createUser({
    email: body.email,
    password: body.password,
    ...(body.name !== undefined && { name: body.name }),
    role: body.role ?? 'viewer'
  });

  if (!result.ok) {
    return authFailureResponse(result.reason);
  }

  return { data: result.user };
});
