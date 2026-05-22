import type { AuthAdapter, AuthUser } from '@forge-cms/auth';
import { beforeEach, describe, expect, it } from 'vitest';

export function runAuthAdapterContractTests<
  TUser extends AuthUser = AuthUser,
  TAdapter extends AuthAdapter<TUser> = AuthAdapter<TUser>
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
      const session = await adapter.getSession(request);
      expect(session).toBeNull();
    });

    it('returns session for authenticated request', async () => {
      const request = setupAuthenticatedRequest(adapter);
      const session = await adapter.getSession(request);
      expect(session).toBeTruthy();
      expect(session?.user).toBeTruthy();
    });

    it('throws for requireUser without auth', async () => {
      const request = new Request('https://forge.test');
      await expect(adapter.requireUser(request)).rejects.toThrow();
    });

    it('returns user for requireUser with auth', async () => {
      const request = setupAuthenticatedRequest(adapter);
      const user = await adapter.requireUser(request);
      expect(user).toBeTruthy();
      expect(user.id).toBeTruthy();
    });
  });
}
