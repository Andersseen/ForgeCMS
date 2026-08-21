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
