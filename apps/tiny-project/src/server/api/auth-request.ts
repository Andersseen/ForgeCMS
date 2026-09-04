import type { H3Event } from 'h3';
import { createError, getRequestHeaders, getRequestURL } from 'h3';
import type { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { assertCsrfSafe, CsrfError } from '@forge-cms/runtime';
import { getServerRuntime } from './runtime';

/**
 * Build a headers-only Request for auth validation — avoids `toWebRequest(event)`, which consumes
 * the request body and breaks a later `readBody(event)` call. Carries the real HTTP method through
 * so `assertCsrfSafe` sees the actual mutating method. Copied from `apps/www`'s identical helper
 * (this is exactly the "every app repeats this" duplication brief section 6 asked to measure — it
 * turned out to already be minimal per-route, see spec 055's Outcome).
 */
export function createAuthRequest(event: H3Event): Request {
  const rawHeaders = getRequestHeaders(event);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (value !== undefined) {
      headers[key] = value;
    }
  }
  return new Request(getRequestURL(event), { method: event.method, headers });
}

/** Resolves the auth adapter and asserts the caller is an admin, with a CSRF check first. */
export async function requireAdminAuth(event: H3Event): Promise<UsersCollectionAuthAdapter> {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const auth = runtime.adapters.auth as UsersCollectionAuthAdapter;
  const authRequest = createAuthRequest(event);

  try {
    assertCsrfSafe(authRequest);
    await auth.requireRole(authRequest, 'admin');
  } catch (err) {
    if (err instanceof CsrfError) {
      throw createError({ statusCode: 403, statusMessage: 'Cross-site request rejected' });
    }
    const forbidden = err instanceof Error && err.message === 'Forbidden';
    throw createError({
      statusCode: forbidden ? 403 : 401,
      statusMessage: forbidden ? 'Forbidden' : 'Unauthorized'
    });
  }

  return auth;
}
