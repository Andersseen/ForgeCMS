export { InMemoryAuthAdapter } from './in-memory.adapter.js';

export class ForgeAuthError extends Error {
  constructor(
    message: string,
    public readonly code: 'unauthorized' | 'forbidden' | 'expired' = 'unauthorized'
  ) {
    super(message);
    this.name = 'ForgeAuthError';
  }
}

export interface AuthUser {
  id: string;
  email?: string;
  name?: string;
  roles?: string[];
  metadata?: Record<string, unknown>;
}

export interface AuthSession<TUser extends AuthUser = AuthUser> {
  user: TUser;
  expiresAt?: Date;
}

export interface AuthAdapter<TUser extends AuthUser = AuthUser> {
  readonly name: string;
  init(env?: unknown): this;
  extractToken(request: Request): string | null;
  validateSession(token: string): Promise<AuthSession<TUser> | null>;
  requireAuth(request: Request): Promise<TUser>;
}
