import { describe, expect, it, beforeEach } from 'vitest';
import { defineCollection, defineField, defineGlobal } from '@forge-cms/core';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from './runtime.js';
import { handleGlobalRead, handleGlobalUpdate } from './handlers.js';

function createTestContext(
  method: string,
  url: string,
  body?: unknown,
  authToken?: string
): Parameters<typeof handleGlobalRead>[0] {
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
  const siteSettings = defineGlobal({
    slug: 'site_settings',
    fields: {
      siteName: defineField.text({ required: true }),
      tagline: defineField.text(),
      maintenanceMode: defineField.boolean()
    }
  });

  const draftGlobal = defineGlobal({
    slug: 'draft_global',
    drafts: true,
    fields: {
      title: defineField.text({ required: true })
    }
  });

  const auth = new InMemoryAuthAdapter();
  auth.registerSession('admin-token', {
    user: { id: 'admin-1', email: 'admin@example.com', roles: ['admin'] }
  });

  return new ForgeCmsRuntime({
    collections: [],
    globals: [siteSettings, draftGlobal],
    adapters: {
      database: new InMemoryDatabaseAdapter(),
      auth,
      storage: new InMemoryStorageAdapter()
    }
  });
}

describe('Globals', () => {
  let runtime: ForgeCmsRuntime;

  beforeEach(async () => {
    runtime = createTestRuntime();
    runtime.init();
    await runtime.syncSchema();
  });

  describe('Local API', () => {
    it('returns null when a global has never been written', async () => {
      const result = await runtime.getGlobalDocument({ global: 'site_settings' });
      expect(result).toBeNull();
    });

    it('creates a global document on first update', async () => {
      const result = await runtime.updateGlobalDocument({
        global: 'site_settings',
        data: { siteName: 'My Site', tagline: 'Welcome' }
      });

      expect(result.siteName).toBe('My Site');
      expect(result.tagline).toBe('Welcome');
      expect(result.id).toBe('global');
    });

    it('updates an existing global document', async () => {
      await runtime.updateGlobalDocument({
        global: 'site_settings',
        data: { siteName: 'Original' }
      });

      const updated = await runtime.updateGlobalDocument({
        global: 'site_settings',
        data: { siteName: 'Updated' }
      });

      expect(updated.siteName).toBe('Updated');
    });

    it('reads a global document after it has been written', async () => {
      await runtime.updateGlobalDocument({
        global: 'site_settings',
        data: { siteName: 'Test Site' }
      });

      const result = await runtime.getGlobalDocument({ global: 'site_settings' });
      expect(result).not.toBeNull();
      expect(result?.siteName).toBe('Test Site');
    });

    it('validates required fields', async () => {
      await expect(
        runtime.updateGlobalDocument({
          global: 'site_settings',
          data: { tagline: 'No site name' }
        })
      ).rejects.toThrow();
    });

    it('rejects unknown fields', async () => {
      await expect(
        runtime.updateGlobalDocument({
          global: 'site_settings',
          data: { siteName: 'Test', unknownField: 'value' }
        })
      ).rejects.toThrow();
    });

    it('defaults to draft status when drafts is enabled', async () => {
      const result = await runtime.updateGlobalDocument({
        global: 'draft_global',
        data: { title: 'Draft content' }
      });

      expect(result._status).toBe('draft');
    });

    it('throws for unknown global', async () => {
      await expect(runtime.getGlobalDocument({ global: 'nonexistent' })).rejects.toThrow(
        "Global 'nonexistent' not found"
      );
    });
  });

  describe('HTTP handlers', () => {
    it('returns 404 when global has not been configured', async () => {
      const context = createTestContext('GET', 'https://forge.test/api/globals/site_settings');
      context.params = { global: 'site_settings' };

      const response = await handleGlobalRead(context, { runtime });
      expect(response.status).toBe(404);
    });

    it('returns the global document after it has been written', async () => {
      await runtime.updateGlobalDocument({
        global: 'site_settings',
        data: { siteName: 'HTTP Test' }
      });

      const context = createTestContext('GET', 'https://forge.test/api/globals/site_settings');
      context.params = { global: 'site_settings' };

      const response = await handleGlobalRead(context, { runtime });
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.data.siteName).toBe('HTTP Test');
    });

    it('updates a global via PUT', async () => {
      const context = createTestContext(
        'PUT',
        'https://forge.test/api/globals/site_settings',
        { siteName: 'Updated via HTTP' },
        'admin-token'
      );
      context.params = { global: 'site_settings' };

      const response = await handleGlobalUpdate(context, { runtime });
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.data.siteName).toBe('Updated via HTTP');
    });

    it('returns 404 for unknown global', async () => {
      const context = createTestContext('GET', 'https://forge.test/api/globals/nonexistent');
      context.params = { global: 'nonexistent' };

      const response = await handleGlobalRead(context, { runtime });
      expect(response.status).toBe(404);
    });
  });
});

