import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime, handleList } from './index.js';

function createTestRuntime() {
  const posts = defineCollection({
    slug: 'posts',
    fields: {
      title: defineField.text({ required: true })
    }
  });

  return new ForgeCmsRuntime({
    collections: [posts],
    adapters: {
      database: new InMemoryDatabaseAdapter(),
      auth: new InMemoryAuthAdapter(),
      storage: new InMemoryStorageAdapter()
    }
  });
}

describe('ForgeCmsRuntime', () => {
  it('initialises adapters', () => {
    const runtime = createTestRuntime();
    const result = runtime.init();
    expect(result).toBe(runtime);
  });

  it('syncs schema without errors', async () => {
    const runtime = createTestRuntime();
    runtime.init();
    await expect(runtime.syncSchema()).resolves.toBeUndefined();
  });

  it('calls an auth adapter optional syncSchema() during runtime.syncSchema()', async () => {
    const posts = defineCollection({
      slug: 'posts',
      fields: { title: defineField.text({ required: true }) }
    });

    let called = false;
    const auth = new InMemoryAuthAdapter();
    (auth as InMemoryAuthAdapter & { syncSchema?: () => Promise<void> }).syncSchema = async () => {
      called = true;
    };

    const runtime = new ForgeCmsRuntime({
      collections: [posts],
      adapters: {
        database: new InMemoryDatabaseAdapter(),
        auth,
        storage: new InMemoryStorageAdapter()
      }
    });
    runtime.init();
    await runtime.syncSchema();
    expect(called).toBe(true);
  });

  it('finds a collection by slug', () => {
    const runtime = createTestRuntime();
    const posts = runtime.getCollection('posts');
    expect(posts).toBeTruthy();
    expect(posts?.slug).toBe('posts');
  });

  it('returns undefined for unknown collection', () => {
    const runtime = createTestRuntime();
    expect(runtime.getCollection('nope')).toBeUndefined();
  });

  it('returns all collections', () => {
    const runtime = createTestRuntime();
    expect(runtime.getCollections()).toHaveLength(1);
  });
});

describe('runtime exports', () => {
  it('handleList is a real handler', async () => {
    const runtime = createTestRuntime();
    runtime.init();

    const context = {
      request: new Request('https://forge.test/api/posts'),
      params: { collection: 'posts' },
      env: {}
    };

    const response = await handleList(context, { runtime });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data).toEqual([]);
  });
});
