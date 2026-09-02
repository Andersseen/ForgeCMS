import { defineEventHandler } from 'h3';
import { requireAdminAuth } from '../../../api/auth-request';

/**
 * GET /api/auth/users
 *
 * Returns the list of users without password hashes. Admin-only.
 */
export default defineEventHandler(async (event) => {
  const auth = await requireAdminAuth(event);
  const users = await auth.listUsers();
  return { data: users };
});