// Spec 058 §8: globals must not accept `depth` and silently ignore it, and a draft global must not be
// readable by an anonymous caller — both previously true (F11).
describe('Global draft visibility and depth (spec 058)', () => {
  let runtime: ForgeCmsRuntime;

  beforeEach(async () => {
    runtime = createTestRuntime();
    runtime.init();
    await runtime.syncSchema();
  });

  it('hides a draft global from an anonymous/untrusted caller (resolves like "never configured")', async () => {
    await runtime.updateGlobalDocument({
      global: 'draft_global',
      data: { title: 'Unfinished', _status: 'draft' }
    });

    const anon = await runtime.getGlobalDocument({
      global: 'draft_global',
      overrideAccess: false
    });
    expect(anon).toBeNull();

    const authed = await runtime.getGlobalDocument({
      global: 'draft_global',
      user: { id: 'u1', email: 'u@example.com' },
      overrideAccess: false
    });
    expect(authed?.title).toBe('Unfinished');

    // Trusted Local API calls are unaffected.
    const trusted = await runtime.getGlobalDocument({ global: 'draft_global' });
    expect(trusted?.title).toBe('Unfinished');
  });

  it('reveals a published global to an anonymous caller as before', async () => {
    await runtime.updateGlobalDocument({
      global: 'draft_global',
      data: { title: 'Live', _status: 'published' }
    });

    const anon = await runtime.getGlobalDocument({
      global: 'draft_global',
      overrideAccess: false
    });
    expect(anon?.title).toBe('Live');
  });

  it('populates a relation field when depth: 1 is requested instead of ignoring it', async () => {
    // Build a dedicated runtime whose global actually has a relation field to prove population.
    const people = defineCollection({
      slug: 'people',
      fields: { name: defineField.text({ required: true }) }
    });
    const siteSettings = defineGlobal({
      slug: 'settings_with_relation',
      fields: {
        title: defineField.text({ required: true }),
        owner: defineField.relation({ collection: 'people' })
      }
    });
    const relRuntime = new ForgeCmsRuntime({
      collections: [people],
      globals: [siteSettings],
      adapters: {
        database: new InMemoryDatabaseAdapter(),
        auth: new InMemoryAuthAdapter(),
        storage: new InMemoryStorageAdapter()
      }
    });
    relRuntime.init();
    await relRuntime.syncSchema();

    const owner = await relRuntime.create({ collection: 'people', data: { name: 'Ada' } });
    await relRuntime.updateGlobalDocument({
      global: 'settings_with_relation',
      data: { title: 'Site', owner: owner.id }
    });

    const withoutDepth = await relRuntime.getGlobalDocument({ global: 'settings_with_relation' });
    expect(withoutDepth?.owner).toBe(owner.id);

    const withDepth = await relRuntime.getGlobalDocument({
      global: 'settings_with_relation',
      depth: 1
    });
    expect((withDepth?.owner as Record<string, unknown>)?.name).toBe('Ada');
  });
});
