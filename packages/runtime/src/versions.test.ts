import { describe, expect, it, beforeEach } from 'vitest';
import { defineField, defineCollection } from '@forge-cms/core';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from './runtime.js';

function createTestRuntime() {
  const posts = defineCollection({
    slug: 'posts',
    versions: true,
    fields: {
      title: defineField.text({ required: true }),
      body: defineField.text()
    }
  });

  const auth = new InMemoryAuthAdapter();
  auth.registerSession('test-token', {
    user: { id: 'user-1', email: 'test@example.com', roles: ['admin'] }
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

describe('Versions', () => {
  let runtime: ForgeCmsRuntime;

  beforeEach(async () => {
    runtime = createTestRuntime();
    runtime.init();
    await runtime.syncSchema();
  });

  it('creates a version on first create', async () => {
    const doc = await runtime.create({
      collection: 'posts',
      data: { title: 'First Post', body: 'Content' }
    });

    const versions = await runtime.listVersions({
      collection: 'posts',
      documentId: doc.id as string
    });

    expect(versions).toHaveLength(1);
    expect(versions[0]!.versionNumber).toBe(1);
    expect(versions[0]!.data.title).toBe('First Post');
  });

  it('creates a version on every update', async () => {
    const doc = await runtime.create({
      collection: 'posts',
      data: { title: 'Original', body: 'Content' }
    });

    await runtime.update({
      collection: 'posts',
      id: doc.id as string,
      data: { title: 'Updated' }
    });

    await runtime.update({
      collection: 'posts',
      id: doc.id as string,
      data: { title: 'Updated Again' }
    });

    const versions = await runtime.listVersions({
      collection: 'posts',
      documentId: doc.id as string
    });

    expect(versions).toHaveLength(3);
    expect(versions[0]!.versionNumber).toBe(3);
    expect(versions[0]!.data.title).toBe('Updated Again');
    expect(versions[1]!.versionNumber).toBe(2);
    expect(versions[1]!.data.title).toBe('Updated');
    expect(versions[2]!.versionNumber).toBe(1);
    expect(versions[2]!.data.title).toBe('Original');
  });

  it('gets a specific version by id', async () => {
    const doc = await runtime.create({
      collection: 'posts',
      data: { title: 'Test', body: 'Content' }
    });

    await runtime.update({
      collection: 'posts',
      id: doc.id as string,
      data: { title: 'Updated' }
    });

    const versions = await runtime.listVersions({
      collection: 'posts',
      documentId: doc.id as string
    });

    const version = await runtime.getVersion({
      collection: 'posts',
      versionId: versions[1]!.id
    });

    expect(version.versionNumber).toBe(1);
    expect(version.data.title).toBe('Test');
  });

  it('restores a document to a specific version', async () => {
    const doc = await runtime.create({
      collection: 'posts',
      data: { title: 'Original', body: 'Content' }
    });

    await runtime.update({
      collection: 'posts',
      id: doc.id as string,
      data: { title: 'Updated' }
    });

    const versions = await runtime.listVersions({
      collection: 'posts',
      documentId: doc.id as string
    });

    // Restore to version 1
    const restored = await runtime.restoreVersion({
      collection: 'posts',
      versionId: versions[1]!.id
    });

    expect(restored.title).toBe('Original');

    // Should have created a new version for the restore
    const updatedVersions = await runtime.listVersions({
      collection: 'posts',
      documentId: doc.id as string
    });

    expect(updatedVersions).toHaveLength(3);
    expect(updatedVersions[0]!.data.title).toBe('Original');
    expect(updatedVersions[0]!.label).toContain('Restored');
  });

  it('supports manual version creation with labels', async () => {
    const doc = await runtime.create({
      collection: 'posts',
      data: { title: 'Test', body: 'Content' }
    });

    const version = await runtime.createVersion({
      collection: 'posts',
      documentId: doc.id as string,
      data: { title: 'Test', body: 'Content' },
      label: 'Milestone version'
    });

    expect(version.label).toBe('Milestone version');
    expect(version.versionNumber).toBe(2);
  });

  it('throws for collections without versions enabled', async () => {
    const noVersionsCollection = defineCollection({
      slug: 'no_versions',
      fields: {
        title: defineField.text({ required: true })
      }
    });

    const noVersionsRuntime = new ForgeCmsRuntime({
      collections: [noVersionsCollection],
      adapters: {
        database: new InMemoryDatabaseAdapter(),
        auth: new InMemoryAuthAdapter(),
        storage: new InMemoryStorageAdapter()
      }
    });
    noVersionsRuntime.init();
    await noVersionsRuntime.syncSchema();

    const doc = await noVersionsRuntime.create({
      collection: 'no_versions',
      data: { title: 'Test' }
    });

    await expect(
      noVersionsRuntime.listVersions({
        collection: 'no_versions',
        documentId: doc.id as string
      })
    ).rejects.toThrow('does not have versions enabled');
  });

  it('limits and offsets version lists', async () => {
    const doc = await runtime.create({
      collection: 'posts',
      data: { title: 'Post 1' }
    });

    for (let i = 2; i <= 5; i++) {
      await runtime.update({
        collection: 'posts',
        id: doc.id as string,
        data: { title: `Post ${i}` }
      });
    }

    const versions = await runtime.listVersions({
      collection: 'posts',
      documentId: doc.id as string,
      limit: 2,
      offset: 1
    });

    expect(versions).toHaveLength(2);
    expect(versions[0]!.versionNumber).toBe(4);
    expect(versions[1]!.versionNumber).toBe(3);
  });
});

// Spec 058 §2: versions must not let history bypass the owning document's current access rules.
describe('Version access control (spec 058)', () => {
  const OWNER = { id: 'owner-1', email: 'owner@example.com', roles: ['viewer'] };
  const STRANGER = { id: 'stranger-1', email: 'stranger@example.com', roles: ['viewer'] };

  function createSecuredRuntime() {
    const notes = defineCollection({
      slug: 'notes',
      versions: true,
      drafts: true,
      access: {
        // Row-level rules (a `where`, not a plain boolean) are what makes a denial a 404 instead of a
        // 403 — matching `findByID`'s existing "never confirm a hidden document exists" behavior.
        read: ({ user }) => (user ? { ownerId: user.id } : false),
        update: ({ user }) => (user ? { ownerId: user.id } : false)
      },
      fields: {
        title: defineField.text({ required: true }),
        ownerId: defineField.text({ required: true }),
        secret: defineField.text({ access: { read: [] } })
      }
    });

    return new ForgeCmsRuntime({
      collections: [notes],
      adapters: {
        database: new InMemoryDatabaseAdapter(),
        auth: new InMemoryAuthAdapter(),
        storage: new InMemoryStorageAdapter()
      }
    });
  }

  it('hides history from a caller who cannot read the owning document (row-level access)', async () => {
    const runtime = createSecuredRuntime();
    runtime.init();
    await runtime.syncSchema();

    const doc = await runtime.create({
      collection: 'notes',
      data: { title: 'Private note', ownerId: OWNER.id, _status: 'published' }
    });

    await expect(
      runtime.listVersions({
        collection: 'notes',
        documentId: doc.id as string,
        user: STRANGER,
        overrideAccess: false
      })
    ).rejects.toThrow("Document '" + (doc.id as string) + "' not found");

    const versions = await runtime.listVersions({
      collection: 'notes',
      documentId: doc.id as string,
      user: OWNER,
      overrideAccess: false
    });
    expect(versions).toHaveLength(1);
  });

  it('404s listVersions/getVersion for a deleted owner document (untrusted caller)', async () => {
    const runtime = createSecuredRuntime();
    runtime.init();
    await runtime.syncSchema();

    const doc = await runtime.create({
      collection: 'notes',
      data: { title: 'Gone soon', ownerId: OWNER.id, _status: 'published' }
    });
    const [version] = await runtime.listVersions({
      collection: 'notes',
      documentId: doc.id as string
    });
    await runtime.delete({ collection: 'notes', id: doc.id as string });

    await expect(
      runtime.listVersions({
        collection: 'notes',
        documentId: doc.id as string,
        user: OWNER,
        overrideAccess: false
      })
    ).rejects.toThrow();

    await expect(
      runtime.getVersion({
        collection: 'notes',
        versionId: version!.id,
        user: OWNER,
        overrideAccess: false
      })
    ).rejects.toThrow();

    // Trusted Local API calls still see the history of a deleted document.
    const trusted = await runtime.getVersion({ collection: 'notes', versionId: version!.id });
    expect(trusted.data['title']).toBe('Gone soon');
  });

  it('hides an unpublished draft document`s history from an anonymous caller', async () => {
    const runtime = createSecuredRuntime();
    runtime.init();
    await runtime.syncSchema();
    // Drop the access rule for this check by using a collection with drafts but no custom access.
    const drafts = defineCollection({
      slug: 'articles',
      versions: true,
      drafts: true,
      fields: { title: defineField.text({ required: true }) }
    });
    const draftsRuntime = new ForgeCmsRuntime({
      collections: [drafts],
      adapters: {
        database: new InMemoryDatabaseAdapter(),
        auth: new InMemoryAuthAdapter(),
        storage: new InMemoryStorageAdapter()
      }
    });
    draftsRuntime.init();
    await draftsRuntime.syncSchema();

    const doc = await draftsRuntime.create({
      collection: 'articles',
      data: { title: 'Unfinished', _status: 'draft' }
    });

    await expect(
      draftsRuntime.listVersions({
        collection: 'articles',
        documentId: doc.id as string,
        overrideAccess: false
      })
    ).rejects.toThrow();

    // Any authenticated caller may see a draft's history, same as findByID would let them read it.
    const versions = await draftsRuntime.listVersions({
      collection: 'articles',
      documentId: doc.id as string,
      user: OWNER,
      overrideAccess: false
    });
    expect(versions).toHaveLength(1);
  });

  it('projects a field-level hidden value out of a version snapshot for an untrusted caller', async () => {
    const runtime = createSecuredRuntime();
    runtime.init();
    await runtime.syncSchema();

    const doc = await runtime.create({
      collection: 'notes',
      data: {
        title: 'Has a secret',
        ownerId: OWNER.id,
        secret: 'do-not-leak',
        _status: 'published'
      }
    });

    const version = await runtime.getVersion({
      collection: 'notes',
      versionId: (
        await runtime.listVersions({ collection: 'notes', documentId: doc.id as string })
      )[0]!.id,
      user: OWNER,
      overrideAccess: false
    });
    expect(version.data['title']).toBe('Has a secret');
    expect(version.data).not.toHaveProperty('secret');

    // Trusted (default) calls keep the raw snapshot, unfiltered.
    const trustedVersion = await runtime.getVersion({
      collection: 'notes',
      versionId: version.id
    });
    expect(trustedVersion.data['secret']).toBe('do-not-leak');
  });

  it('restore requires update access and leaves content/history unchanged when denied', async () => {
    const runtime = createSecuredRuntime();
    runtime.init();
    await runtime.syncSchema();

    const doc = await runtime.create({
      collection: 'notes',
      data: { title: 'Original', ownerId: OWNER.id, _status: 'published' }
    });
    await runtime.update({
      collection: 'notes',
      id: doc.id as string,
      data: { title: 'Changed' }
    });
    const versionsBefore = await runtime.listVersions({
      collection: 'notes',
      documentId: doc.id as string
    });
    const originalVersion = versionsBefore[versionsBefore.length - 1]!;

    await expect(
      runtime.restoreVersion({
        collection: 'notes',
        versionId: originalVersion.id,
        user: STRANGER,
        overrideAccess: false
      })
    ).rejects.toThrow();

    const current = await runtime.findByID({ collection: 'notes', id: doc.id as string });
    expect(current.title).toBe('Changed');
    const versionsAfter = await runtime.listVersions({
      collection: 'notes',
      documentId: doc.id as string
    });
    expect(versionsAfter).toHaveLength(versionsBefore.length);

    // The owner, who does have update access, can restore.
    const restored = await runtime.restoreVersion({
      collection: 'notes',
      versionId: originalVersion.id,
      user: OWNER,
      overrideAccess: false
    });
    expect(restored.title).toBe('Original');
    const versionsFinal = await runtime.listVersions({
      collection: 'notes',
      documentId: doc.id as string
    });
    expect(versionsFinal).toHaveLength(versionsBefore.length + 1);
    expect(versionsFinal[0]!.label).toContain('Restored');
  });
});
