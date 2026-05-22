import type { AuthAdapter, AuthSession, AuthUser } from './index.js';
import { ForgeAuthError } from './index.js';

export class InMemoryAuthAdapter implements AuthAdapter {
  readonly name = 'in-memory';
  private sessions: Map<string, AuthSession> = new Map();

  init(): this {
    return this;
  }

  extractToken(request: Request): string | null {
    return request.headers.get('authorization')?.replace('Bearer ', '') ?? null;
  }

  async validateSession(token: string): Promise<AuthSession | null> {
    if (!token) return null;
    const session = this.sessions.get(token) ?? null;

    if (session?.expiresAt && session.expiresAt.getTime() < Date.now()) {
      this.sessions.delete(token);
      return null;
    }

    return session;
  }

  async requireAuth(request: Request): Promise<AuthUser> {
    const token = this.extractToken(request);
    const session = await this.validateSession(token ?? '');

    if (!session) {
      throw new ForgeAuthError('Unauthorized', 'unauthorized');
    }

    return session.user;
  }

  // Test helper to register a session
  registerSession(token: string, session: AuthSession): void {
    this.sessions.set(token, session);
  }
}
