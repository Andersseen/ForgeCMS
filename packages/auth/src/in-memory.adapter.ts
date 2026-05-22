import type { AuthAdapter, AuthSession, AuthUser } from './index';

export class InMemoryAuthAdapter implements AuthAdapter {
  readonly name = 'in-memory';
  private sessions: Map<string, AuthSession> = new Map();

  async getSession(request: Request): Promise<AuthSession | null> {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) return null;
    return this.sessions.get(token) ?? null;
  }

  async requireUser(request: Request): Promise<AuthUser> {
    const session = await this.getSession(request);
    if (!session) {
      throw new Error('Unauthorized');
    }
    return session.user;
  }

  // Test helper to register a session
  registerSession(token: string, session: AuthSession): void {
    this.sessions.set(token, session);
  }
}
