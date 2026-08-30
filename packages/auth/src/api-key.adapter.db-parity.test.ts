import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import { InMemoryDatabaseAdapter, LibSqlDatabaseAdapter } from '@forge-cms/db';
import type { DatabaseAdapter } from '@forge-cms/db';
import { ApiKeyAuthAdapter } from './api-key.adapter.js';

/**
 * Machine auth is backed by `DatabaseAdapter`, and must behave identically on every adapter — JSON
 * scope-array serialization, null handling on optional fields, timestamps, and the internal
 * `_forge_api_keys` schema in particular. Rather than a new testing framework, this runs the same
 * behavioral assertions against each adapter constructor (InMemory, libSQL — D1 parity lives in
 * `@forge-cms/cloudflare`'s `d1.adapter.test.ts`, alongside its existing D1 mock infrastructure).
 */
const adapters: [string, () => DatabaseAdapter][] = [
  ['InMemoryDatabaseAdapter', () => new InMemoryDatabaseAdapter()],
  ['LibSqlDatabaseAdapter', () => new LibSqlDatabaseAdapter('file::memory:').init()]
];

describe.each(adapters)('ApiKeyAuthAdapter on %s (adapter parity)', (_name, createDb) => {
  it('creates, authenticates, and round-trips scopes/metadata', async () => {
    const db = createDb();
    const apiKeyAuth = new ApiKeyAuthAdapter().init({ apiKeyDatabase: db });
    await apiKeyAuth.syncSchema();

    const { apiKey, secret } = await apiKeyAuth.createApiKey({
      name: 'ci-bot',
      scopes: ['articles:read', 'articles:write'],
      metadata: { tenantId: 'acme' }
    });

    const fetched = await apiKeyAuth.getApiKey(apiKey.id);
    expect(fetched?.scopes).toEqual(['articles:read', 'articles:write']);
    expect(fetched?.metadata).toEqual({ tenantId: 'acme' });

    const request = new Request('https://forge.test', {
      headers: { authorization: `Bearer ${secret}` }
    });
    const user = await apiKeyAuth.requireAuth(request);
    expect(user.role).toBe('machine');
    expect(user.scopes).toEqual(['articles:read', 'articles:write']);
  });

  it('null-handles optional fields the same way (no expiresAt/metadata/revokedAt)', async () => {
    const db = createDb();
    const apiKeyAuth = new ApiKeyAuthAdapter().init({ apiKeyDatabase: db });
    await apiKeyAuth.syncSchema();

    const { apiKey } = await apiKeyAuth.createApiKey({ name: 'no-extras' });
    const fetched = await apiKeyAuth.getApiKey(apiKey.id);

    expect(fetched?.expiresAt).toBeUndefined();
    expect(fetched?.metadata).toBeUndefined();
    expect(fetched?.revokedAt).toBeUndefined();
    expect(fetched?.scopes).toEqual([]);
  });

  it('a revoked key fails authentication', async () => {
    const db = createDb();
    const apiKeyAuth = new ApiKeyAuthAdapter().init({ apiKeyDatabase: db });
    await apiKeyAuth.syncSchema();

    const { apiKey, secret } = await apiKeyAuth.createApiKey({ name: 'ci-bot' });
    await apiKeyAuth.revokeApiKey(apiKey.id);

    const request = new Request('https://forge.test', {
      headers: { authorization: `Bearer ${secret}` }
    });
    await expect(apiKeyAuth.requireAuth(request)).rejects.toThrow();
  });

  it('revoking a key is idempotent', async () => {
    const db = createDb();
    const apiKeyAuth = new ApiKeyAuthAdapter().init({ apiKeyDatabase: db });
    await apiKeyAuth.syncSchema();

    const { apiKey } = await apiKeyAuth.createApiKey({ name: 'ci-bot' });
    await apiKeyAuth.revokeApiKey(apiKey.id);
    const first = await apiKeyAuth.getApiKey(apiKey.id);
    await apiKeyAuth.revokeApiKey(apiKey.id);
    const second = await apiKeyAuth.getApiKey(apiKey.id);

    expect(second?.revokedAt).toBe(first?.revokedAt);
  });

  it('sharing the same adapter instance as the main runtime does not break consumer collections', async () => {
    const posts = defineCollection({
      slug: 'posts',
      fields: { title: defineField.text({ required: true }) }
    });
    const db = createDb();
    await db.syncSchema([posts]);
    await db.create('posts', { title: 'Before auth sync' });

    const apiKeyAuth = new ApiKeyAuthAdapter().init({ apiKeyDatabase: db });
    await apiKeyAuth.syncSchema();

    await expect(db.create('posts', { title: 'After auth sync' })).resolves.toMatchObject({
      title: 'After auth sync'
    });
    await expect(db.findMany({ collection: 'posts' })).resolves.toHaveLength(2);
  });
});
