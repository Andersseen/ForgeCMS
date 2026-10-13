import {
  createError,
  defineEventHandler,
  readBody,
  setResponseHeader,
  setResponseStatus
} from 'h3';
import { buildSessionCookie, type UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { sessionCookie } from '../../context';
import { getServerRuntime } from '../../runtime';

// Creates the FIRST user, who is always an admin, and signs them in. Refuses once any user exists.
export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime();
  const auth = runtime.adapters.auth as UsersCollectionAuthAdapter;

  if ((await auth.listUsers()).length > 0) {
    throw createError({ statusCode: 409, statusMessage: 'Already initialized' });
  }

  const body = (await readBody<{ email?: string; password?: string }>(event)) ?? {};
  if (!body.email || !body.password) {
    throw createError({ statusCode: 400, statusMessage: 'Missing email or password' });
  }

  const created = await auth.createUser({ email: body.email, password: body.password });
  if (!created.ok) throw createError({ statusCode: 400, statusMessage: created.reason });

  const login = await auth.login(body.email, body.password);
  if (login.ok)
    setResponseHeader(event, 'set-cookie', buildSessionCookie(login.token, sessionCookie));

  setResponseStatus(event, 201);
  return { data: { user: created.user } };
});
