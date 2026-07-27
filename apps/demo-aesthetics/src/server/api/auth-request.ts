import type { H3Event } from 'h3';
import { createError, getRequestHeaders, getRequestURL } from 'h3';
import type { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { getServerRuntime } from './runtime';

/**
 * Build a headers-only Request for auth validation.
 *
 * `toWebRequest(event)` consumes the body, which breaks a later `readBody(event)` in POST/PUT
 * handlers — see known issue #8 in docs/STATE.md.
 */
export function createAuthRequest(event: H3Event): Request {
  const rawHeaders = getRequestHeaders(event);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (value !== undefined) headers[key] = value;
  }
  return new Request(getRequestURL(event), { headers });
}

/**
 * Resolves the auth adapter and asserts the caller is an admin.
 *
 * `apps/www` repeats this ~10-line try/catch in each of its four user routes; ForgeCMS ships no
 * h3/Nitro helper for it (finding 11), so the demo at least keeps it in one place.
 */
export async function requireAdminAuth(event: H3Event): Promise<UsersCollectionAuthAdapter> {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const auth = runtime.adapters.auth as UsersCollectionAuthAdapter;

  try {
    await auth.requireRole(createAuthRequest(event), 'admin');
  } catch (err) {
    const forbidden = err instanceof Error && err.message === 'Forbidden';
    throw createError({
      statusCode: forbidden ? 403 : 401,
      statusMessage: forbidden ? 'Forbidden' : 'Unauthorized'
    });
  }

  return auth;
}
