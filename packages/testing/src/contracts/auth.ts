import { beforeEach, describe, expect, it } from 'vitest';

interface ContractAuthUser {
  id: string;
}

interface ContractAuthSession<TUser extends ContractAuthUser = ContractAuthUser> {
  user: TUser;
  expiresAt?: Date;
}

interface ContractAuthAdapter<TUser extends ContractAuthUser = ContractAuthUser> {
  readonly name: string;
  init(env?: unknown): unknown;
  extractToken(request: Request): string | null;
  validateSession(token: string): Promise<ContractAuthSession<TUser> | null>;
  requireAuth(request: Request): Promise<TUser>;
}

export function runAuthAdapterContractTests<
  TUser extends ContractAuthUser = ContractAuthUser,
  TAdapter extends ContractAuthAdapter<TUser> = ContractAuthAdapter<TUser>
>(createAdapter: () => TAdapter, setupAuthenticatedRequest: (adapter: TAdapter) => Request) {
  describe('AuthAdapter contract', () => {
    let adapter: TAdapter;

    beforeEach(() => {
      adapter = createAdapter();
    });

    it('has a name', () => {
      expect(adapter.name).toBeTruthy();
      expect(typeof adapter.name).toBe('string');
    });

    it('returns null session for unauthenticated request', async () => {
      const request = new Request('https://forge.test');
      const token = adapter.extractToken(request);
      const session = await adapter.validateSession(token ?? '');
      expect(session).toBeNull();
    });

    it('returns session for authenticated request', async () => {
      const request = setupAuthenticatedRequest(adapter);
      const token = adapter.extractToken(request);
      const session = await adapter.validateSession(token ?? '');
      expect(session).toBeTruthy();
      expect(session?.user).toBeTruthy();
    });

    it('throws for requireAuth without auth', async () => {
      const request = new Request('https://forge.test');
      await expect(adapter.requireAuth(request)).rejects.toThrow();
    });

    it('returns user for requireAuth with auth', async () => {
      const request = setupAuthenticatedRequest(adapter);
      const user = await adapter.requireAuth(request);
      expect(user).toBeTruthy();
      expect(user.id).toBeTruthy();
    });
  });
}
