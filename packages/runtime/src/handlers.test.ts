import { describe, expect, it, beforeEach } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { InMemoryAuthAdapter, type AuthUser } from '@forge-cms/auth';
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

function createTestRuntimeWithUser(user: AuthUser, token = 'role-token') {
  const posts = defineCollection({
    slug: 'posts',
    fields: {
      title: defineField.text({ required: true }),
      published: defineField.boolean(),
      views: defineField.number()
    }
  });

  const auth = new InMemoryAuthAdapter();
  auth.registerSession(token, { user });

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

    it('coerces a number filter to match numeric field values', async () => {
      await runtime.adapters.database.create('posts', { title: 'Popular', views: 99 });
      await runtime.adapters.database.create('posts', { title: 'Quiet', views: 1 });

      const context = createTestContext('GET', 'https://forge.test/api/posts?views=99');
      context.params = { collection: 'posts' };

      const response = await handleList(context, { runtime });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].title).toBe('Popular');
    });

    it('coerces a boolean filter to match boolean field values', async () => {
      await runtime.adapters.database.create('posts', { title: 'Live', published: true });
      await runtime.adapters.database.create('posts', { title: 'Draft', published: false });

      const context = createTestContext('GET', 'https://forge.test/api/posts?published=true');
      context.params = { collection: 'posts' };

      const response = await handleList(context, { runtime });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].title).toBe('Live');
    });

    it('returns 400 for an invalid number filter', async () => {
      const context = createTestContext('GET', 'https://forge.test/api/posts?views=abc');
      context.params = { collection: 'posts' };

      const response = await handleList(context, { runtime });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('views');
    });

    it('returns 400 for an invalid boolean filter', async () => {
      const context = createTestContext('GET', 'https://forge.test/api/posts?published=maybe');
      context.params = { collection: 'posts' };

      const response = await handleList(context, { runtime });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('published');
    });

    it('passes through query params that are not field names unchanged', async () => {
      await runtime.adapters.database.create('posts', { title: 'Hello' });

      const context = createTestContext('GET', 'https://forge.test/api/posts?unknownParam=1');
      context.params = { collection: 'posts' };

      const response = await handleList(context, { runtime });
      expect(response.status).toBe(200);
    });

    it('filters with the gt bracket operator', async () => {
      await runtime.adapters.database.create('posts', { title: 'Popular', views: 99 });
      await runtime.adapters.database.create('posts', { title: 'Quiet', views: 1 });

      const context = createTestContext('GET', 'https://forge.test/api/posts?views[gt]=10');
      context.params = { collection: 'posts' };

      const response = await handleList(context, { runtime });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].title).toBe('Popular');
    });

    it('filters with the in bracket operator, splitting on commas', async () => {
      await runtime.adapters.database.create('posts', { id: 'a', title: 'A' });
      await runtime.adapters.database.create('posts', { id: 'b', title: 'B' });
      await runtime.adapters.database.create('posts', { id: 'c', title: 'C' });

      const context = createTestContext('GET', 'https://forge.test/api/posts?id[in]=a,c');
      context.params = { collection: 'posts' };

      const response = await handleList(context, { runtime });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.map((r: { id: string }) => r.id).sort()).toEqual(['a', 'c']);
    });

    it('returns 400 for an unknown operator', async () => {
      const context = createTestContext('GET', 'https://forge.test/api/posts?views[bogus]=1');
      context.params = { collection: 'posts' };

      const response = await handleList(context, { runtime });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('views[bogus]');
    });

    it('sorts by a field in descending order', async () => {
      await runtime.adapters.database.create('posts', { title: 'Low', views: 1 });
      await runtime.adapters.database.create('posts', { title: 'High', views: 100 });

      const context = createTestContext(
        'GET',
        'https://forge.test/api/posts?sort=views&order=desc'
      );
      context.params = { collection: 'posts' };

      const response = await handleList(context, { runtime });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data[0].title).toBe('High');
      expect(body.data[1].title).toBe('Low');
    });

    it('returns 400 for an unknown sort field', async () => {
      const context = createTestContext('GET', 'https://forge.test/api/posts?sort=nonexistent');
      context.params = { collection: 'posts' };

      const response = await handleList(context, { runtime });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('nonexistent');
    });

    it('returns 400 for an invalid sort order', async () => {
      const context = createTestContext(
        'GET',
        'https://forge.test/api/posts?sort=views&order=sideways'
      );
      context.params = { collection: 'posts' };

      const response = await handleList(context, { runtime });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('sideways');
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

    it('allows partial updates without resending required fields', async () => {
      const created = await runtime.adapters.database.create('posts', { title: 'Old', views: 5 });

      const context = createTestContext('PUT', `https://forge.test/api/posts/${created.id}`, {
        views: 10
      });
      context.params = { collection: 'posts', id: created.id as string };

      const response = await handleUpdate(context, { runtime });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.title).toBe('Old');
      expect(body.data.views).toBe(10);
    });

    it('returns 404 for a missing record', async () => {
      const context = createTestContext('PUT', 'https://forge.test/api/posts/unknown', {
        views: 10
      });
      context.params = { collection: 'posts', id: 'unknown' };

      const response = await handleUpdate(context, { runtime });
      expect(response.status).toBe(404);
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

      const context = createTestContext(
        'GET',
        'https://forge.test/api/posts',
        undefined,
        'test-token'
      );
      context.params = { collection: 'posts' };

      const response = await handleList(context, { runtime, requireAuth: true });
      expect(response.status).toBe(200);
    });
  });

  describe('role-based access control', () => {
    it('allows admins and editors to create documents', async () => {
      for (const role of ['admin', 'editor'] as const) {
        const roleRuntime = createTestRuntimeWithUser({ id: role, role });
        roleRuntime.init();

        const context = createTestContext(
          'POST',
          'https://forge.test/api/posts',
          { title: `${role} post` },
          'role-token'
        );
        context.params = { collection: 'posts' };

        const response = await handleCreate(context, {
          runtime: roleRuntime,
          allowedRoles: ['admin', 'editor']
        });
        expect(response.status).toBe(201);
      }
    });

    it('forbids viewers from creating documents', async () => {
      const viewerRuntime = createTestRuntimeWithUser({ id: 'viewer', role: 'viewer' });
      viewerRuntime.init();

      const context = createTestContext(
        'POST',
        'https://forge.test/api/posts',
        { title: 'Viewer post' },
        'role-token'
      );
      context.params = { collection: 'posts' };

      const response = await handleCreate(context, {
        runtime: viewerRuntime,
        allowedRoles: ['admin', 'editor']
      });
      expect(response.status).toBe(403);
    });

    it('requires authentication when allowedRoles is set', async () => {
      const context = createTestContext('POST', 'https://forge.test/api/posts', {
        title: 'Anonymous post'
      });
      context.params = { collection: 'posts' };

      const anonymousRuntime = createTestRuntimeWithUser({ id: 'admin', role: 'admin' });
      anonymousRuntime.init();

      const response = await handleCreate(context, {
        runtime: anonymousRuntime,
        allowedRoles: ['admin', 'editor']
      });
      expect(response.status).toBe(401);
    });

    it('allows admins to update documents', async () => {
      const adminRuntime = createTestRuntimeWithUser({ id: 'admin', role: 'admin' });
      adminRuntime.init();
      const created = await adminRuntime.adapters.database.create('posts', { title: 'Old' });

      const context = createTestContext(
        'PUT',
        `https://forge.test/api/posts/${created.id}`,
        { title: 'Updated' },
        'role-token'
      );
      context.params = { collection: 'posts', id: created.id as string };

      const response = await handleUpdate(context, {
        runtime: adminRuntime,
        allowedRoles: ['admin', 'editor']
      });
      expect(response.status).toBe(200);
    });

    it('forbids viewers from updating documents', async () => {
      const viewerRuntime = createTestRuntimeWithUser({ id: 'viewer', role: 'viewer' });
      viewerRuntime.init();
      const created = await viewerRuntime.adapters.database.create('posts', { title: 'Old' });

      const context = createTestContext(
        'PUT',
        `https://forge.test/api/posts/${created.id}`,
        { title: 'Updated' },
        'role-token'
      );
      context.params = { collection: 'posts', id: created.id as string };

      const response = await handleUpdate(context, {
        runtime: viewerRuntime,
        allowedRoles: ['admin', 'editor']
      });
      expect(response.status).toBe(403);
    });

    it('forbids viewers from deleting documents', async () => {
      const viewerRuntime = createTestRuntimeWithUser({ id: 'viewer', role: 'viewer' });
      viewerRuntime.init();
      const created = await viewerRuntime.adapters.database.create('posts', { title: 'To Delete' });

      const context = createTestContext(
        'DELETE',
        `https://forge.test/api/posts/${created.id}`,
        undefined,
        'role-token'
      );
      context.params = { collection: 'posts', id: created.id as string };

      const response = await handleDelete(context, {
        runtime: viewerRuntime,
        allowedRoles: ['admin', 'editor']
      });
      expect(response.status).toBe(403);
    });
  });

  describe('depth / relation population', () => {
    function createRuntimeWithRelations() {
      const users = defineCollection({
        slug: 'users',
        fields: { name: defineField.text({ required: true }) }
      });
      const articles = defineCollection({
        slug: 'articles',
        fields: {
          title: defineField.text({ required: true }),
          author: defineField.relation({ collection: 'users' })
        }
      });

      const relationRuntime = new ForgeCmsRuntime({
        collections: [users, articles],
        adapters: {
          database: new InMemoryDatabaseAdapter(),
          auth: new InMemoryAuthAdapter(),
          storage: new InMemoryStorageAdapter()
        }
      });
      relationRuntime.init();
      return relationRuntime;
    }

    it('populates relations on handleList with depth=1', async () => {
      const relationRuntime = createRuntimeWithRelations();
      const author = await relationRuntime.adapters.database.create('users', { name: 'Ada' });
      await relationRuntime.adapters.database.create('articles', {
        title: 'Hello',
        author: author.id
      });

      const context = createTestContext('GET', 'https://forge.test/api/articles?depth=1');
      context.params = { collection: 'articles' };

      const response = await handleList(context, { runtime: relationRuntime });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data[0].author).toEqual(expect.objectContaining({ name: 'Ada' }));
    });

    it('populates relations on handleRead with depth=1', async () => {
      const relationRuntime = createRuntimeWithRelations();
      const author = await relationRuntime.adapters.database.create('users', { name: 'Ada' });
      const article = await relationRuntime.adapters.database.create('articles', {
        title: 'Hello',
        author: author.id
      });

      const context = createTestContext(
        'GET',
        `https://forge.test/api/articles/${article.id}?depth=1`
      );
      context.params = { collection: 'articles', id: article.id as string };

      const response = await handleRead(context, { runtime: relationRuntime });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.author).toEqual(expect.objectContaining({ name: 'Ada' }));
    });

    it('leaves relations as bare ids without depth', async () => {
      const relationRuntime = createRuntimeWithRelations();
      const author = await relationRuntime.adapters.database.create('users', { name: 'Ada' });
      await relationRuntime.adapters.database.create('articles', {
        title: 'Hello',
        author: author.id
      });

      const context = createTestContext('GET', 'https://forge.test/api/articles');
      context.params = { collection: 'articles' };

      const response = await handleList(context, { runtime: relationRuntime });
      const body = await response.json();

      expect(body.data[0].author).toBe(author.id);
    });

    it('returns 400 for an unsupported depth value', async () => {
      const relationRuntime = createRuntimeWithRelations();
      const context = createTestContext('GET', 'https://forge.test/api/articles?depth=2');
      context.params = { collection: 'articles' };

      const response = await handleList(context, { runtime: relationRuntime });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('depth');
    });
  });

  describe('hooks and access control', () => {
    function createRuntimeWithAccess(
      opts: {
        collectionAccess?: { create?: ('admin' | 'editor' | 'viewer')[] };
        beforeChange?: (ctx: {
          data: Record<string, unknown>;
        }) => Record<string, unknown> | Promise<Record<string, unknown>>;
        afterChangeSpy?: (result: Record<string, unknown>) => void;
      } = {}
    ) {
      const articles = defineCollection({
        slug: 'articles',
        fields: {
          title: defineField.text({ required: true }),
          internalNote: defineField.text({ access: { read: ['admin'], write: ['admin'] } })
        },
        ...(opts.collectionAccess && { access: opts.collectionAccess }),
        ...((opts.beforeChange || opts.afterChangeSpy) && {
          hooks: {
            ...(opts.beforeChange && { beforeChange: [opts.beforeChange] }),
            ...(opts.afterChangeSpy && {
              afterChange: [(ctx: { result: Record<string, unknown> }) => opts.afterChangeSpy!(ctx.result)]
            })
          }
        })
      });

      const admin = new InMemoryAuthAdapter();
      admin.registerSession('admin-token', { user: { id: 'admin-1', role: 'admin' } });
      admin.registerSession('editor-token', { user: { id: 'editor-1', role: 'editor' } });
      admin.registerSession('viewer-token', { user: { id: 'viewer-1', role: 'viewer' } });

      const accessRuntime = new ForgeCmsRuntime({
        collections: [articles],
        adapters: {
          database: new InMemoryDatabaseAdapter(),
          auth: admin,
          storage: new InMemoryStorageAdapter()
        }
      });
      accessRuntime.init();
      return accessRuntime;
    }

    it('collection.access.create overrides the route allowedRoles', async () => {
      const accessRuntime = createRuntimeWithAccess({ collectionAccess: { create: ['admin'] } });

      const context = createTestContext(
        'POST',
        'https://forge.test/api/articles',
        { title: 'Hello' },
        'editor-token'
      );
      context.params = { collection: 'articles' };

      // route says admin OR editor may create, but the collection itself narrows to admin-only
      const response = await handleCreate(context, {
        runtime: accessRuntime,
        allowedRoles: ['admin', 'editor']
      });
      expect(response.status).toBe(403);
    });

    it('falls back to the route allowedRoles when collection.access is unset', async () => {
      const accessRuntime = createRuntimeWithAccess();

      const context = createTestContext(
        'POST',
        'https://forge.test/api/articles',
        { title: 'Hello' },
        'editor-token'
      );
      context.params = { collection: 'articles' };

      const response = await handleCreate(context, {
        runtime: accessRuntime,
        allowedRoles: ['admin', 'editor']
      });
      expect(response.status).toBe(201);
    });

    it('strips a field-read-restricted field from list responses for an unauthorized role', async () => {
      const accessRuntime = createRuntimeWithAccess();
      await accessRuntime.adapters.database.create('articles', {
        title: 'Hello',
        internalNote: 'secret'
      });

      const context = createTestContext(
        'GET',
        'https://forge.test/api/articles',
        undefined,
        'viewer-token'
      );
      context.params = { collection: 'articles' };

      const response = await handleList(context, { runtime: accessRuntime, requireAuth: true });
      const body = await response.json();

      expect(body.data[0].title).toBe('Hello');
      expect(body.data[0]).not.toHaveProperty('internalNote');
    });

    it('keeps a field-read-restricted field for an authorized role', async () => {
      const accessRuntime = createRuntimeWithAccess();
      await accessRuntime.adapters.database.create('articles', {
        title: 'Hello',
        internalNote: 'secret'
      });

      const context = createTestContext(
        'GET',
        'https://forge.test/api/articles',
        undefined,
        'admin-token'
      );
      context.params = { collection: 'articles' };

      const response = await handleList(context, { runtime: accessRuntime, requireAuth: true });
      const body = await response.json();

      expect(body.data[0].internalNote).toBe('secret');
    });

    it('rejects writing a field-write-restricted field from an unauthorized role', async () => {
      const accessRuntime = createRuntimeWithAccess();

      const context = createTestContext(
        'POST',
        'https://forge.test/api/articles',
        { title: 'Hello', internalNote: 'secret' },
        'editor-token'
      );
      context.params = { collection: 'articles' };

      const response = await handleCreate(context, { runtime: accessRuntime, requireAuth: true });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toContain('internalNote');
    });

    it('runs a beforeChange hook that mutates data before validation', async () => {
      const accessRuntime = createRuntimeWithAccess({
        beforeChange: (ctx) => ({ ...ctx.data, title: `${ctx.data.title as string} (edited)` })
      });

      const context = createTestContext('POST', 'https://forge.test/api/articles', {
        title: 'Hello'
      });
      context.params = { collection: 'articles' };

      const response = await handleCreate(context, { runtime: accessRuntime });
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.data.title).toBe('Hello (edited)');
    });

    it('returns 400 when a beforeChange hook throws', async () => {
      const accessRuntime = createRuntimeWithAccess({
        beforeChange: () => {
          throw new Error('rejected by hook');
        }
      });

      const context = createTestContext('POST', 'https://forge.test/api/articles', {
        title: 'Hello'
      });
      context.params = { collection: 'articles' };

      const response = await handleCreate(context, { runtime: accessRuntime });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('rejected by hook');
    });

    it('runs an afterChange hook after a successful create', async () => {
      let seenTitle: unknown;
      const accessRuntime = createRuntimeWithAccess({
        afterChangeSpy: (result) => {
          seenTitle = result.title;
        }
      });

      const context = createTestContext('POST', 'https://forge.test/api/articles', {
        title: 'Hello'
      });
      context.params = { collection: 'articles' };

      const response = await handleCreate(context, { runtime: accessRuntime });
      expect(response.status).toBe(201);
      expect(seenTitle).toBe('Hello');
    });
  });

  describe('multipart upload', () => {
    function createMediaRuntime() {
      const media = defineCollection({
        slug: 'media',
        fields: {
          filename: defineField.text({ required: true }),
          url: defineField.text({ required: true }),
          contentType: defineField.text(),
          filesize: defineField.number(),
          alt: defineField.text()
        },
        upload: true
      });

      const mediaRuntime = new ForgeCmsRuntime({
        collections: [media],
        adapters: {
          database: new InMemoryDatabaseAdapter(),
          auth: new InMemoryAuthAdapter(),
          storage: new InMemoryStorageAdapter()
        }
      });
      mediaRuntime.init();
      return mediaRuntime;
    }

    it('stores the file via the storage adapter and creates a record with its metadata', async () => {
      const mediaRuntime = createMediaRuntime();

      const formData = new FormData();
      formData.set('file', new File(['hello world'], 'greeting.txt', { type: 'text/plain' }));
      formData.set('alt', 'A greeting');

      const context = {
        request: new Request('https://forge.test/api/media', { method: 'POST', body: formData }),
        env: {},
        params: { collection: 'media' }
      };

      const response = await handleCreate(context, { runtime: mediaRuntime });
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.data.filename).toBe('greeting.txt');
      expect(body.data.contentType).toBe('text/plain');
      expect(body.data.filesize).toBe(11);
      expect(body.data.alt).toBe('A greeting');
      expect(typeof body.data.url).toBe('string');

      const stored = await mediaRuntime.adapters.storage.list();
      expect(stored).toHaveLength(1);
      expect(new TextDecoder().decode(stored[0]?.body)).toBe('hello world');
    });

    it('returns 400 when the multipart body has no file part', async () => {
      const mediaRuntime = createMediaRuntime();

      const formData = new FormData();
      formData.set('alt', 'No file here');

      const context = {
        request: new Request('https://forge.test/api/media', { method: 'POST', body: formData }),
        env: {},
        params: { collection: 'media' }
      };

      const response = await handleCreate(context, { runtime: mediaRuntime });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('file');
    });

    it('still accepts a plain JSON create on an upload-enabled collection', async () => {
      const mediaRuntime = createMediaRuntime();

      const context = createTestContext('POST', 'https://forge.test/api/media', {
        filename: 'manual.txt',
        url: 'https://example.com/manual.txt'
      });
      context.params = { collection: 'media' };

      const response = await handleCreate(context, { runtime: mediaRuntime });
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.data.filename).toBe('manual.txt');
    });

    it('rejects a multipart body posted to a non-upload collection', async () => {
      // posts (from the outer describe's runtime) has no upload: true, so multipart isn't special-cased
      // for it and falls through to the plain JSON path, which fails to parse a multipart body.
      const formData = new FormData();
      formData.set('file', new File(['x'], 'x.txt'));

      const context = {
        request: new Request('https://forge.test/api/posts', { method: 'POST', body: formData }),
        env: {},
        params: { collection: 'posts' }
      };

      const response = await handleCreate(context, { runtime });
      expect(response.status).toBe(400);
    });
  });

  describe('drafts', () => {
    function createDraftsRuntime() {
      const posts = defineCollection({
        slug: 'posts',
        fields: { title: defineField.text({ required: true }) },
        drafts: true
      });

      const auth = new InMemoryAuthAdapter();
      auth.registerSession('editor-token', { user: { id: 'editor-1', role: 'editor' } });

      const draftsRuntime = new ForgeCmsRuntime({
        collections: [posts],
        adapters: {
          database: new InMemoryDatabaseAdapter(),
          auth,
          storage: new InMemoryStorageAdapter()
        }
      });
      draftsRuntime.init();
      return draftsRuntime;
    }

    it('defaults a new document to draft', async () => {
      const draftsRuntime = createDraftsRuntime();
      const context = createTestContext('POST', 'https://forge.test/api/posts', { title: 'Hello' });
      context.params = { collection: 'posts' };

      const response = await handleCreate(context, { runtime: draftsRuntime });
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.data._status).toBe('draft');
    });

    it('honors an explicit published status on create', async () => {
      const draftsRuntime = createDraftsRuntime();
      const context = createTestContext('POST', 'https://forge.test/api/posts', {
        title: 'Hello',
        _status: 'published'
      });
      context.params = { collection: 'posts' };

      const response = await handleCreate(context, { runtime: draftsRuntime });
      const body = await response.json();
      expect(body.data._status).toBe('published');
    });

    it('rejects an invalid status value on create', async () => {
      const draftsRuntime = createDraftsRuntime();
      const context = createTestContext('POST', 'https://forge.test/api/posts', {
        title: 'Hello',
        _status: 'sideways'
      });
      context.params = { collection: 'posts' };

      const response = await handleCreate(context, { runtime: draftsRuntime });
      expect(response.status).toBe(400);
    });

    it('rejects an invalid status value on update', async () => {
      const draftsRuntime = createDraftsRuntime();
      const created = await draftsRuntime.adapters.database.create('posts', {
        title: 'Hello',
        _status: 'draft'
      });

      const context = createTestContext('PUT', `https://forge.test/api/posts/${created.id}`, {
        _status: 'sideways'
      });
      context.params = { collection: 'posts', id: created.id as string };

      const response = await handleUpdate(context, { runtime: draftsRuntime });
      expect(response.status).toBe(400);
    });

    it('publishing via update is honored', async () => {
      const draftsRuntime = createDraftsRuntime();
      const created = await draftsRuntime.adapters.database.create('posts', {
        title: 'Hello',
        _status: 'draft'
      });

      const context = createTestContext('PUT', `https://forge.test/api/posts/${created.id}`, {
        _status: 'published'
      });
      context.params = { collection: 'posts', id: created.id as string };

      const response = await handleUpdate(context, { runtime: draftsRuntime });
      const body = await response.json();
      expect(body.data._status).toBe('published');
    });

    it('anonymous list only ever sees published documents', async () => {
      const draftsRuntime = createDraftsRuntime();
      await draftsRuntime.adapters.database.create('posts', { title: 'Draft', _status: 'draft' });
      await draftsRuntime.adapters.database.create('posts', { title: 'Live', _status: 'published' });

      const context = createTestContext('GET', 'https://forge.test/api/posts');
      context.params = { collection: 'posts' };

      const response = await handleList(context, { runtime: draftsRuntime });
      const body = await response.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].title).toBe('Live');
    });

    it('anonymous request cannot see drafts even when explicitly asking via ?status=draft', async () => {
      const draftsRuntime = createDraftsRuntime();
      await draftsRuntime.adapters.database.create('posts', { title: 'Draft', _status: 'draft' });

      const context = createTestContext('GET', 'https://forge.test/api/posts?status=draft');
      context.params = { collection: 'posts' };

      const response = await handleList(context, { runtime: draftsRuntime });
      const body = await response.json();
      expect(body.data).toHaveLength(0);
    });

    it('authenticated request can see drafts via ?status=draft', async () => {
      const draftsRuntime = createDraftsRuntime();
      await draftsRuntime.adapters.database.create('posts', { title: 'Draft', _status: 'draft' });
      await draftsRuntime.adapters.database.create('posts', { title: 'Live', _status: 'published' });

      const context = createTestContext(
        'GET',
        'https://forge.test/api/posts?status=draft',
        undefined,
        'editor-token'
      );
      context.params = { collection: 'posts' };

      const response = await handleList(context, { runtime: draftsRuntime, requireAuth: true });
      const body = await response.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].title).toBe('Draft');
    });

    it('authenticated request sees everything via ?status=all', async () => {
      const draftsRuntime = createDraftsRuntime();
      await draftsRuntime.adapters.database.create('posts', { title: 'Draft', _status: 'draft' });
      await draftsRuntime.adapters.database.create('posts', { title: 'Live', _status: 'published' });

      const context = createTestContext(
        'GET',
        'https://forge.test/api/posts?status=all',
        undefined,
        'editor-token'
      );
      context.params = { collection: 'posts' };

      const response = await handleList(context, { runtime: draftsRuntime, requireAuth: true });
      const body = await response.json();
      expect(body.data).toHaveLength(2);
    });

    it('authenticated request without ?status still defaults to published only', async () => {
      const draftsRuntime = createDraftsRuntime();
      await draftsRuntime.adapters.database.create('posts', { title: 'Draft', _status: 'draft' });
      await draftsRuntime.adapters.database.create('posts', { title: 'Live', _status: 'published' });

      const context = createTestContext(
        'GET',
        'https://forge.test/api/posts',
        undefined,
        'editor-token'
      );
      context.params = { collection: 'posts' };

      const response = await handleList(context, { runtime: draftsRuntime, requireAuth: true });
      const body = await response.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].title).toBe('Live');
    });

    it('returns 400 for an invalid status value', async () => {
      const draftsRuntime = createDraftsRuntime();
      const context = createTestContext(
        'GET',
        'https://forge.test/api/posts?status=sideways',
        undefined,
        'editor-token'
      );
      context.params = { collection: 'posts' };

      const response = await handleList(context, { runtime: draftsRuntime, requireAuth: true });
      expect(response.status).toBe(400);
    });

    it('anonymous single-record read of a draft 404s (does not leak existence)', async () => {
      const draftsRuntime = createDraftsRuntime();
      const created = await draftsRuntime.adapters.database.create('posts', {
        title: 'Draft',
        _status: 'draft'
      });

      const context = createTestContext('GET', `https://forge.test/api/posts/${created.id}`);
      context.params = { collection: 'posts', id: created.id as string };

      const response = await handleRead(context, { runtime: draftsRuntime });
      expect(response.status).toBe(404);
    });

    it('authenticated single-record read of a draft succeeds', async () => {
      const draftsRuntime = createDraftsRuntime();
      const created = await draftsRuntime.adapters.database.create('posts', {
        title: 'Draft',
        _status: 'draft'
      });

      const context = createTestContext(
        'GET',
        `https://forge.test/api/posts/${created.id}`,
        undefined,
        'editor-token'
      );
      context.params = { collection: 'posts', id: created.id as string };

      const response = await handleRead(context, { runtime: draftsRuntime, requireAuth: true });
      expect(response.status).toBe(200);
    });

    it('is a complete no-op for a collection without drafts: true', async () => {
      // `runtime` (outer describe) uses a plain `posts` collection with no `drafts` flag.
      const created = await runtime.adapters.database.create('posts', { title: 'Hello' });
      expect(created._status).toBeUndefined();

      const context = createTestContext('GET', 'https://forge.test/api/posts');
      context.params = { collection: 'posts' };
      const response = await handleList(context, { runtime });
      const body = await response.json();
      expect(body.data.some((r: { id: string }) => r.id === created.id)).toBe(true);
    });
  });
});
