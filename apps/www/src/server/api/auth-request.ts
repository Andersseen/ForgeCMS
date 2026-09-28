import type { H3Event } from 'h3';
import { createError, getRequestHeaders, getRequestURL, toWebRequest } from 'h3';
import type { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { assertCsrfSafe, CsrfError, isForgeError, readBoundedJsonObject } from '@forge-cms/runtime';
import { getServerRuntime } from './runtime';

/**
 * Build a headers-only Request for auth validation.
 *
 * Avoids `toWebRequest(event)` because that consumes the request body, which breaks later
 * `readBody(event)` calls in POST/PUT handlers. Carries the real HTTP method through (the `Request`
 * constructor otherwise defaults to `GET`) — required for `assertCsrfSafe` below to see the actual
 * mutating method instead of silently no-op'ing on every request.
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

/**
 * Resolves the auth adapter and asserts the caller is an admin — shared by every admin user-management
 * route (`users.post.ts`, `users/[id].put.ts`, `users/[id].delete.ts`) so the CSRF check below can't be
 * forgotten in one of them. `UsersCollectionAuthAdapter.extractToken` accepts the session cookie as
 * well as `Authorization: Bearer` (spec 053), which makes these routes reachable via the ambient
 * cookie exactly like any other mutating endpoint — `assertCsrfSafe` covers that the same way
 * `packages/runtime/src/handlers.ts` does for the generic collection routes.
 */
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

/**
 * Reads an admin/bootstrap route's JSON body with the same bound as login/signup (spec 069). `h3`'s
 * `readBody` buffers whatever arrives; this stops at 8 KiB and answers `413`/`400` instead. Only a
 * headers-only request is used for authentication, so the body stream is still unread here.
 */
export async function readJsonBody(event: H3Event): Promise<Record<string, unknown>> {
  try {
    return await readBoundedJsonObject(toCancellableWebRequest(event));
  } catch (err) {
    if (isForgeError(err)) {
      throw createError({ statusCode: err.status, statusMessage: err.message });
    }
    throw err;
  }
}

/** A string field, `undefined` when absent; any other type is a `400`. */
export function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw createError({ statusCode: 400, statusMessage: `Invalid ${key}` });
  }
  return value;
}

const ROLES = ['admin', 'editor', 'viewer'] as const;

/** A requested role, `undefined` when absent; anything but a known role is a `400`. */
export function optionalRole(body: Record<string, unknown>): (typeof ROLES)[number] | undefined {
  const role = body['role'];
  if (role === undefined) return undefined;
  const known = ROLES.find((candidate) => candidate === role);
  if (!known) throw createError({ statusCode: 400, statusMessage: 'Invalid role' });
  return known;
}

/**
 * `toWebRequest(event)` for routes that read a bounded body (spec 069). h3 1.15's Node adapter builds a
 * body stream without a `cancel` handler, so when Forge's bounded reader cancels an oversized body, the
 * next `data`/`end` event throws an uncaught `Controller is already closed` in the Node process (the
 * Vite dev server, a Node deployment). This stream accepts cancellation and discards the rest of the
 * body instead of throwing, and is pull-based, so bytes nobody asks for are never buffered. Anywhere else (Cloudflare, where Nitro hands h3 a
 * ready-made body) it is plain `toWebRequest`.
 */
export function toCancellableWebRequest(event: H3Event): Request {
  const req = event.node?.req;
  if (
    event.method === 'GET' ||
    event.method === 'HEAD' ||
    event.web?.request !== undefined ||
    req === undefined ||
    '__unenv__' in req
  ) {
    return toWebRequest(event);
  }

  // Pull-based: the socket only flows while a reader wants bytes. A route that never reads the body
  // (disabled signup, an unsupported adapter) leaves it paused, and Node discards it after the response.
  let cancelled = false;
  req.pause();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      req.on('data', (chunk: Uint8Array) => {
        if (cancelled) return;
        controller.enqueue(chunk);
        if ((controller.desiredSize ?? 0) <= 0) req.pause();
      });
      req.on('end', () => {
        if (!cancelled) controller.close();
      });
      req.on('error', (err: unknown) => {
        if (!cancelled) controller.error(err);
      });
    },
    pull() {
      req.resume();
    },
    cancel() {
      cancelled = true;
      // Drain and discard the rest so the response can still be written on this connection.
      req.resume();
    }
  });
  const headers = createAuthRequest(event).headers;
  return new Request(getRequestURL(event), {
    method: event.method,
    headers,
    body,
    duplex: 'half'
  } as RequestInit);
}
