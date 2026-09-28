import type { ApiContext } from '@forge-cms/api';
import { getLogger } from '@forge-cms/core';
import type { AuthFailureReason } from '@forge-cms/auth';
import { ForgeAuthError, buildLogoutCookie, buildSessionCookie } from '@forge-cms/auth';
import type { AnyForgeCmsRuntime } from './runtime.js';
import { assertCsrfSafe } from './csrf.js';
import { readBoundedJsonObject, resolveMaxBodyBytes } from './body.js';
import { RateLimitedError, isForgeError, toApiErrorBody } from './errors.js';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function errorResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ error: { code, message } }, status);
}

type AuthOperation = 'login' | 'signup' | 'logout' | 'me';

/**
 * Expected failures (typed `ForgeError`s: bad JSON, 413, 429, CSRF, …) are responses, never log lines.
 * An unexpected one is logged as metadata only — the operation and the error's class name — because an
 * adapter's, driver's or host throttle's error message can quote whatever it was handed: a password,
 * a token, a cookie, the request body (spec 069).
 */
function toErrorResponse(err: unknown, operation: AuthOperation): Response {
  if (isForgeError(err)) {
    const response = jsonResponse(toApiErrorBody(err), err.status);
    if (err instanceof RateLimitedError && err.retryAfterSeconds !== undefined) {
      response.headers.set('retry-after', String(err.retryAfterSeconds));
    }
    return response;
  }
  getLogger().error('Unexpected error in auth handler', {
    operation,
    error: err instanceof Error ? err.name : typeof err
  });
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
    case 'invalid-name':
      return errorResponse('INVALID_INPUT', 'Invalid name', 400);
  }
}

/** One login or signup attempt, as handed to the host's {@link AuthAttemptThrottle} (spec 069). */
export interface AuthAttempt {
  action: 'login' | 'signup';
  /**
   * The submitted email, trimmed and lower-cased — the same canonical form the users adapter looks up.
   * It is what was *submitted*: it says nothing about whether such an account exists.
   */
  identifier: string;
  /** The original request, for host policy (a client address, a tenant header, …). Its body is consumed. */
  request: Request;
}

export type AuthAttemptDecision =
  | { allowed: true }
  | {
      allowed: false;
      /** Seconds until a retry may succeed. Emitted as `Retry-After` when a finite number > 0. */
      retryAfterSeconds?: number;
    };

/**
 * A host-provided limiter for login/signup (spec 069). Forge calls it exactly once per well-formed
 * attempt — after the bounded body is parsed and before any credential lookup or password hashing —
 * with the same arguments whether or not the account exists. Forge keeps no counters: the host decides
 * the key(s) (identifier, client, tenant, a combination) and where the state lives (a Cloudflare Rate
 * Limiting binding, a proxy, an external service). A rejection is `429 RATE_LIMITED`; a throw or any
 * result other than `{ allowed: true | false }` fails closed as `500`.
 */
export type AuthAttemptThrottle = (
  attempt: AuthAttempt
) => AuthAttemptDecision | Promise<AuthAttemptDecision>;

export interface AuthHandlerOptions<TEnv = unknown> {
  runtime: AnyForgeCmsRuntime<TEnv>;
  /** Omit the cookie's `Secure` attribute — only for local `http://` development. Defaults to `true`. */
  cookie?: { secure?: boolean };
  /**
   * Login/signup only: the host's attempt limiter. Omitted, nothing is throttled (unchanged behaviour).
   * Ignored by `handleLogout`/`handleMe`.
   */
  throttle?: AuthAttemptThrottle;
  /**
   * Login/signup only: the largest accepted JSON body, in bytes. Defaults to
   * `DEFAULT_AUTH_MAX_BODY_BYTES` (8 KiB); raise it only with `passwordPolicy.maxLength`. An integer
   * from 1 to 1 MiB; anything else makes the handler throw (a configuration error, not a response).
   */
  maxBodyBytes?: number;
}

/** `Retry-After` must be a positive whole number of seconds; clamp absurd values to one day. */
const MAX_RETRY_AFTER_SECONDS = 24 * 60 * 60;

