import { defineEventHandler, getRouterParam, readBody, createError } from 'h3';
import type { CreateUserInput } from '@forge-cms/auth';
import { UserMutationError } from '@forge-cms/auth';
import { requireAdminAuth } from '../../../../api/auth-request';

/**
 * PUT /api/auth/users/:id — updates a user. Rejects (409/400) a change that would violate the
 * last-admin invariant or the password policy.
 */
export default defineEventHandler(async (event) => {
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

  const auth = await requireAdminAuth(event);

  let updated;
  try {
    updated = await auth.updateUser(id, body);
  } catch (err) {
    if (err instanceof UserMutationError) {
      throw createError({
        statusCode: err.reason === 'last-admin' ? 409 : 400,
        statusMessage: err.message
      });
    }
    throw err;
  }
  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'User not found' });
  }

  return { data: updated };
});
