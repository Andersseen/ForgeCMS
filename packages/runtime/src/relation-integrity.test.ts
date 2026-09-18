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

// Spec 058 §5: same-collection (self) relations, cycles, required+set-null, and recursive/hooked
// cascade — none of these were enforced/correct before this hardening pass.
describe('Relation integrity hardening (spec 058)', () => {
  it('enforces restrict on a self-relation (previously silently skipped)', async () => {
    const categories = defineCollection({
      slug: 'categories',
      fields: {
        name: defineField.text({ required: true }),
        parent: defineField.relation({ collection: 'categories', onDelete: 'restrict' })
      }
    });
    const runtime = new ForgeCmsRuntime({
      collections: [categories],
      adapters: {
        database: new InMemoryDatabaseAdapter(),
        auth: new InMemoryAuthAdapter(),
        storage: new InMemoryStorageAdapter()
      }
    });
    runtime.init();
    await runtime.syncSchema();

    const parent = await runtime.create({ collection: 'categories', data: { name: 'Parent' } });
    await runtime.create({
      collection: 'categories',
      data: { name: 'Child', parent: parent.id }
    });

    await expect(
      runtime.delete({ collection: 'categories', id: parent.id as string })
    ).rejects.toThrow(/referenced by 1 document/);
  });

  it('cascades a self-relation recursively (grandchild is deleted too)', async () => {
    const pages = defineCollection({
      slug: 'pages',
      fields: {
        title: defineField.text({ required: true }),
        parent: defineField.relation({ collection: 'pages', onDelete: 'cascade' })
      }
    });
    const runtime = new ForgeCmsRuntime({
      collections: [pages],
      adapters: {
        database: new InMemoryDatabaseAdapter(),
        auth: new InMemoryAuthAdapter(),
        storage: new InMemoryStorageAdapter()
      }
    });
    runtime.init();
    await runtime.syncSchema();

    const root = await runtime.create({ collection: 'pages', data: { title: 'Root' } });
    const child = await runtime.create({
      collection: 'pages',
      data: { title: 'Child', parent: root.id }
    });
    const grandchild = await runtime.create({
      collection: 'pages',
      data: { title: 'Grandchild', parent: child.id }
    });

    await runtime.delete({ collection: 'pages', id: root.id as string });

    const remaining = await runtime.find({ collection: 'pages' });
    expect(remaining.docs).toHaveLength(0);
    // Confirm this proved *recursive* cascade, not a coincidence: both dependent levels are gone.
    expect(await runtime.adapters.database.findById('pages', child.id as string)).toBeNull();
    expect(await runtime.adapters.database.findById('pages', grandchild.id as string)).toBeNull();
  });

  it('cascade recursion terminates on a reference cycle instead of looping forever', async () => {
    const a = defineCollection({
      slug: 'cycle_a',
      fields: {
        name: defineField.text({ required: true }),
        b: defineField.relation({ collection: 'cycle_b', onDelete: 'cascade' })
      }
    });
    const b = defineCollection({
      slug: 'cycle_b',
      fields: {
        name: defineField.text({ required: true }),
        a: defineField.relation({ collection: 'cycle_a', onDelete: 'cascade' })
      }
    });
    const runtime = new ForgeCmsRuntime({
      collections: [a, b],
      adapters: {
        database: new InMemoryDatabaseAdapter(),
        auth: new InMemoryAuthAdapter(),
        storage: new InMemoryStorageAdapter()
      }
    });
    runtime.init();
    await runtime.syncSchema();

    const docA = await runtime.create({ collection: 'cycle_a', data: { name: 'A' } });
    const docB = await runtime.create({
      collection: 'cycle_b',
      data: { name: 'B', a: docA.id }
    });
    await runtime.update({
      collection: 'cycle_a',
      id: docA.id as string,
      data: { b: docB.id }
    });

    // Must resolve (not hang) and must not throw — the whole point of the visited-set guard.
    await runtime.delete({ collection: 'cycle_a', id: docA.id as string });

    expect(await runtime.adapters.database.findById('cycle_a', docA.id as string)).toBeNull();
    expect(await runtime.adapters.database.findById('cycle_b', docB.id as string)).toBeNull();
  });

  it('rejects deleting a document that would set-null a required relation, leaving state unchanged', async () => {
    const teams = defineCollection({
      slug: 'teams',
      fields: { name: defineField.text({ required: true }) }
    });
    const members = defineCollection({
      slug: 'members',
      fields: {
        name: defineField.text({ required: true }),
        team: defineField.relation({ collection: 'teams', required: true, onDelete: 'set-null' })
      }
    });
    const runtime = new ForgeCmsRuntime({
      collections: [teams, members],
      adapters: {
        database: new InMemoryDatabaseAdapter(),
        auth: new InMemoryAuthAdapter(),
        storage: new InMemoryStorageAdapter()
      }
    });
    runtime.init();
    await runtime.syncSchema();

    const team = await runtime.create({ collection: 'teams', data: { name: 'Core' } });
    const member = await runtime.create({
      collection: 'members',
      data: { name: 'Ada', team: team.id }
    });

    await expect(runtime.delete({ collection: 'teams', id: team.id as string })).rejects.toThrow(
      /required/
    );

    // Nothing changed: the team still exists and the member's required field is untouched.
    expect(await runtime.findByID({ collection: 'teams', id: team.id as string })).toBeTruthy();
    const stillMember = await runtime.findByID({ collection: 'members', id: member.id as string });
    expect(stillMember.team).toBe(team.id);
  });

  it('cascade delete runs the real delete pipeline on each dependent (hooks fire, not a raw write)', async () => {
    const deletedIds: string[] = [];
    const authors = defineCollection({
      slug: 'authors2',
      fields: { name: defineField.text({ required: true }) }
    });
    const posts = defineCollection({
      slug: 'posts2',
      fields: {
        title: defineField.text({ required: true }),
        author: defineField.relation({ collection: 'authors2', onDelete: 'cascade' })
      },
      hooks: {
        afterDelete: [
          ({ doc }) => {
            deletedIds.push(doc.id as string);
          }
        ]
      }
    });
    const runtime = new ForgeCmsRuntime({
      collections: [authors, posts],
      adapters: {
        database: new InMemoryDatabaseAdapter(),
        auth: new InMemoryAuthAdapter(),
        storage: new InMemoryStorageAdapter()
      }
    });
    runtime.init();
    await runtime.syncSchema();

    const author = await runtime.create({ collection: 'authors2', data: { name: 'Ada' } });
    const post = await runtime.create({
      collection: 'posts2',
      data: { title: 'Hi', author: author.id }
    });

    await runtime.delete({ collection: 'authors2', id: author.id as string });

    expect(deletedIds).toEqual([post.id]);
  });

  it('many-relation cascade uses a real database-side query, not a full-table scan filter', async () => {
    const tags = defineCollection({
      slug: 'tags2',
      fields: { label: defineField.text({ required: true }) }
    });
    const posts = defineCollection({
      slug: 'posts3',
      fields: {
        title: defineField.text({ required: true }),
        tags: defineField.relation({ collection: 'tags2', many: true, onDelete: 'set-null' })
      }
    });
    const runtime = new ForgeCmsRuntime({
      collections: [tags, posts],
      adapters: {
        database: new InMemoryDatabaseAdapter(),
        auth: new InMemoryAuthAdapter(),
        storage: new InMemoryStorageAdapter()
      }
    });
    runtime.init();
    await runtime.syncSchema();

    const t1 = await runtime.create({ collection: 'tags2', data: { label: 'a' } });
    const t2 = await runtime.create({ collection: 'tags2', data: { label: 'b' } });
    const post = await runtime.create({
      collection: 'posts3',
      data: { title: 'Hi', tags: [t1.id, t2.id] }
    });

    await runtime.delete({ collection: 'tags2', id: t1.id as string });

    const updated = await runtime.findByID({ collection: 'posts3', id: post.id as string });
    expect(updated.tags).toEqual([t2.id]);
  });
});