async function enforceThrottle(
  throttle: AuthAttemptThrottle | undefined,
  attempt: AuthAttempt
): Promise<void> {
  if (!throttle) return;
  const decision = (await throttle(attempt)) as Partial<AuthAttemptDecision> | null | undefined;
  if (decision?.allowed === true) return;
  if (decision?.allowed !== false) {
    throw new Error('The auth throttle returned neither { allowed: true } nor { allowed: false }');
  }
  const retry = 'retryAfterSeconds' in decision ? decision.retryAfterSeconds : undefined;
  const retryAfter =
    typeof retry === 'number' && Number.isFinite(retry) && retry > 0
      ? Math.min(Math.ceil(retry), MAX_RETRY_AFTER_SECONDS)
      : undefined;
  throw new RateLimitedError(retryAfter);
}

/** The canonical identifier handed to the throttle — the users adapter's own email normalisation. */
function canonicalIdentifier(email: string): string {
  return email.trim().toLowerCase();
}

export interface SignupHandlerOptions<TEnv = unknown> extends AuthHandlerOptions<TEnv> {
  /** Public signup is opt-in — no implicit default-on. */
  enabled: boolean;
}

/**
 * `POST` `{ email, password }` → `{ data: { user, token } }` (unchanged shape — Bearer-compatible)
 * plus a `Set-Cookie` that starts a browser session. `404` if the configured `AuthAdapter` doesn't
 * implement `login`.
 *
 * Order (spec 069): bounded body (`413`/`400`) → `options.throttle` (`429`) → `auth.login` → response.
 */
export async function handleLogin<TEnv = unknown>(
  context: ApiContext<TEnv>,
  options: AuthHandlerOptions<TEnv>
): Promise<Response> {
  const auth = options.runtime.adapters.auth;
  if (!auth.login) {
    return errorResponse('NOT_FOUND', 'Login is not supported by the configured auth adapter', 404);
  }

  // A bad `maxBodyBytes` is a host configuration error: thrown as is, never mapped to a response.
  const maxBytes = resolveMaxBodyBytes(options.maxBodyBytes);
  try {
    const body = await readBoundedJsonObject(context.request, { maxBytes });
    const email = typeof body['email'] === 'string' ? body['email'] : undefined;
    const password = typeof body['password'] === 'string' ? body['password'] : undefined;
    if (!email || !password) {
      return errorResponse('INVALID_INPUT', 'Missing email or password', 400);
    }

    await enforceThrottle(options.throttle, {
      action: 'login',
      identifier: canonicalIdentifier(email),
      request: context.request
    });
    const result = await auth.login(email, password);
    if (!result.ok) return authFailureResponse(result.reason);

    const response = jsonResponse({ data: { user: result.user, token: result.token } });
    response.headers.append(
      'set-cookie',
      buildSessionCookie(result.token, { secure: options.cookie?.secure ?? true })
    );
    return response;
  } catch (err) {
    return toErrorResponse(err, 'login');
  }
}

/**
 * `POST` `{ email, password, name? }` → `{ data: { user, token } }` + `Set-Cookie`. Any other body
 * field (e.g. a `role`) is never read — role escalation through this endpoint is structurally
 * impossible, not merely hidden. `404` when `options.enabled` is `false` or the adapter doesn't
 * implement `signup` — decided before the body is read or the throttle is called.
 *
 * Order (spec 069): bounded body (`413`/`400`) → `options.throttle` (`429`) → `auth.signup` → response.
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

  // A bad `maxBodyBytes` is a host configuration error: thrown as is, never mapped to a response.
  const maxBytes = resolveMaxBodyBytes(options.maxBodyBytes);
  try {
    const body = await readBoundedJsonObject(context.request, { maxBytes });
    const email = typeof body['email'] === 'string' ? body['email'] : undefined;
    const password = typeof body['password'] === 'string' ? body['password'] : undefined;
    const name = typeof body['name'] === 'string' ? body['name'] : undefined;
    if (!email || !password) {
      return errorResponse('INVALID_INPUT', 'Missing email or password', 400);
    }

    await enforceThrottle(options.throttle, {
      action: 'signup',
      identifier: canonicalIdentifier(email),
      request: context.request
    });
    const result = await auth.signup({ email, password, ...(name !== undefined && { name }) });
    if (!result.ok) return authFailureResponse(result.reason);

    const response = jsonResponse({ data: { user: result.user, token: result.token } }, 201);
    response.headers.append(
      'set-cookie',
      buildSessionCookie(result.token, { secure: options.cookie?.secure ?? true })
    );
    return response;
  } catch (err) {
    return toErrorResponse(err, 'signup');
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
    return toErrorResponse(err, 'logout');
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
    return toErrorResponse(err, 'me');
  }
}
