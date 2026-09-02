import { describe, expect, it, beforeEach, vi } from 'vitest';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { runAuthAdapterContractTests } from '@forge-cms/testing/contracts';
import type { AuthAdapter, AuthSession, AuthUser } from './index.js';
import { ForgeAuthError } from './index.js';
import { CompositeAuthAdapter } from './composite.adapter.js';
import { ApiKeyAuthAdapter } from './api-key.adapter.js';
import { UsersCollectionAuthAdapter } from './users-collection.adapter.js';

/**
 * A minimal `AuthAdapter` stub for exercising `CompositeAuthAdapter`'s own routing/error logic in
 * isolation, independent of any real adapter's token format. Returns the mock separately from the
 * adapter itself (rather than typing `requireAuth` as a mock on `AuthAdapter`) so tests can assert
 * whether it was called at all — proving `canHandleToken` actually skipped it — without fighting the
 * interface's `this`-typed `init()`.
 */
function stubAdapter(opts: {
  requireAuth: () => Promise<AuthUser>;
  canHandleToken?: (token: string) => boolean;
}): { adapter: AuthAdapter; requireAuth: ReturnType<typeof vi.fn> } {
  const requireAuthMock = vi.fn(opts.requireAuth);
  const adapter: AuthAdapter = {
    name: 'stub',
    init() {
      return adapter;
    },
    extractToken(request: Request): string | null {
      return request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
    },
    ...(opts.canHandleToken !== undefined && { canHandleToken: opts.canHandleToken }),
    async validateSession(): Promise<AuthSession | null> {
      return null;
    },
    requireAuth: requireAuthMock
  };
  return { adapter, requireAuth: requireAuthMock };
}

interface Setup {
  composite: CompositeAuthAdapter;
  userAuth: UsersCollectionAuthAdapter;
  apiKeyAuth: ApiKeyAuthAdapter;
}

async function createComposite(): Promise<Setup> {
  const db = new InMemoryDatabaseAdapter();
  const userAuth = new UsersCollectionAuthAdapter({ devMode: true });
  const apiKeyAuth = new ApiKeyAuthAdapter();
  const composite = new CompositeAuthAdapter([userAuth, apiKeyAuth]);

  // A single env carries both adapters' database references, mirroring how ForgeCmsRuntime.init()
  // passes one shared env to every adapter.
  composite.init({ userDatabase: db, apiKeyDatabase: db });
  await composite.syncSchema();

  return { composite, userAuth, apiKeyAuth };
}

