import type { AuthAdapter, AuthSession, AuthUser } from './index.js';
import { ForgeAuthError } from './index.js';

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
      try {
        return await adapter.requireAuth(request);
      } catch {
        // Try the next strategy; a token rejected by one adapter may belong to another.
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
