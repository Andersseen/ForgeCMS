import { defineEventHandler, getRouterParam, createError } from 'h3';
import type { CreateUserInput } from '@forge-cms/auth';
import { UserMutationError } from '@forge-cms/auth';
import {
  optionalRole,
  optionalString,
  readJsonBody,
  requireAdminAuth
} from '../../../../api/auth-request';

/**
 * PUT /api/auth/users/:id — updates a user. Rejects (409/400) a change that would violate the
 * last-admin invariant or the password policy.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing user id' });
  }

  // Authenticate first (headers only), then read a bounded body (spec 069).
  const auth = await requireAdminAuth(event);
  const body = await readJsonBody(event);
  const email = optionalString(body, 'email');
  const password = optionalString(body, 'password');
  const name = optionalString(body, 'name');
  const role = optionalRole(body);
  const input: Partial<CreateUserInput> = {
    ...(email !== undefined && { email }),
    ...(password !== undefined && { password }),
    ...(name !== undefined && { name }),
    ...(role !== undefined && { role })
  };

  let updated;
  try {
    updated = await auth.updateUser(id, input);
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