describe('CompositeAuthAdapter', () => {
  it('throws when constructed with no adapters', () => {
    expect(() => new CompositeAuthAdapter([])).toThrow();
  });

  describe('human + machine coexistence', () => {
    let setup: Setup;

    beforeEach(async () => {
      setup = await createComposite();
    });

    it('authenticates a human user token', async () => {
      const created = await setup.userAuth.createUser({
        email: 'human@example.com',
        password: 'password123',
        role: 'editor'
      });
      if (!created.ok) throw new Error('expected success');
      const request = new Request('https://forge.test', {
        headers: { authorization: `Bearer ${created.token}` }
      });
      const user = await setup.composite.requireAuth(request);
      expect(user.email).toBe('human@example.com');
    });

    it('authenticates a machine API key', async () => {
      const { secret } = await setup.apiKeyAuth.createApiKey({
        name: 'ci-bot',
        scopes: ['articles:read']
      });
      const request = new Request('https://forge.test', {
        headers: { authorization: `Bearer ${secret}` }
      });
      const user = await setup.composite.requireAuth(request);
      expect(user.role).toBe('machine');
      expect(user.scopes).toEqual(['articles:read']);
    });

    it('one strategy failing does not break the other', async () => {
      const created = await setup.userAuth.createUser({
        email: 'human2@example.com',
        password: 'password123'
      });
      if (!created.ok) throw new Error('expected success');
      const { secret } = await setup.apiKeyAuth.createApiKey({ name: 'ci-bot-2' });

      const humanRequest = new Request('https://forge.test', {
        headers: { authorization: `Bearer ${created.token}` }
      });
      const apiKeyRequest = new Request('https://forge.test', {
        headers: { authorization: `Bearer ${secret}` }
      });
      const badRequest = new Request('https://forge.test', {
        headers: { authorization: 'Bearer garbage' }
      });

      await expect(setup.composite.requireAuth(humanRequest)).resolves.toBeTruthy();
      await expect(setup.composite.requireAuth(apiKeyRequest)).resolves.toBeTruthy();
      await expect(setup.composite.requireAuth(badRequest)).rejects.toThrow();
    });

    it('rejects when no configured strategy recognizes the token', async () => {
      const request = new Request('https://forge.test');
      await expect(setup.composite.requireAuth(request)).rejects.toThrow();
    });
  });

  describe('error semantics: expected rejection vs unexpected internal failure', () => {
    const request = new Request('https://forge.test', {
      headers: { authorization: 'Bearer whatever' }
    });

    it('continues to the next adapter on an expected ForgeAuthError', async () => {
      const rejecting = stubAdapter({
        requireAuth: () => Promise.reject(new ForgeAuthError('Unauthorized', 'unauthorized'))
      });
      const succeeding = stubAdapter({ requireAuth: () => Promise.resolve({ id: 'ok' }) });

      const composite = new CompositeAuthAdapter([rejecting.adapter, succeeding.adapter]);
      const user = await composite.requireAuth(request);

      expect(user.id).toBe('ok');
      expect(rejecting.requireAuth).toHaveBeenCalledTimes(1);
      expect(succeeding.requireAuth).toHaveBeenCalledTimes(1);
    });

    it('propagates an unexpected internal error instead of trying the next adapter', async () => {
      const dbFailure = new Error('simulated database outage');
      const failing = stubAdapter({ requireAuth: () => Promise.reject(dbFailure) });
      const neverCalled = stubAdapter({
        requireAuth: () => Promise.resolve({ id: 'should-not-run' })
      });

      const composite = new CompositeAuthAdapter([failing.adapter, neverCalled.adapter]);

      await expect(composite.requireAuth(request)).rejects.toBe(dbFailure);
      expect(neverCalled.requireAuth).not.toHaveBeenCalled();
    });

    it('propagates a non-Error thrown value the same way', async () => {
      const failing = stubAdapter({ requireAuth: () => Promise.reject('not-an-error-object') });
      const composite = new CompositeAuthAdapter([failing.adapter]);

      await expect(composite.requireAuth(request)).rejects.toBe('not-an-error-object');
    });

    it('an unexpected error from a later adapter still propagates', async () => {
      const rejecting = stubAdapter({
        requireAuth: () => Promise.reject(new ForgeAuthError('Unauthorized', 'unauthorized'))
      });
      const dbFailure = new Error('simulated database outage');
      const failing = stubAdapter({ requireAuth: () => Promise.reject(dbFailure) });

      const composite = new CompositeAuthAdapter([rejecting.adapter, failing.adapter]);
      await expect(composite.requireAuth(request)).rejects.toBe(dbFailure);
    });
  });

  describe('canHandleToken routing', () => {
    it('skips requireAuth for an adapter whose canHandleToken rejects the token', async () => {
      const skipped = stubAdapter({
        requireAuth: () => Promise.reject(new Error('should never be called')),
        canHandleToken: () => false
      });
      const succeeding = stubAdapter({ requireAuth: () => Promise.resolve({ id: 'ok' }) });

      const composite = new CompositeAuthAdapter([skipped.adapter, succeeding.adapter]);
      const request = new Request('https://forge.test', {
        headers: { authorization: 'Bearer some-token' }
      });

      const user = await composite.requireAuth(request);
      expect(user.id).toBe('ok');
      expect(skipped.requireAuth).not.toHaveBeenCalled();
    });

    it('still attempts an adapter whose canHandleToken accepts the token', async () => {
      const accepting = stubAdapter({
        requireAuth: () => Promise.resolve({ id: 'ok' }),
        canHandleToken: () => true
      });

      const composite = new CompositeAuthAdapter([accepting.adapter]);
      const request = new Request('https://forge.test', {
        headers: { authorization: 'Bearer some-token' }
      });

      await composite.requireAuth(request);
      expect(accepting.requireAuth).toHaveBeenCalledTimes(1);
    });

    it('adapters without canHandleToken are always attempted, unaffected by routing', async () => {
      const noRoutingMethod = stubAdapter({
        requireAuth: () => Promise.reject(new ForgeAuthError('Unauthorized', 'unauthorized'))
      });
      const succeeding = stubAdapter({ requireAuth: () => Promise.resolve({ id: 'ok' }) });

      const composite = new CompositeAuthAdapter([noRoutingMethod.adapter, succeeding.adapter]);
      const request = new Request('https://forge.test', {
        headers: { authorization: 'Bearer some-token' }
      });

      await composite.requireAuth(request);
      expect(noRoutingMethod.requireAuth).toHaveBeenCalledTimes(1);
    });

    it('skips an adapter with no token to extract at all when canHandleToken is present', async () => {
      const skipped = stubAdapter({
        requireAuth: () => Promise.reject(new Error('should never be called')),
        canHandleToken: () => true
      });
      const composite = new CompositeAuthAdapter([skipped.adapter]);
      const request = new Request('https://forge.test');

      await expect(composite.requireAuth(request)).rejects.toThrow(ForgeAuthError);
      expect(skipped.requireAuth).not.toHaveBeenCalled();
    });

    it('real adapters route by token shape: an API key never reaches signed-token verification', async () => {
      const setup = await createComposite();
      const { secret } = await setup.apiKeyAuth.createApiKey({ name: 'ci-bot' });
      const spy = vi.spyOn(setup.userAuth, 'requireAuth');

      const request = new Request('https://forge.test', {
        headers: { authorization: `Bearer ${secret}` }
      });
      const user = await setup.composite.requireAuth(request);

      expect(user.role).toBe('machine');
      expect(spy).not.toHaveBeenCalled();
    });
  });
});

// AuthAdapter contract, run against a composite wrapping a real UsersCollectionAuthAdapter — proves
// the composite itself satisfies the same contract every other adapter does.
const contractDb = new InMemoryDatabaseAdapter();
const contractUserAuth = new UsersCollectionAuthAdapter({ devMode: true }).init({
  userDatabase: contractDb
});
const contractUser = await contractUserAuth.createUser({
  email: 'contract@example.com',
  password: 'contract-pass'
});
const contractToken = contractUser.ok ? contractUser.token : '';

runAuthAdapterContractTests(
  () => new CompositeAuthAdapter([contractUserAuth, new ApiKeyAuthAdapter()]),
  () =>
    new Request('https://forge.test', {
      headers: { authorization: `Bearer ${contractToken}` }
    })
);
