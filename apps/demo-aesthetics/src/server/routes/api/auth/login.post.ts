import { defineEventHandler, readBody, createError } from 'h3';
import type { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { getServerRuntime } from '../../../api/runtime';

/** POST /api/auth/login — `{ email, password }` → `{ token, user }`. */
export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);

  let body: { email?: string; password?: string };
  try {
    body = await readBody(event);
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON body' });
  }

  if (!body.email || !body.password) {
    throw createError({ statusCode: 400, statusMessage: 'Missing email or password' });
  }

  const auth = runtime.adapters.auth as UsersCollectionAuthAdapter;
  const result = await auth.login(body.email, body.password);
  if (!result.ok) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid email or password' });
  }

  return { data: { token: result.token, user: result.user } };
});
