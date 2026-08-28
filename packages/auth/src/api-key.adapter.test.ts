import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { runAuthAdapterContractTests } from '@forge-cms/testing/contracts';
import { ApiKeyAuthAdapter } from './api-key.adapter.js';

async function createAdapter() {
  const db = new InMemoryDatabaseAdapter();
  const adapter = new ApiKeyAuthAdapter().init({ apiKeyDatabase: db });
  await adapter.syncSchema();
  return { adapter, db };
}

const contract = await createAdapter();
const contractKey = await contract.adapter.createApiKey({ name: 'contract-key' });

runAuthAdapterContractTests(
  () => new ApiKeyAuthAdapter().init({ apiKeyDatabase: contract.db }),
  () =>
    new Request('https://forge.test', {
      headers: { authorization: `Bearer ${contractKey.secret}` }
    })
);

describe('ApiKeyAuthAdapter', () => {
  let adapter: ApiKeyAuthAdapter;
  let db: InMemoryDatabaseAdapter;

  beforeEach(async () => {
    ({ adapter, db } = await createAdapter());
  });

  it('rejects an invalid custom prefix', () => {
    expect(() => new ApiKeyAuthAdapter({ prefix: 'my_app' })).toThrow(/invalid/i);
    expect(() => new ApiKeyAuthAdapter({ prefix: '1abc' })).toThrow(/invalid/i);
  });

  it('accepts a valid custom prefix and uses it in the issued secret', async () => {
    const db = new InMemoryDatabaseAdapter();
    const custom = new ApiKeyAuthAdapter({ prefix: 'myapp' }).init({ apiKeyDatabase: db });
    await custom.syncSchema();
    const { secret } = await custom.createApiKey({ name: 'k' });
    expect(secret.startsWith('myapp_')).toBe(true);
  });

  describe('creation', () => {
    it('creates a high-entropy key and returns the plaintext secret once', async () => {
      const { apiKey, secret } = await adapter.createApiKey({ name: 'ci-bot' });
      expect(apiKey.name).toBe('ci-bot');
      expect(typeof secret).toBe('string');
      // prefix_<uuid>_<random> — the random part alone should carry real entropy.
      const parts = secret.split('_');
      const randomPart = parts.slice(2).join('_');
      expect(randomPart.length).toBeGreaterThanOrEqual(32);
    });

    it('two keys never share the same secret', async () => {
      const a = await adapter.createApiKey({ name: 'a' });
      const b = await adapter.createApiKey({ name: 'b' });
      expect(a.secret).not.toBe(b.secret);
    });

    it('the persisted record contains a hash, not the plaintext secret', async () => {
      const { apiKey, secret } = await adapter.createApiKey({ name: 'ci-bot' });
      const stored = await db.findById('_forge_api_keys', apiKey.id);
      expect(stored).not.toBeNull();
      expect(stored?.secretHash).toBeTruthy();
      expect(stored?.secretHash).not.toBe(secret);
      expect(JSON.stringify(stored)).not.toContain(secret.split('_').slice(2).join('_'));
    });

    it('list/get never expose secretHash or the plaintext secret', async () => {
      const { apiKey, secret } = await adapter.createApiKey({ name: 'ci-bot' });

      const list = await adapter.listApiKeys();
      const got = await adapter.getApiKey(apiKey.id);

      for (const key of [...list, got]) {
        expect(key).not.toHaveProperty('secretHash');
        expect(JSON.stringify(key)).not.toContain(secret);
      }
    });
  });

  describe('authentication', () => {
    it('a valid key authenticates', async () => {
      const { secret } = await adapter.createApiKey({ name: 'ci-bot' });
      const request = new Request('https://forge.test', {
        headers: { authorization: `Bearer ${secret}` }
      });
      const user = await adapter.requireAuth(request);
      expect(user.role).toBe('machine');
    });

    it('an invalid/unknown key fails', async () => {
      const request = new Request('https://forge.test', {
        headers: { authorization: 'Bearer forge_00000000-0000-0000-0000-000000000000_bogus' }
      });
      await expect(adapter.requireAuth(request)).rejects.toThrow();
    });

    it('a token with a different/no format fails cheaply without leaking anything', async () => {
      const request = new Request('https://forge.test', {
        headers: { authorization: 'Bearer not-an-api-key-token' }
      });
      await expect(adapter.requireAuth(request)).rejects.toThrow();
    });

    it('a modified secret fails', async () => {
      const { secret } = await adapter.createApiKey({ name: 'ci-bot' });
      const tampered = secret.slice(0, -1) + (secret.endsWith('a') ? 'b' : 'a');
      const request = new Request('https://forge.test', {
        headers: { authorization: `Bearer ${tampered}` }
      });
      await expect(adapter.requireAuth(request)).rejects.toThrow();
    });

    it('a revoked key fails', async () => {
      const { apiKey, secret } = await adapter.createApiKey({ name: 'ci-bot' });
      await adapter.revokeApiKey(apiKey.id);
      const request = new Request('https://forge.test', {
        headers: { authorization: `Bearer ${secret}` }
      });
      await expect(adapter.requireAuth(request)).rejects.toThrow();
    });

    it('an expired key fails', async () => {
      const { secret } = await adapter.createApiKey({
        name: 'ci-bot',
        expiresAt: new Date(Date.now() - 1000).toISOString()
      });
      const request = new Request('https://forge.test', {
        headers: { authorization: `Bearer ${secret}` }
      });
      await expect(adapter.requireAuth(request)).rejects.toThrow();
    });

    it('a not-yet-expired key still authenticates', async () => {
      const { secret } = await adapter.createApiKey({
        name: 'ci-bot',
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      });
      const request = new Request('https://forge.test', {
        headers: { authorization: `Bearer ${secret}` }
      });
      await expect(adapter.requireAuth(request)).resolves.toBeTruthy();
    });
  });

  describe('scopes and metadata', () => {
    it('the machine principal receives the configured scopes', async () => {
      const { secret } = await adapter.createApiKey({
        name: 'ci-bot',
        scopes: ['articles:read', 'articles:write']
      });
      const request = new Request('https://forge.test', {
        headers: { authorization: `Bearer ${secret}` }
      });
      const user = await adapter.requireAuth(request);
      expect(user.scopes).toEqual(['articles:read', 'articles:write']);
    });

    it('defaults to an empty scopes array when none are given', async () => {
      const { secret } = await adapter.createApiKey({ name: 'ci-bot' });
      const request = new Request('https://forge.test', {
        headers: { authorization: `Bearer ${secret}` }
      });
      const user = await adapter.requireAuth(request);
      expect(user.scopes).toEqual([]);
    });

    it('arbitrary consumer-defined metadata reaches the authenticated principal', async () => {
      const { secret } = await adapter.createApiKey({
        name: 'ci-bot',
        metadata: { tenantId: 'acme', env: 'staging' }
      });
      const request = new Request('https://forge.test', {
        headers: { authorization: `Bearer ${secret}` }
      });
      const user = await adapter.requireAuth(request);
      expect(user.metadata).toEqual({ tenantId: 'acme', env: 'staging' });
    });
  });

  describe('lastUsedAt', () => {
    it('is set after a successful authentication', async () => {
      const { apiKey, secret } = await adapter.createApiKey({ name: 'ci-bot' });
      expect(apiKey.lastUsedAt).toBeUndefined();

      const request = new Request('https://forge.test', {
        headers: { authorization: `Bearer ${secret}` }
      });
      await adapter.requireAuth(request);

      const after = await adapter.getApiKey(apiKey.id);
      expect(after?.lastUsedAt).toBeTruthy();
    });
  });

  describe('revocation and deletion', () => {
    it('revoke sets revokedAt but keeps the record listable', async () => {
      const { apiKey } = await adapter.createApiKey({ name: 'ci-bot' });
      await adapter.revokeApiKey(apiKey.id);
      const after = await adapter.getApiKey(apiKey.id);
      expect(after?.revokedAt).toBeTruthy();
    });

    it('delete removes the record entirely', async () => {
      const { apiKey } = await adapter.createApiKey({ name: 'ci-bot' });
      await adapter.deleteApiKey(apiKey.id);
      const after = await adapter.getApiKey(apiKey.id);
      expect(after).toBeNull();
    });
  });
});
