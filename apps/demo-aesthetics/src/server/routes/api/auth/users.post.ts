import { defineEventHandler, readBody, createError } from 'h3';
import type { CreateUserInput } from '@forge-cms/auth';
import { requireAdminAuth } from '../../../api/auth-request';

/** POST /api/auth/users — admin only. */
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

  if (!result) {
    throw createError({ statusCode: 409, statusMessage: 'Email already in use' });
  }

  return { data: result.user };
});
