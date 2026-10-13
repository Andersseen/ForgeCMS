import { defineEventHandler } from 'h3';
import { handleLogin } from '@forge-cms/runtime';
import { apiContext, sessionCookie } from '../../../context';
import { getServerRuntime } from '../../../runtime';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime();
  return handleLogin(apiContext(event), { runtime, cookie: sessionCookie });
});
