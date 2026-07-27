import { defineEventHandler } from 'h3';
import { requireAdminAuth } from '../../../api/auth-request';

/** GET /api/auth/users — admin only. */
export default defineEventHandler(async (event) => {
  const auth = await requireAdminAuth(event);
  return { data: await auth.listUsers() };
});
