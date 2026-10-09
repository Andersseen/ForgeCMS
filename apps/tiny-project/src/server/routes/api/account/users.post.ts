import { defineEventHandler, createError } from 'h3';
import { authFailureResponse } from '@forge-cms/runtime';
import {
  optionalRole,
  optionalString,
  readJsonBody,
  requireAdminAuth
} from '../../../api/auth-request';

/** POST /api/account/users — creates a new user. Admin-only. */
export default defineEventHandler(async (event) => {
  // Authenticate first (headers only), then read a bounded body: an anonymous caller can no longer
  // make this route buffer a body at all (spec 069).
  const auth = await requireAdminAuth(event);
  const body = await readJsonBody(event);
  const email = optionalString(body, 'email');
  const password = optionalString(body, 'password');
  const name = optionalString(body, 'name');

  if (!email || !password) {
    throw createError({ statusCode: 400, statusMessage: 'Missing email or password' });
  }

  const result = await auth.createUser({
    email,
    password,
    ...(name !== undefined && { name }),
    role: optionalRole(body) ?? 'viewer'
  });

  if (!result.ok) {
    return authFailureResponse(result.reason);
  }

  return { data: result.user };
});
