import { defineEventHandler, getRouterParam, createError } from 'h3';
import { UserMutationError } from '@forge-cms/auth';
import { requireAdminAuth } from '../../../../api/auth-request';

/** DELETE /api/auth/users/:id — deletes a user. Rejects (409) deleting the sole remaining admin. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing user id' });
  }

  const auth = await requireAdminAuth(event);

  try {
    await auth.deleteUser(id);
  } catch (err) {
    if (err instanceof UserMutationError) {
      throw createError({ statusCode: 409, statusMessage: err.message });
    }
    throw err;
  }
  return new Response(null, { status: 204 });
});
