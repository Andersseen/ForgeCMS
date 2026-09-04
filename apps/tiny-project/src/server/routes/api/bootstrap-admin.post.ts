import {
  defineEventHandler,
  readBody,
  createError,
  setResponseHeader,
  setResponseStatus
} from 'h3';
import type { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { buildSessionCookie } from '@forge-cms/auth';
import { getServerRuntime } from '../../api/runtime';

/**
 * POST /api/bootstrap-admin — app-local, not a new Forge capability. Demonstrates the documented
 * pattern (small-project guide, "Create first admin"): a fresh consumer's own route that guards the
 * existing public `UsersCollectionAuthAdapter.createUser()` behind "no user exists yet". The adapter
 * itself already bootstraps the very first user ever created — via this route or `signup()` — to
 * `admin` regardless of any `role` in the request body (spec 053); this route's only job is refusing
 * to run a second time once the installation is no longer empty, and signing the new admin straight
 * in (same UX as signup) so first-run ends at a real authenticated session, not a second login step.
 */
export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const auth = runtime.adapters.auth as UsersCollectionAuthAdapter;

  const existing = await auth.listUsers();
  if (existing.length > 0) {
    throw createError({ statusCode: 409, statusMessage: 'Already initialized' });
  }

  let body: { email?: string; password?: string; name?: string };
  try {
    body = await readBody(event);
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON body' });
  }

  if (!body.email || !body.password) {
    throw createError({ statusCode: 400, statusMessage: 'Missing email or password' });
  }

  const created = await auth.createUser({
    email: body.email,
    password: body.password,
    ...(body.name !== undefined && { name: body.name })
    // No `role`: the adapter always bootstraps the first-ever user to admin (spec 053).
  });

  if (!created.ok) {
    throw createError({ statusCode: 400, statusMessage: created.reason });
  }

  const login = await auth.login(body.email, body.password);
  if (login.ok) {
    setResponseHeader(
      event,
      'set-cookie',
      buildSessionCookie(login.token, { secure: !!event.context.cloudflare?.env })
    );
  }

  setResponseStatus(event, 201);
  return { data: { user: created.user } };
});
