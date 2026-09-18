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
    // Message now matches every other operation's 404 (spec 058 §3 routes preview through the same
    // `notFound()` helper `find`/`update`/`delete` use, instead of a preview-only message).
    await expect(
      runtime.preview({
        collection: 'posts',
        id: 'nonexistent-id',
        data: { title: 'Test' }
      })
    ).rejects.toThrow("Record 'nonexistent-id' not found in 'posts'");
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

// Spec 058 §3: preview is a non-persistent simulation of a permitted operation, not an access bypass.
describe('Preview access control (spec 058)', () => {
  const OWNER = { id: 'owner-1', email: 'owner@example.com', roles: ['viewer'] };
  const STRANGER = { id: 'stranger-1', email: 'stranger@example.com', roles: ['viewer'] };

  function createSecuredRuntime() {
    const notes = defineCollection({
      slug: 'notes',
      fields: {
        title: defineField.text({ required: true }),
        ownerId: defineField.text({ required: true }),
        secret: defineField.text({ access: { read: [] } }),
        internal: defineField.text({ access: { write: [] } })
      },
      access: {
        create: ({ user }) => !!user,
        update: ({ user }) => (user ? { ownerId: user.id } : false)
      }
    });

    const runtime = new ForgeCmsRuntime({
      collections: [notes],
      adapters: {
        database: new InMemoryDatabaseAdapter(),
        auth: new InMemoryAuthAdapter(),
        storage: new InMemoryStorageAdapter()
      }
    });
    runtime.init();
    return runtime;
  }

  it("cannot preview another user's document (update access denied)", async () => {
    const runtime = createSecuredRuntime();
    await runtime.syncSchema();

    const doc = await runtime.create({
      collection: 'notes',
      data: { title: 'Owner note', ownerId: OWNER.id }
    });

    await expect(
      runtime.preview({
        collection: 'notes',
        id: doc.id as string,
        data: { title: 'Hijacked' },
        user: STRANGER,
        overrideAccess: false
      })
    ).rejects.toThrow();

    const ok = await runtime.preview({
      collection: 'notes',
      id: doc.id as string,
      data: { title: 'Edited by owner' },
      user: OWNER,
      overrideAccess: false
    });
    expect(ok.title).toBe('Edited by owner');
  });

  it('cannot preview a new document without create access', async () => {
    const runtime = createSecuredRuntime();
    await runtime.syncSchema();

    await expect(
      runtime.preview({
        collection: 'notes',
        data: { title: 'Anonymous attempt', ownerId: 'x' },
        user: null,
        overrideAccess: false
      })
    ).rejects.toThrow();
  });

  it('rejects a forbidden field smuggled into preview data even though nothing persists', async () => {
    const runtime = createSecuredRuntime();
    await runtime.syncSchema();

    const doc = await runtime.create({
      collection: 'notes',
      data: { title: 'Owner note', ownerId: OWNER.id }
    });

    await expect(
      runtime.preview({
        collection: 'notes',
        id: doc.id as string,
        data: { internal: 'smuggled-value' },
        user: OWNER,
        overrideAccess: false
      })
    ).rejects.toThrow();
  });

  it('never exposes a field-level hidden value in the preview output', async () => {
    const runtime = createSecuredRuntime();
    await runtime.syncSchema();

    const doc = await runtime.create({
      collection: 'notes',
      data: { title: 'Owner note', ownerId: OWNER.id, secret: 'do-not-leak' }
    });

    const previewed = await runtime.preview({
      collection: 'notes',
      id: doc.id as string,
      data: { title: 'Still owner' },
      user: OWNER,
      overrideAccess: false
    });
    expect(previewed).not.toHaveProperty('secret');

    // Trusted (default) calls are unaffected.
    const trusted = await runtime.preview({
      collection: 'notes',
      id: doc.id as string,
      data: { title: 'Still owner' }
    });
    expect(trusted.secret).toBe('do-not-leak');
  });

  it('performs zero persistent writes and zero version creation', async () => {
    const versioned = defineCollection({
      slug: 'versioned_notes',
      versions: true,
      fields: { title: defineField.text({ required: true }) }
    });
    const runtime = new ForgeCmsRuntime({
      collections: [versioned],
      adapters: {
        database: new InMemoryDatabaseAdapter(),
        auth: new InMemoryAuthAdapter(),
        storage: new InMemoryStorageAdapter()
      }
    });
    runtime.init();
    await runtime.syncSchema();

    const doc = await runtime.create({ collection: 'versioned_notes', data: { title: 'v1' } });
    await runtime.preview({
      collection: 'versioned_notes',
      id: doc.id as string,
      data: { title: 'previewed, never saved' }
    });

    const stored = await runtime.findByID({ collection: 'versioned_notes', id: doc.id as string });
    expect(stored.title).toBe('v1');

    const versions = await runtime.listVersions({
      collection: 'versioned_notes',
      documentId: doc.id as string
    });
    expect(versions).toHaveLength(1);
  });
});
