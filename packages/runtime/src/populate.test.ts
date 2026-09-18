import { describe, expect, it, beforeEach } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from './runtime.js';
import { populateRecord, populateRecords } from './populate.js';

function createRuntime() {
  const users = defineCollection({
    slug: 'users',
    fields: { name: defineField.text({ required: true }) }
  });
  const tags = defineCollection({
    slug: 'tags',
    fields: { label: defineField.text({ required: true }) }
  });
  const posts = defineCollection({
    slug: 'posts',
    fields: {
      title: defineField.text({ required: true }),
      author: defineField.relation({ collection: 'users' }),
      tags: defineField.relation({ collection: 'tags', many: true })
    }
  });

  const runtime = new ForgeCmsRuntime({
    collections: [users, tags, posts],
    adapters: {
      database: new InMemoryDatabaseAdapter(),
      auth: new InMemoryAuthAdapter(),
      storage: new InMemoryStorageAdapter()
    }
  });
  runtime.init();
  return { runtime, posts };
}

describe('populateRecords', () => {
  let ctx: ReturnType<typeof createRuntime>;

  beforeEach(() => {
    ctx = createRuntime();
  });

  it('populates a single relation', async () => {
    const author = await ctx.runtime.adapters.database.create('users', { name: 'Ada' });
    const post = await ctx.runtime.adapters.database.create('posts', {
      title: 'Hello',
      author: author.id,
      tags: []
    });

    const [populated] = await populateRecords([post], ctx.posts, ctx.runtime);
    expect(populated?.author).toEqual(expect.objectContaining({ id: author.id, name: 'Ada' }));
  });

  it('populates a many relation', async () => {
    const t1 = await ctx.runtime.adapters.database.create('tags', { label: 'a' });
    const t2 = await ctx.runtime.adapters.database.create('tags', { label: 'b' });
    const post = await ctx.runtime.adapters.database.create('posts', {
      title: 'Hello',
      tags: [t1.id, t2.id]
    });

    const [populated] = await populateRecords([post], ctx.posts, ctx.runtime);
    expect(populated?.tags).toEqual([
      expect.objectContaining({ id: t1.id, label: 'a' }),
      expect.objectContaining({ id: t2.id, label: 'b' })
    ]);
  });

  it('turns a dangling single relation into null', async () => {
    const post = await ctx.runtime.adapters.database.create('posts', {
      title: 'Hello',
      author: 'nonexistent-id'
    });

    const [populated] = await populateRecords([post], ctx.posts, ctx.runtime);
    expect(populated?.author).toBeNull();
  });

  it('drops dangling entries from a many relation instead of nulling them', async () => {
    const t1 = await ctx.runtime.adapters.database.create('tags', { label: 'a' });
    const post = await ctx.runtime.adapters.database.create('posts', {
      title: 'Hello',
      tags: [t1.id, 'nonexistent-id']
    });

    const [populated] = await populateRecords([post], ctx.posts, ctx.runtime);
    expect(populated?.tags).toEqual([expect.objectContaining({ id: t1.id, label: 'a' })]);
  });

  it('batches lookups: one findMany call per relation field regardless of record count', async () => {
    const author = await ctx.runtime.adapters.database.create('users', { name: 'Ada' });
    const post1 = await ctx.runtime.adapters.database.create('posts', {
      title: 'One',
      author: author.id
    });
    const post2 = await ctx.runtime.adapters.database.create('posts', {
      title: 'Two',
      author: author.id
    });

    let findManyCalls = 0;
    const originalFindMany = ctx.runtime.adapters.database.findMany.bind(
      ctx.runtime.adapters.database
    );
    ctx.runtime.adapters.database.findMany = (opts) => {
      findManyCalls++;
      return originalFindMany(opts);
    };

    await populateRecords([post1, post2], ctx.posts, ctx.runtime);
    // two relation fields (author, tags) => at most two findMany calls, not one per record
    expect(findManyCalls).toBeLessThanOrEqual(2);
  });

  it('is a no-op for collections with no relation fields', async () => {
    const record = await ctx.runtime.adapters.database.create('users', { name: 'Ada' });
    const users = ctx.runtime.getCollection('users')!;
    const [populated] = await populateRecords([record], users, ctx.runtime);
    expect(populated).toEqual(record);
  });

  it('populateRecord populates a single record', async () => {
    const author = await ctx.runtime.adapters.database.create('users', { name: 'Ada' });
    const post = await ctx.runtime.adapters.database.create('posts', {
      title: 'Hello',
      author: author.id
    });

    const populated = await populateRecord(post, ctx.posts, ctx.runtime);
    expect(populated.author).toEqual(expect.objectContaining({ name: 'Ada' }));
  });

  // Real bug, found building spec 055's external-consumer fixture (its `posts.author -> users`
  // relation is exactly this shape): populate always embedded the related document's raw row, with
  // no regard for that document's *own* collection's field-level `access.read` rules — leaking a
  // field like `passwordHash` (access.read: []) into any populated response, including anonymous
  // ones, the moment a relation pointed at a `defineUsersCollection()`/`withAuthFields()` collection.
  describe('field-level access on the populated document (spec 055 fix)', () => {
    function createRuntimeWithSecretField() {
      const users = defineCollection({
        slug: 'users',
        fields: {
          name: defineField.text({ required: true }),
          secret: defineField.text({ access: { read: [] } })
        }
      });
      const posts = defineCollection({
        slug: 'posts',
        fields: {
          title: defineField.text({ required: true }),
          author: defineField.relation({ collection: 'users' })
        }
      });
      const runtime = new ForgeCmsRuntime({
        collections: [users, posts],
        adapters: {
          database: new InMemoryDatabaseAdapter(),
          auth: new InMemoryAuthAdapter(),
          storage: new InMemoryStorageAdapter()
        }
      });
      runtime.init();
      return { runtime, posts };
    }

    it('strips an unreadable field from the populated document when overrideAccess is false', async () => {
      const { runtime, posts } = createRuntimeWithSecretField();
      const author = await runtime.adapters.database.create('users', {
        name: 'Ada',
        secret: 'do-not-leak-me'
      });
      const post = await runtime.adapters.database.create('posts', {
        title: 'Hello',
        author: author.id
      });

      const [populated] = await populateRecords([post], posts, runtime, {
        user: null,
        overrideAccess: false
      });
      const populatedAuthor = populated?.author as Record<string, unknown>;
      expect(populatedAuthor.name).toBe('Ada');
      expect(populatedAuthor).not.toHaveProperty('secret');
    });

    it('keeps the unreadable field for a trusted (default overrideAccess) call', async () => {
      const { runtime, posts } = createRuntimeWithSecretField();
      const author = await runtime.adapters.database.create('users', {
        name: 'Ada',
        secret: 'visible-to-trusted-server-code'
      });
      const post = await runtime.adapters.database.create('posts', {
        title: 'Hello',
        author: author.id
      });

      const [populated] = await populateRecords([post], posts, runtime);
      const populatedAuthor = populated?.author as Record<string, unknown>;
      expect(populatedAuthor.secret).toBe('visible-to-trusted-server-code');
    });
  });

  // Spec 058 §4: a readable parent must not automatically grant visibility into the target
  // collection. Field-level projection (above) is necessary but not sufficient.
  describe('target collection read/row/draft visibility (spec 058)', () => {
    function createRuntimeWithPrivateTarget() {
      const authors = defineCollection({
        slug: 'authors',
        drafts: true,
        access: {
          // Row-level: only the author (matched by `ownerId`) may read their own row.
          read: ({ user }) => (user ? { ownerId: user.id } : false)
        },
        fields: {
          name: defineField.text({ required: true }),
          ownerId: defineField.text()
        }
      });
      const media = defineCollection({
        slug: 'media',
        upload: true,
        access: { read: () => false },
        fields: {
          filename: defineField.text(),
          url: defineField.text()
        }
      });
      const posts = defineCollection({
        slug: 'posts',
        fields: {
          title: defineField.text({ required: true }),
          author: defineField.relation({ collection: 'authors' }),
          cover: defineField.upload({ collection: 'media' })
        }
      });

      const runtime = new ForgeCmsRuntime({
        collections: [authors, media, posts],
        adapters: {
          database: new InMemoryDatabaseAdapter(),
          auth: new InMemoryAuthAdapter(),
          storage: new InMemoryStorageAdapter()
        }
      });
      runtime.init();
      return { runtime, posts };
    }

    it('hides a row-restricted relation target from an anonymous caller (null, not an error)', async () => {
      const { runtime, posts } = createRuntimeWithPrivateTarget();
      const author = await runtime.adapters.database.create('authors', {
        name: 'Ada',
        ownerId: 'owner-1'
      });
      const post = await runtime.adapters.database.create('posts', {
        title: 'Hi',
        author: author.id
      });

      const [populated] = await populateRecords([post], posts, runtime, {
        user: null,
        overrideAccess: false
      });
      expect(populated?.author).toBeNull();
    });

    it('reveals a row-restricted relation target to the authenticated owner', async () => {
      const { runtime, posts } = createRuntimeWithPrivateTarget();
      const author = await runtime.adapters.database.create('authors', {
        name: 'Ada',
        ownerId: 'owner-1'
      });
      const post = await runtime.adapters.database.create('posts', {
        title: 'Hi',
        author: author.id
      });

      const [populated] = await populateRecords([post], posts, runtime, {
        user: { id: 'owner-1', email: 'a@example.com' },
        overrideAccess: false
      });
      expect((populated?.author as Record<string, unknown>)?.name).toBe('Ada');
    });

    it('does not reveal a row-restricted target to a *different* authenticated user', async () => {
      const { runtime, posts } = createRuntimeWithPrivateTarget();
      const author = await runtime.adapters.database.create('authors', {
        name: 'Ada',
        ownerId: 'owner-1'
      });
      const post = await runtime.adapters.database.create('posts', {
        title: 'Hi',
        author: author.id
      });

      const [populated] = await populateRecords([post], posts, runtime, {
        user: { id: 'someone-else', email: 'b@example.com' },
        overrideAccess: false
      });
      expect(populated?.author).toBeNull();
    });

    it('hides a draft target from an anonymous caller and reveals it to an authenticated one', async () => {
      const { runtime, posts } = createRuntimeWithPrivateTarget();
      const author = await runtime.adapters.database.create('authors', {
        name: 'Ada',
        ownerId: 'owner-1',
        _status: 'draft'
      });
      const post = await runtime.adapters.database.create('posts', {
        title: 'Hi',
        author: author.id
      });

      const anon = await populateRecords([post], posts, runtime, {
        user: null,
        overrideAccess: false
      });
      expect(anon[0]?.author).toBeNull();

      const owner = await populateRecords([post], posts, runtime, {
        user: { id: 'owner-1', email: 'a@example.com' },
        overrideAccess: false
      });
      expect((owner[0]?.author as Record<string, unknown>)?.name).toBe('Ada');
    });

    it('hides an unreadable upload relation target the same way as a relation target', async () => {
      const { runtime, posts } = createRuntimeWithPrivateTarget();
      const file = await runtime.adapters.database.create('media', {
        filename: 'photo.jpg',
        url: '/api/media/media/photo.jpg'
      });
      const post = await runtime.adapters.database.create('posts', { title: 'Hi', cover: file.id });

      const [populated] = await populateRecords([post], posts, runtime, {
        user: { id: 'owner-1', email: 'a@example.com' },
        overrideAccess: false
      });
      expect(populated?.cover).toBeNull();
    });

    it('trusted (overrideAccess: true) calls still see private/draft targets, unaffected', async () => {
      const { runtime, posts } = createRuntimeWithPrivateTarget();
      const author = await runtime.adapters.database.create('authors', {
        name: 'Ada',
        ownerId: 'owner-1',
        _status: 'draft'
      });
      const post = await runtime.adapters.database.create('posts', {
        title: 'Hi',
        author: author.id
      });

      const [populated] = await populateRecords([post], posts, runtime);
      expect((populated?.author as Record<string, unknown>)?.name).toBe('Ada');
    });

    it('does not reveal whether a target is missing versus inaccessible (identical null shape)', async () => {
      const { runtime, posts } = createRuntimeWithPrivateTarget();
      const author = await runtime.adapters.database.create('authors', {
        name: 'Ada',
        ownerId: 'owner-1'
      });
      const dangling = await runtime.adapters.database.create('posts', {
        title: 'Dangling',
        author: 'does-not-exist'
      });
      const inaccessible = await runtime.adapters.database.create('posts', {
        title: 'Inaccessible',
        author: author.id
      });

      const results = await populateRecords([dangling, inaccessible], posts, runtime, {
        user: null,
        overrideAccess: false
      });
      expect(results[0]?.author).toBeNull();
      expect(results[1]?.author).toBeNull();
    });
  });
});
