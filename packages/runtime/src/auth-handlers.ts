import type { ApiContext } from '@forge-cms/api';
import { getLogger } from '@forge-cms/core';
import type { AuthFailureReason } from '@forge-cms/auth';
import { ForgeAuthError, buildLogoutCookie, buildSessionCookie } from '@forge-cms/auth';
import type { AnyForgeCmsRuntime } from './runtime.js';
import { assertCsrfSafe } from './csrf.js';
import { InvalidInputError, isForgeError, toApiErrorBody } from './errors.js';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function errorResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ error: { code, message } }, status);
}

function toErrorResponse(err: unknown): Response {
  if (isForgeError(err)) {
    const body = toApiErrorBody(err);
    return jsonResponse(body, err.status);
  }
  getLogger().error('Unexpected error in auth handler', err);
  return errorResponse('INTERNAL_ERROR', 'An unexpected error occurred', 500);
}

/**
 * Reason → HTTP response. Never leaks adapter/DB internals — see spec 053's error-mapping table.
 * Exported so a host route calling `auth.login`/`auth.createUser`/`auth.signup` directly (rather than
 * through `handleLogin`/`handleSignup`) maps the same `AuthActionResult` failure reasons the same way,
 * instead of re-implementing (and risking drifting from) this switch.
 */
export function authFailureResponse(reason: AuthFailureReason): Response {
  switch (reason) {
    case 'invalid-credentials':
      return errorResponse('UNAUTHORIZED', 'Invalid email or password', 401);
    case 'invalid-email':
      return errorResponse('INVALID_INPUT', 'Invalid email address', 400);
    case 'weak-password':
      return errorResponse('INVALID_INPUT', 'Password does not meet requirements', 400);
    case 'email-in-use':
      return errorResponse('UNIQUE_CONSTRAINT', 'Email is already in use', 409);
  }
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    throw new InvalidInputError('Invalid JSON body');
  }
}

export interface AuthHandlerOptions<TEnv = unknown> {
  runtime: AnyForgeCmsRuntime<TEnv>;
  /** Omit the cookie's `Secure` attribute — only for local `http://` development. Defaults to `true`. */
  cookie?: { secure?: boolean };
}

export interface SignupHandlerOptions<TEnv = unknown> extends AuthHandlerOptions<TEnv> {
  /** Public signup is opt-in — no implicit default-on. */
  enabled: boolean;
}

/**
 * `POST` `{ email, password }` → `{ data: { user, token } }` (unchanged shape — Bearer-compatible)
 * plus a `Set-Cookie` that starts a browser session. `404` if the configured `AuthAdapter` doesn't
 * implement `login`.
 */
export async function handleLogin<TEnv = unknown>(
  context: ApiContext<TEnv>,
  options: AuthHandlerOptions<TEnv>
): Promise<Response> {
  const auth = options.runtime.adapters.auth;
  if (!auth.login) {
    return errorResponse('NOT_FOUND', 'Login is not supported by the configured auth adapter', 404);
  }

  try {
    const body = await readJsonBody(context.request);
    const email = typeof body['email'] === 'string' ? body['email'] : undefined;
    const password = typeof body['password'] === 'string' ? body['password'] : undefined;
    if (!email || !password) {
      return errorResponse('INVALID_INPUT', 'Missing email or password', 400);
    }

    const result = await auth.login(email, password);
    if (!result.ok) return authFailureResponse(result.reason);

    const response = jsonResponse({ data: { user: result.user, token: result.token } });
    response.headers.append(
      'set-cookie',
      buildSessionCookie(result.token, { secure: options.cookie?.secure ?? true })
    );
    return response;
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * `POST` `{ email, password, name? }` → `{ data: { user, token } }` + `Set-Cookie`. Any other body
 * field (e.g. a `role`) is never read — role escalation through this endpoint is structurally
 * impossible, not merely hidden. `404` when `options.enabled` is `false` or the adapter doesn't
 * implement `signup`.
 */
export async function handleSignup<TEnv = unknown>(
  context: ApiContext<TEnv>,
  options: SignupHandlerOptions<TEnv>
): Promise<Response> {
  if (!options.enabled) {
    return errorResponse('NOT_FOUND', 'Signup is disabled', 404);
  }

  const auth = options.runtime.adapters.auth;
  if (!auth.signup) {
    return errorResponse(
      'NOT_FOUND',
      'Signup is not supported by the configured auth adapter',
      404
    );
  }

  try {
    const body = await readJsonBody(context.request);
    const email = typeof body['email'] === 'string' ? body['email'] : undefined;
    const password = typeof body['password'] === 'string' ? body['password'] : undefined;
    const name = typeof body['name'] === 'string' ? body['name'] : undefined;
    if (!email || !password) {
      return errorResponse('INVALID_INPUT', 'Missing email or password', 400);
    }

    const result = await auth.signup({ email, password, ...(name !== undefined && { name }) });
    if (!result.ok) return authFailureResponse(result.reason);

    const response = jsonResponse({ data: { user: result.user, token: result.token } }, 201);
    response.headers.append(
      'set-cookie',
      buildSessionCookie(result.token, { secure: options.cookie?.secure ?? true })
    );
    return response;
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Clears the session cookie. Idempotent (`204` whether or not a session existed) and CSRF-checked
 * (a cross-site page can't force-clear a victim's session either). Does not — and cannot — revoke a
 * Bearer token held elsewhere; tokens are stateless. See spec 053's Non-goals.
 */
export async function handleLogout<TEnv = unknown>(
  context: ApiContext<TEnv>,
  options: AuthHandlerOptions<TEnv>
): Promise<Response> {
  try {
    assertCsrfSafe(context.request);
  } catch (err) {
    return toErrorResponse(err);
  }

  const response = new Response(null, { status: 204 });
  response.headers.append(
    'set-cookie',
    buildLogoutCookie({ secure: options.cookie?.secure ?? true })
  );
  return response;
}

/** `GET` → `{ data: user }` from the session (cookie or Bearer), or `401`. */
export async function handleMe<TEnv = unknown>(
  context: ApiContext<TEnv>,
  options: AuthHandlerOptions<TEnv>
): Promise<Response> {
  try {
    const user = await options.runtime.adapters.auth.requireAuth(context.request);
    return jsonResponse({ data: user });
  } catch (err) {
    if (err instanceof ForgeAuthError) {
      return errorResponse('UNAUTHORIZED', 'Unauthorized', 401);
    }
    return toErrorResponse(err);
  }
}
