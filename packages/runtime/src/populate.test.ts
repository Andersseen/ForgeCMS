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
});
