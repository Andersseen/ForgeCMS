import { describe, expect, it, beforeEach } from 'vitest';
import { defineField, defineGlobal } from '@forge-cms/core';
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
