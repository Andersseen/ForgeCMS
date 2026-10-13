import { defineEventHandler } from 'h3';
import { handleLogout } from '@forge-cms/runtime';
import { apiContext, sessionCookie } from '../../../context';
import { getServerRuntime } from '../../../runtime';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime();
  return handleLogout(apiContext(event), { runtime, cookie: sessionCookie });
});
