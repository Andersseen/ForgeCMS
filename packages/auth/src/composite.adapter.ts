import type { AuthAdapter, AuthSession, AuthUser } from './index.js';
import { ForgeAuthError } from './index.js';

/**
 * Best-effort per-adapter token extraction for the `canHandleToken` pre-check — never lets an
 * adapter's `extractToken` throw abort routing; treated the same as "no token".
 */
function safeExtractToken(
  adapter: { extractToken(request: Request): string | null },
  request: Request
): string | null {
  try {
    return adapter.extractToken(request);
  } catch {
    return null;
  }
}

/**
 * Composes multiple `AuthAdapter`s into one, so an application can authenticate human sessions and
 * machine API keys (or any other mix of strategies) through a single adapter without branching in
 * `ForgeCmsRuntime`/`operations.ts`/`handlers.ts`. Each method tries its child adapters in the given
 * order and returns the first one that succeeds; a token that doesn't belong to any of them fails the
 * same generic, non-leaking way a single adapter would.
 *
 * ```ts
 * const auth = new CompositeAuthAdapter([userAuth, apiKeyAuth]);
 * ```
 */
export class CompositeAuthAdapter<TUser extends AuthUser = AuthUser> implements AuthAdapter<TUser> {
  readonly name = 'composite';
  private readonly adapters: AuthAdapter<TUser>[];

  constructor(adapters: AuthAdapter<TUser>[]) {
    if (adapters.length === 0) {
      throw new Error('CompositeAuthAdapter requires at least one adapter');
    }
    this.adapters = adapters;
  }

  init(env?: unknown): this {
    for (const adapter of this.adapters) adapter.init(env);
    return this;
  }

  extractToken(request: Request): string | null {
    for (const adapter of this.adapters) {
      const token = adapter.extractToken(request);
      if (token) return token;
    }
    return null;
  }

  async validateSession(token: string): Promise<AuthSession<TUser> | null> {
    for (const adapter of this.adapters) {
      const session = await adapter.validateSession(token);
      if (session) return session;
    }
    return null;
  }

  async requireAuth(request: Request): Promise<TUser> {
    for (const adapter of this.adapters) {
      if (adapter.canHandleToken) {
        const token = safeExtractToken(adapter, request);
        // No token at all, or a token this adapter's own format check rejects outright: skip without
        // paying for a DB round-trip / signature verification that can only fail. Adapters without
        // `canHandleToken` are unaffected and always attempted, exactly as before.
        if (!token || !adapter.canHandleToken(token)) continue;
      }

      try {
        return await adapter.requireAuth(request);
      } catch (err) {
        // Only an *expected* auth rejection (this credential is not mine / is invalid) falls through
        // to the next strategy. Anything else — a DB outage, a configuration error, a programming
        // error inside the adapter — is an unexpected internal failure and must propagate, not be
        // silently reinterpreted as "unauthenticated". Swallowing it here would let a real database
        // failure surface to callers as a misleading 401.
        if (err instanceof ForgeAuthError) continue;
        throw err;
      }
    }
    throw new ForgeAuthError('Unauthorized', 'unauthorized');
  }

  async syncSchema(): Promise<void> {
    for (const adapter of this.adapters) {
      await adapter.syncSchema?.();
    }
  }
}
