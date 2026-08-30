import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import {
  ApiKeyAuthAdapter,
  CompositeAuthAdapter,
  InMemoryAuthAdapter,
  hasScope
} from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from './runtime.js';
import { handleList } from './handlers.js';
import type { ApiContext } from '@forge-cms/api';

function jsonBody(response: Response): Promise<{ data: Array<Record<string, unknown>> }> {
  return response.json() as Promise<{ data: Array<Record<string, unknown>> }>;
}

function requestFor(url: string, secret: string): ApiContext<unknown> {
  return {
    request: new Request(url, { headers: { authorization: `Bearer ${secret}` } }),
    env: {}
  };
}

describe('syncSchema safety: ApiKeyAuthAdapter sharing the main database adapter', () => {
  it('keeps consumer collections usable after runtime.syncSchema() also runs the auth adapter syncSchema', async () => {
    // This is the documented/tested wiring: `apiKeyDatabase` is the *same* adapter instance as
    // `adapters.database`. Before the fix, `ForgeCmsRuntime.syncSchema()` calling
    // `database.syncSchema(config.collections)` and then `auth.syncSchema?.()` (which calls
    // `database.syncSchema([_forge_api_keys])` again on the same instance) wiped every consumer
    // collection's registration, breaking every subsequent operation on it.
    const articles = defineCollection({
      slug: 'articles',
      fields: { title: defineField.text({ required: true }) }
    });

    const db = new InMemoryDatabaseAdapter();
    const auth = new CompositeAuthAdapter([new InMemoryAuthAdapter(), new ApiKeyAuthAdapter()]);

    const runtime = new ForgeCmsRuntime({
      collections: [articles],
      adapters: { database: db, auth, storage: new InMemoryStorageAdapter() },
      env: { apiKeyDatabase: db }
    });

    runtime.init();
    await runtime.syncSchema();

    const created = await runtime.create({ collection: 'articles', data: { title: 'Hello' } });
    expect(created.title).toBe('Hello');

    const listed = await runtime.find({ collection: 'articles' });
    expect(listed.docs).toHaveLength(1);

    const updated = await runtime.update({
      collection: 'articles',
      id: String(created.id),
      data: { title: 'Updated' }
    });
    expect(updated.title).toBe('Updated');
  });

  it('is safe to call syncSchema twice, with different collection sets, in either order', async () => {
    const articles = defineCollection({
      slug: 'articles',
      fields: { title: defineField.text({ required: true }) }
    });
    const db = new InMemoryDatabaseAdapter();

    await db.syncSchema([articles]);
    await db.create('articles', { title: 'First' });

    // A second, unrelated syncSchema call (what ApiKeyAuthAdapter.syncSchema() does) must not drop
    // `articles`'s registration.
    const apiKeys = defineCollection({
      slug: 'unrelated_internal_collection',
      fields: { name: defineField.text({ required: true }) }
    });
    await db.syncSchema([apiKeys]);

    await expect(db.create('articles', { title: 'Second' })).resolves.toMatchObject({
      title: 'Second'
    });
    await expect(db.findMany({ collection: 'articles' })).resolves.toHaveLength(2);
  });
});

