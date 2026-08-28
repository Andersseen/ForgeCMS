import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { runAuthAdapterContractTests } from '@forge-cms/testing/contracts';
import { CompositeAuthAdapter } from './composite.adapter.js';
import { ApiKeyAuthAdapter } from './api-key.adapter.js';
import { UsersCollectionAuthAdapter } from './users-collection.adapter.js';

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
      const request = new Request('https://forge.test', {
        headers: { authorization: `Bearer ${created?.token}` }
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
      const { secret } = await setup.apiKeyAuth.createApiKey({ name: 'ci-bot-2' });

      const humanRequest = new Request('https://forge.test', {
        headers: { authorization: `Bearer ${created?.token}` }
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
const contractToken = contractUser?.token ?? '';

runAuthAdapterContractTests(
  () => new CompositeAuthAdapter([contractUserAuth, new ApiKeyAuthAdapter()]),
  () =>
    new Request('https://forge.test', {
      headers: { authorization: `Bearer ${contractToken}` }
    })
);
