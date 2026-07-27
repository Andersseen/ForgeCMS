import { defineEventHandler, getRouterParam, readBody, createError } from 'h3';
import type { CreateUserInput } from '@forge-cms/auth';
import { requireAdminAuth } from '../../../../api/auth-request';

/** PUT /api/auth/users/:id — admin only. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing user id' });

  let body: Partial<CreateUserInput>;
  try {
    body = await readBody(event);
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON body' });
  }

  const auth = await requireAdminAuth(event);
  const updated = await auth.updateUser(id, body);
  if (!updated) throw createError({ statusCode: 404, statusMessage: 'User not found' });

  return { data: updated };
});