describe('a machine principal reaches real collection/field/row-level access', () => {
  function buildRuntime() {
    const articles = defineCollection({
      slug: 'articles',
      access: {
        read: ({ user }) => hasScope(user, 'articles:read')
      },
      fields: {
        title: defineField.text({ required: true }),
        internalNote: defineField.text({ access: { read: () => false } })
      }
    });

    const db = new InMemoryDatabaseAdapter();
    const apiKeyAuth = new ApiKeyAuthAdapter();
    const auth = new CompositeAuthAdapter([new InMemoryAuthAdapter(), apiKeyAuth]);

    const runtime = new ForgeCmsRuntime({
      collections: [articles],
      adapters: { database: db, auth, storage: new InMemoryStorageAdapter() },
      env: { apiKeyDatabase: db }
    });
    runtime.init();
    return { runtime, apiKeyAuth, db };
  }

  it('boolean collection access: a machine principal with the right scope reads through the real HTTP handler', async () => {
    const { runtime, apiKeyAuth, db } = buildRuntime();
    await runtime.syncSchema();
    await db.create('articles', { title: 'A', internalNote: 'ops only' });

    const { secret } = await apiKeyAuth.createApiKey({ name: 'reader', scopes: ['articles:read'] });
    const context = requestFor('https://forge.test/api/articles', secret);
    context.params = { collection: 'articles' };

    const response = await handleList(context, { runtime });
    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    expect(body.data).toHaveLength(1);
  });

  it('boolean collection access: a valid machine principal missing the scope is 403, not 401', async () => {
    const { runtime, apiKeyAuth } = buildRuntime();
    await runtime.syncSchema();

    const { secret } = await apiKeyAuth.createApiKey({ name: 'no-scope-bot' });
    const context = requestFor('https://forge.test/api/articles', secret);
    context.params = { collection: 'articles' };

    const response = await handleList(context, { runtime });
    expect(response.status).toBe(403);
  });

  it('field-level access: a field hidden from all principals is stripped from the machine-authenticated response', async () => {
    const { runtime, apiKeyAuth, db } = buildRuntime();
    await runtime.syncSchema();
    await db.create('articles', { title: 'A', internalNote: 'secret ops note' });

    const { secret } = await apiKeyAuth.createApiKey({ name: 'reader', scopes: ['articles:read'] });
    const context = requestFor('https://forge.test/api/articles', secret);
    context.params = { collection: 'articles' };

    const response = await handleList(context, { runtime });
    const body = await jsonBody(response);
    expect(body.data[0]?.internalNote).toBeUndefined();
    expect(body.data[0]?.title).toBe('A');
  });

  it('row-level access: a machine principal only reads documents matching its metadata', async () => {
    const tenantArticles = defineCollection({
      slug: 'tenant_articles',
      access: {
        read: ({ user }) => (user ? { tenant: user.metadata?.tenantId } : false)
      },
      fields: {
        title: defineField.text({ required: true }),
        tenant: defineField.text({ required: true })
      }
    });

    const db = new InMemoryDatabaseAdapter();
    const apiKeyAuth = new ApiKeyAuthAdapter();
    const auth = new CompositeAuthAdapter([apiKeyAuth]);
    const runtime = new ForgeCmsRuntime({
      collections: [tenantArticles],
      adapters: { database: db, auth, storage: new InMemoryStorageAdapter() },
      env: { apiKeyDatabase: db }
    });
    runtime.init();
    await runtime.syncSchema();

    await db.create('tenant_articles', { title: 'Mine', tenant: 'acme' });
    await db.create('tenant_articles', { title: 'Theirs', tenant: 'other-co' });

    const { secret } = await apiKeyAuth.createApiKey({
      name: 'acme-reader',
      metadata: { tenantId: 'acme' }
    });
    const context = requestFor('https://forge.test/api/tenant_articles', secret);
    context.params = { collection: 'tenant_articles' };

    const response = await handleList(context, { runtime });
    const body = await jsonBody(response);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.title).toBe('Mine');
  });

  it('human auth continues to work unaffected, through the same composite adapter and HTTP pipeline', async () => {
    const articles = defineCollection({
      slug: 'articles',
      access: { read: ({ user }) => hasScope(user, 'articles:read') },
      fields: { title: defineField.text({ required: true }) }
    });

    const db = new InMemoryDatabaseAdapter();
    const userAuth = new InMemoryAuthAdapter();
    const composite = new CompositeAuthAdapter([userAuth, new ApiKeyAuthAdapter()]);
    const humanRuntime = new ForgeCmsRuntime({
      collections: [articles],
      adapters: { database: db, auth: composite, storage: new InMemoryStorageAdapter() },
      env: { apiKeyDatabase: db }
    });
    humanRuntime.init();
    await humanRuntime.syncSchema();
    await db.create('articles', { title: 'A' });

    userAuth.registerSession('human-token', {
      user: { id: 'human-1', email: 'editor@example.com', scopes: ['articles:read'] }
    });

    const context = requestFor('https://forge.test/api/articles', 'human-token');
    context.params = { collection: 'articles' };

    const response = await handleList(context, { runtime: humanRuntime });
    expect(response.status).toBe(200);
  });
});
