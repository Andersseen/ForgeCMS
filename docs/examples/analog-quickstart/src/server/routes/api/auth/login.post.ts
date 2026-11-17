import { defineEventHandler, getRequestIP } from 'h3';
import { handleLogin } from '@forge-cms/runtime';
import { apiContext, sessionCookie } from '../../../context';
import { getAuthThrottle, getServerRuntime } from '../../../runtime';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime();
  // The socket address. Behind a reverse proxy you trust, use getRequestIP(event, { xForwardedFor: true }).
  const client = getRequestIP(event) ?? 'unknown';
  const throttle = (await getAuthThrottle()).forClient(client);
  return handleLogin(apiContext(event), { runtime, cookie: sessionCookie, throttle });
});
