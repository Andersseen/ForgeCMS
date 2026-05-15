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
  getSession(request: Request): Promise<AuthSession<TUser> | null>;
  requireUser(request: Request): Promise<TUser>;
}
