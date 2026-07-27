import { defineEventHandler, getRouterParam, createError } from 'h3';
import { requireAdminAuth } from '../../../../api/auth-request';

/** DELETE /api/auth/users/:id — admin only. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing user id' });

  const auth = await requireAdminAuth(event);
  await auth.deleteUser(id);
  return new Response(null, { status: 204 });
});
