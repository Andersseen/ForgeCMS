import { describe, expect, it, beforeEach } from 'vitest';
import { defineField, defineCollection } from '@forge-cms/core';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from './runtime.js';
import {
  findRelationFields,
  findReferencingDocuments,
  checkDeleteRestrictions,
  handleSetNullOnDelete,
  findOrphanedDocuments
} from './relation-integrity.js';

function createTestRuntime() {
  const authors = defineCollection({
    slug: 'authors',
    fields: {
      name: defineField.text({ required: true })
    }
  });

  const posts = defineCollection({
    slug: 'posts',
    fields: {
      title: defineField.text({ required: true }),
      author: defineField.relation({ collection: 'authors', onDelete: 'restrict' }),
      coauthor: defineField.relation({ collection: 'authors', onDelete: 'set-null' })
    }
  });

  const comments = defineCollection({
    slug: 'comments',
    fields: {
      text: defineField.text({ required: true }),
      post: defineField.relation({ collection: 'posts', onDelete: 'cascade' })
    }
  });

  const auth = new InMemoryAuthAdapter();
  auth.registerSession('test-token', {
    user: { id: 'user-1', email: 'test@example.com', roles: ['admin'] }
  });

  return new ForgeCmsRuntime({
    collections: [authors, posts, comments],
    adapters: {
      database: new InMemoryDatabaseAdapter(),
      auth,
      storage: new InMemoryStorageAdapter()
    }
  });
}

describe('Relation integrity utilities', () => {
  let runtime: ForgeCmsRuntime;

  beforeEach(async () => {
    runtime = createTestRuntime();
    runtime.init();
    await runtime.syncSchema();
  });

  describe('findRelationFields', () => {
    it('finds relation fields referencing a collection', () => {
      const posts = runtime.getCollection('posts')!;
      const relations = findRelationFields(posts, 'authors');

      expect(relations).toHaveLength(2);
      expect(relations[0]!.fieldName).toBe('author');
      expect(relations[1]!.fieldName).toBe('coauthor');
    });

    it('returns empty array when no relations found', () => {
      const authors = runtime.getCollection('authors')!;
      const relations = findRelationFields(authors, 'posts');

      expect(relations).toHaveLength(0);
    });
  });

  describe('findReferencingDocuments', () => {
    it('finds documents with single relation', async () => {
      const author = await runtime.create({
        collection: 'authors',
        data: { name: 'John' }
      });

      await runtime.create({
        collection: 'posts',
        data: { title: 'Post 1', author: author.id }
      });

      await runtime.create({
        collection: 'posts',
        data: { title: 'Post 2', author: author.id }
      });

      const posts = runtime.getCollection('posts')!;
      const referencing = await findReferencingDocuments(
        runtime,
        posts,
        'author',
        author.id as string,
        false
      );

      expect(referencing).toHaveLength(2);
    });

    it('returns empty array when no references found', async () => {
      const author = await runtime.create({
        collection: 'authors',
        data: { name: 'John' }
      });

      const posts = runtime.getCollection('posts')!;
      const referencing = await findReferencingDocuments(
        runtime,
        posts,
        'author',
        author.id as string,
        false
      );

      expect(referencing).toHaveLength(0);
    });
  });

  describe('checkDeleteRestrictions', () => {
    it('allows deletion when no restrictions', async () => {
      const author = await runtime.create({
        collection: 'authors',
        data: { name: 'John' }
      });

      await expect(
        checkDeleteRestrictions(runtime, runtime.getCollection('authors')!, author.id as string)
      ).resolves.not.toThrow();
    });

    it('throws when restricted relation exists', async () => {
      const author = await runtime.create({
        collection: 'authors',
        data: { name: 'John' }
      });

      await runtime.create({
        collection: 'posts',
        data: { title: 'Post 1', author: author.id }
      });

      await expect(
        checkDeleteRestrictions(runtime, runtime.getCollection('authors')!, author.id as string)
      ).rejects.toThrow(/referenced by 1 document/);
    });
  });

  describe('handleSetNullOnDelete', () => {
    it('sets relation to null when referenced document is deleted', async () => {
      const author = await runtime.create({
        collection: 'authors',
        data: { name: 'John' }
      });

      const post = await runtime.create({
        collection: 'posts',
        data: { title: 'Post 1', coauthor: author.id }
      });

      await handleSetNullOnDelete(runtime, runtime.getCollection('authors')!, author.id as string);

      const updatedPost = await runtime.findByID({
        collection: 'posts',
        id: post.id as string
      });

      expect(updatedPost.coauthor).toBeNull();
    });
  });
});

describe('Relation integrity integration', () => {
  let runtime: ForgeCmsRuntime;

  beforeEach(async () => {
    runtime = createTestRuntime();
    runtime.init();
    await runtime.syncSchema();
  });

  it('prevents deletion when restrict is set', async () => {
    const author = await runtime.create({
      collection: 'authors',
      data: { name: 'John' }
    });

    await runtime.create({
      collection: 'posts',
      data: { title: 'Post 1', author: author.id }
    });

    await expect(
      runtime.delete({
        collection: 'authors',
        id: author.id as string
      })
    ).rejects.toThrow(/referenced by 1 document/);
  });

  it('allows deletion when no restrictions', async () => {
    const author = await runtime.create({
      collection: 'authors',
      data: { name: 'John' }
    });

    await expect(
      runtime.delete({
        collection: 'authors',
        id: author.id as string
      })
    ).resolves.toBeTruthy();
  });

  it('sets relation to null with set-null', async () => {
    const author = await runtime.create({
      collection: 'authors',
      data: { name: 'John' }
    });

    const post = await runtime.create({
      collection: 'posts',
      data: { title: 'Post 1', coauthor: author.id }
    });

    // Delete author - coauthor should be set to null
    await runtime.delete({
      collection: 'authors',
      id: author.id as string
    });

    const updatedPost = await runtime.findByID({
      collection: 'posts',
      id: post.id as string
    });

    expect(updatedPost.coauthor).toBeNull();
  });

  it('cascades delete to related documents', async () => {
    const author = await runtime.create({
      collection: 'authors',
      data: { name: 'John' }
    });

    const post = await runtime.create({
      collection: 'posts',
      data: { title: 'Post 1', author: author.id }
    });

    await runtime.create({
      collection: 'comments',
      data: { text: 'Comment 1', post: post.id }
    });

    await runtime.create({
      collection: 'comments',
      data: { text: 'Comment 2', post: post.id }
    });

    // Delete post - comments should be deleted
    await runtime.delete({
      collection: 'posts',
      id: post.id as string
    });

    const comments = await runtime.find({ collection: 'comments' });
    expect(comments.docs).toHaveLength(0);
  });

  it('finds orphaned documents', async () => {
    const author = await runtime.create({
      collection: 'authors',
      data: { name: 'John' }
    });

    const post = await runtime.create({
      collection: 'posts',
      data: { title: 'Post 1', author: author.id }
    });

    // Manually delete author to create orphan
    await runtime.adapters.database.delete('authors', author.id as string);

    const posts = runtime.getCollection('posts')!;
    const orphans = await findOrphanedDocuments(runtime, posts);

    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.document.id).toBe(post.id);
    expect(orphans[0]!.fieldName).toBe('author');
    expect(orphans[0]!.missingId).toBe(author.id);
  });
});
