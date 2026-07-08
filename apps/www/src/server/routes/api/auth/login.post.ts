import { defineEventHandler, readBody, createError } from 'h3';
import type { SignedTokenAuthAdapter } from '@forge-cms/auth';
import { getServerRuntime } from '../../../api/runtime';

/**
 * POST /api/auth/login
 *
 * Validates { email, password } against the demo credentials and returns a signed token + user.
 */
export default defineEventHandler(async (event) => {
  const serverRuntime = await getServerRuntime(event.context.cloudflare?.env);

  let body: { email?: string; password?: string };
  try {
    body = await readBody(event);
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON body' });
  }

  if (!body.email || !body.password) {
    throw createError({ statusCode: 400, statusMessage: 'Missing email or password' });
  }

  const auth = serverRuntime.adapters.auth as SignedTokenAuthAdapter;
  const result = await auth.login(body.email, body.password);
  if (!result) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid email or password' });
  }

  return { data: result };
});
