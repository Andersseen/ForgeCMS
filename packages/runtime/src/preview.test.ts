import { describe, expect, it, beforeEach } from 'vitest';
import { defineField, defineCollection } from '@forge-cms/core';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from './runtime.js';

function createTestRuntime() {
  const authors = defineCollection({
    slug: 'authors',
    fields: {
      name: defineField.text({ required: true }),
      email: defineField.email()
    }
  });

  const posts = defineCollection({
    slug: 'posts',
    fields: {
      title: defineField.text({ required: true }),
      slug: defineField.slug({ autoGenerate: true, sourceField: 'title' }),
      body: defineField.text(),
      author: defineField.relation({ collection: 'authors' })
    }
  });

  const auth = new InMemoryAuthAdapter();
  auth.registerSession('test-token', {
    user: { id: 'user-1', email: 'test@example.com', roles: ['admin'] }
  });

  return new ForgeCmsRuntime({
    collections: [authors, posts],
    adapters: {
      database: new InMemoryDatabaseAdapter(),
      auth,
      storage: new InMemoryStorageAdapter()
    }
  });
}

describe('Preview', () => {
  let runtime: ForgeCmsRuntime;

  beforeEach(async () => {
    runtime = createTestRuntime();
    runtime.init();
    await runtime.syncSchema();
  });

  it('previews a new document with provided data', async () => {
    const preview = await runtime.preview({
      collection: 'posts',
      data: { title: 'My New Post', body: 'Content here' }
    });

    expect(preview.title).toBe('My New Post');
    expect(preview.body).toBe('Content here');
    // Should have auto-generated slug
    expect(preview.slug).toBe('my-new-post');
  });

  it('previews an existing document with merged changes', async () => {
    const doc = await runtime.create({
      collection: 'posts',
      data: { title: 'Original Title', body: 'Original body' }
    });

    const preview = await runtime.preview({
      collection: 'posts',
      id: doc.id as string,
      data: { title: 'Updated Title' }
    });

    expect(preview.title).toBe('Updated Title');
    expect(preview.body).toBe('Original body'); // Unchanged
    // Slug is preserved from existing document unless explicitly cleared
    expect(preview.slug).toBe('original-title');
  });

  it('regenerates slug when explicitly cleared in preview', async () => {
    const doc = await runtime.create({
      collection: 'posts',
      data: { title: 'Original Title', body: 'Original body' }
    });

    const preview = await runtime.preview({
      collection: 'posts',
      id: doc.id as string,
      data: { title: 'Updated Title', slug: '' } // Explicitly clear slug
    });

    expect(preview.title).toBe('Updated Title');
    expect(preview.slug).toBe('updated-title'); // Regenerated from new title
  });

  it('populates relations when depth is provided', async () => {
    const author = await runtime.create({
      collection: 'authors',
      data: { name: 'John Doe', email: 'john@example.com' }
    });

    const preview = await runtime.preview({
      collection: 'posts',
      data: { title: 'Post with Author', author: author.id },
      depth: 1
    });

    expect(preview.title).toBe('Post with Author');
    // Author should be populated
    expect(typeof preview.author).toBe('object');
    expect((preview.author as Record<string, unknown>).name).toBe('John Doe');
  });

  it('throws for unknown collection', async () => {
    await expect(
      runtime.preview({
        collection: 'unknown',
        data: { title: 'Test' }
      })
    ).rejects.toThrow("Collection 'unknown' not found");
  });

  it('throws for unknown document id', async () => {
    await expect(
      runtime.preview({
        collection: 'posts',
        id: 'nonexistent-id',
        data: { title: 'Test' }
      })
    ).rejects.toThrow("Document 'nonexistent-id' not found");
  });

  it('applies field defaults in preview', async () => {
    const collectionWithDefaults = defineCollection({
      slug: 'items',
      fields: {
        name: defineField.text({ required: true }),
        status: defineField.text({ defaultValue: 'draft' })
      }
    });

    const runtimeWithDefaults = new ForgeCmsRuntime({
      collections: [collectionWithDefaults],
      adapters: {
        database: new InMemoryDatabaseAdapter(),
        auth: new InMemoryAuthAdapter(),
        storage: new InMemoryStorageAdapter()
      }
    });
    runtimeWithDefaults.init();

    const preview = await runtimeWithDefaults.preview({
      collection: 'items',
      data: { name: 'Test Item' }
    });

    expect(preview.name).toBe('Test Item');
    expect(preview.status).toBe('draft');
  });
});
