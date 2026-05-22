import { describe, expect, it, beforeEach } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from './runtime.js';
import { handleList, handleRead, handleCreate, handleUpdate, handleDelete } from './handlers.js';

function createTestContext(
  method: string,
  url: string,
  body?: unknown,
  authToken?: string
): Parameters<typeof handleList>[0] {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authToken) headers['authorization'] = `Bearer ${authToken}`;

  const request = body
    ? new Request(url, { method, headers, body: JSON.stringify(body) })
    : new Request(url, { method, headers });

  return {
    request,
    env: {}
  };
}

function createTestRuntime() {
  const posts = defineCollection({
    slug: 'posts',
    fields: {
      title: defineField.text({ required: true }),
      published: defineField.boolean(),
      views: defineField.number()
    }
  });

  const auth = new InMemoryAuthAdapter();
  auth.registerSession('test-token', {
    user: { id: 'user-1', email: 'test@example.com' }
  });

  return new ForgeCmsRuntime({
    collections: [posts],
    adapters: {
      database: new InMemoryDatabaseAdapter(),
      auth,
      storage: new InMemoryStorageAdapter()
    }
  });
}

describe('CRUD Handlers', () => {
  let runtime: ForgeCmsRuntime;

  beforeEach(() => {
    runtime = createTestRuntime();
    runtime.init();
  });

  describe('handleList', () => {
    it('returns empty list when no records', async () => {
      const context = createTestContext('GET', 'https://forge.test/api/posts');
      context.params = { collection: 'posts' };

      const response = await handleList(context, { runtime });
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.data).toEqual([]);
    });

    it('lists records with pagination', async () => {
      await runtime.adapters.database.create('posts', { title: 'Post 1' });
      await runtime.adapters.database.create('posts', { title: 'Post 2' });

      const context = createTestContext('GET', 'https://forge.test/api/posts?limit=1');
      context.params = { collection: 'posts' };

      const response = await handleList(context, { runtime });
      const body = await response.json();

      expect(body.data).toHaveLength(1);
      expect(body.meta.limit).toBe(1);
    });

    it('filters by query params', async () => {
      await runtime.adapters.database.create('posts', { title: 'Hello' });
      await runtime.adapters.database.create('posts', { title: 'World' });

      const context = createTestContext('GET', 'https://forge.test/api/posts?title=Hello');
      context.params = { collection: 'posts' };

      const response = await handleList(context, { runtime });
      const body = await response.json();

      expect(body.data).toHaveLength(1);
      expect(body.data[0].title).toBe('Hello');
    });

    it('returns 404 for unknown collection', async () => {
      const context = createTestContext('GET', 'https://forge.test/api/unknown');
      context.params = { collection: 'unknown' };

      const response = await handleList(context, { runtime });
      expect(response.status).toBe(404);
    });
  });

  describe('handleRead', () => {
    it('returns a record by id', async () => {
      const created = await runtime.adapters.database.create('posts', { title: 'Test' });

      const context = createTestContext('GET', `https://forge.test/api/posts/${created.id}`);
      context.params = { collection: 'posts', id: created.id as string };

      const response = await handleRead(context, { runtime });
      const body = await response.json();

      expect(body.data.title).toBe('Test');
    });

    it('returns 404 for missing record', async () => {
      const context = createTestContext('GET', 'https://forge.test/api/posts/999');
      context.params = { collection: 'posts', id: '999' };

      const response = await handleRead(context, { runtime });
      expect(response.status).toBe(404);
    });
  });

  describe('handleCreate', () => {
    it('creates a valid record', async () => {
      const context = createTestContext('POST', 'https://forge.test/api/posts', {
        title: 'New Post',
        published: true
      });
      context.params = { collection: 'posts' };

      const response = await handleCreate(context, { runtime });
      expect(response.status).toBe(201);

      const body = await response.json();
      expect(body.data.title).toBe('New Post');
      expect(body.data.id).toBeTruthy();
    });

    it('returns 400 for validation errors', async () => {
      const context = createTestContext('POST', 'https://forge.test/api/posts', {
        // title is required but missing
        published: true
      });
      context.params = { collection: 'posts' };

      const response = await handleCreate(context, { runtime });
      expect(response.status).toBe(400);
    });

    it('returns 400 for invalid json', async () => {
      const context = createTestContext('POST', 'https://forge.test/api/posts');
      context.params = { collection: 'posts' };
      context.request = new Request('https://forge.test/api/posts', {
        method: 'POST',
        body: 'not-json',
        headers: { 'content-type': 'application/json' }
      });

      const response = await handleCreate(context, { runtime });
      expect(response.status).toBe(400);
    });
  });

  describe('handleUpdate', () => {
    it('updates a record', async () => {
      const created = await runtime.adapters.database.create('posts', { title: 'Old' });

      const context = createTestContext('PUT', `https://forge.test/api/posts/${created.id}`, {
        title: 'Updated'
      });
      context.params = { collection: 'posts', id: created.id as string };

      const response = await handleUpdate(context, { runtime });
      const body = await response.json();

      expect(body.data.title).toBe('Updated');
    });
  });

  describe('handleDelete', () => {
    it('deletes a record', async () => {
      const created = await runtime.adapters.database.create('posts', { title: 'To Delete' });

      const context = createTestContext('DELETE', `https://forge.test/api/posts/${created.id}`);
      context.params = { collection: 'posts', id: created.id as string };

      const response = await handleDelete(context, { runtime });
      expect(response.status).toBe(204);

      const found = await runtime.adapters.database.findById('posts', created.id as string);
      expect(found).toBeNull();
    });
  });

  describe('auth protection', () => {
    it('requires auth when configured', async () => {
      const context = createTestContext('GET', 'https://forge.test/api/posts');
      context.params = { collection: 'posts' };

      const response = await handleList(context, { runtime, requireAuth: true });
      expect(response.status).toBe(401);
    });

    it('allows authenticated requests', async () => {
      await runtime.adapters.database.create('posts', { title: 'Post 1' });

      const context = createTestContext('GET', 'https://forge.test/api/posts', undefined, 'test-token');
      context.params = { collection: 'posts' };

      const response = await handleList(context, { runtime, requireAuth: true });
      expect(response.status).toBe(200);
    });
  });
});
