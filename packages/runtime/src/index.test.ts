import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime, createCrudHandlers } from './index.js';

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

describe('createCrudHandlers', () => {
  it('returns stub handlers', async () => {
    const runtime = createTestRuntime();
    const handlers = createCrudHandlers({ runtime });

    expect(handlers.list).toBeTypeOf('function');
    expect(handlers.read).toBeTypeOf('function');
    expect(handlers.create).toBeTypeOf('function');
    expect(handlers.update).toBeTypeOf('function');
    expect(handlers.delete).toBeTypeOf('function');

    const response = await handlers.list!({
      request: new Request('https://forge.test'),
      env: {}
    });

    expect(response.status).toBe(501);
  });
});
