import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import { ApiKeyAuthAdapter } from '@forge-cms/auth';
import { D1DatabaseAdapter } from '../../src/d1.adapter.js';

function realAdapter(): D1DatabaseAdapter {
  return new D1DatabaseAdapter().init(env);
}

describe('D1DatabaseAdapter — real local D1 binding: init/syncSchema', () => {
  it('creates and reads a record through a real D1 binding', async () => {
    const smoke = defineCollection({
      slug: 'schema_smoke',
      fields: { title: defineField.text({ required: true }) }
    });
    const adapter = realAdapter();
    await adapter.syncSchema([smoke]);

    const created = await adapter.create('schema_smoke', { title: 'hello' });
    expect(typeof created.id).toBe('string');

    const found = await adapter.findById('schema_smoke', created.id as string);
    expect(found?.title).toBe('hello');
  });

  it('syncs a realistic collection — text/number/boolean/json/relation/many-relation/draft fields', async () => {
    const posts = defineCollection({
      slug: 'schema_posts',
      drafts: true,
      fields: {
        title: defineField.text({ required: true }),
        views: defineField.number(),
        published: defineField.boolean(),
        metadata: defineField.json(),
        author: defineField.relation({ collection: 'authors' }),
        tags: defineField.relation({ collection: 'tags', many: true })
      }
    });
    const adapter = realAdapter();
    await adapter.syncSchema([posts]);

    const created = await adapter.create('schema_posts', {
      title: 'Real D1 field coverage',
      views: 42,
      published: true,
      metadata: { source: 'test', nested: { ok: true } },
      author: 'author-1',
      tags: ['a', 'b'],
      _status: 'draft'
    });

    const found = await adapter.findById('schema_posts', created.id as string);
    expect(found).toMatchObject({
      title: 'Real D1 field coverage',
      views: 42,
      published: true,
      metadata: { source: 'test', nested: { ok: true } },
      author: 'author-1',
      tags: ['a', 'b'],
      _status: 'draft'
    });
  });

  it('is safe to call syncSchema() repeatedly against the same real D1 database', async () => {
    const idempotent = defineCollection({
      slug: 'schema_idempotent',
      fields: { title: defineField.text({ required: true }) }
    });
    const adapter = realAdapter();

    await adapter.syncSchema([idempotent]);
    await adapter.syncSchema([idempotent]);
    await adapter.syncSchema([idempotent]);

    const created = await adapter.create('schema_idempotent', { title: 'still works' });
    expect(created.title).toBe('still works');
  });

  // spec 049: ForgeCmsRuntime.syncSchema() calls database.syncSchema(collections), then
  // auth.syncSchema?.() — which, when ApiKeyAuthAdapter shares the *same* database adapter
  // instance, calls database.syncSchema([_forge_api_keys]) again. Every adapter upserts by slug
  // rather than clearing first specifically so this doesn't clobber consumer collections; this
  // proves that against real D1, not just the mock/InMemory.
  it('ApiKeyAuthAdapter.syncSchema() sharing the same real D1 instance does not clobber consumer collections', async () => {
    const sharedArticles = defineCollection({
      slug: 'schema_shared_articles',
      fields: { title: defineField.text({ required: true }) }
    });
    const database = realAdapter();
    const auth = new ApiKeyAuthAdapter();
    auth.init({ apiKeyDatabase: database });

    await database.syncSchema([sharedArticles]);
    await auth.syncSchema();

    // The consumer collection registered by the first syncSchema() call must still work after the
    // second syncSchema() call (for a completely different collection) on the same instance.
    const created = await database.create('schema_shared_articles', { title: 'still registered' });
    expect(created.title).toBe('still registered');

    // And the reverse: the auth adapter's own table must have been created too.
    await expect(auth.createApiKey({ name: 'smoke-key' })).resolves.toMatchObject({
      secret: expect.any(String)
    });
  });

  it('stamps real timestamps and a typed id on create, advances updated_at on update', async () => {
    const timestamps = defineCollection({
      slug: 'schema_timestamps',
      fields: { title: defineField.text({ required: true }) }
    });
    const adapter = realAdapter();
    await adapter.syncSchema([timestamps]);

    const created = await adapter.create('schema_timestamps', { title: 'a' });
    expect(typeof created.id).toBe('string');
    expect((created.id as string).length).toBeGreaterThan(0);
    expect(typeof created.created_at).toBe('string');
    expect(typeof created.updated_at).toBe('string');
    expect(Number.isNaN(Date.parse(String(created.created_at)))).toBe(false);

    const updated = await adapter.update('schema_timestamps', created.id as string, { title: 'b' });
    expect(updated.created_at).toBe(created.created_at);
    expect(Date.parse(String(updated.updated_at))).toBeGreaterThanOrEqual(
      Date.parse(String(created.updated_at))
    );
  });
});

describe('D1DatabaseAdapter — real local D1 binding: compound unique indexes', () => {
  const pages = defineCollection({
    slug: 'schema_pages',
    fields: {
      tenant: defineField.text({ required: true }),
      slug: defineField.text({ required: true })
    },
    indexes: [{ fields: ['tenant', 'slug'], unique: true }]
  });

  it('accepts distinct (tenant, slug) tuples and rejects a duplicate one on create', async () => {
    const adapter = realAdapter();
    await adapter.syncSchema([pages]);

    await expect(
      adapter.create('schema_pages', { tenant: 't1', slug: 'home' })
    ).resolves.toMatchObject({ tenant: 't1', slug: 'home' });
    await expect(
      adapter.create('schema_pages', { tenant: 't1', slug: 'about' })
    ).resolves.toMatchObject({ tenant: 't1', slug: 'about' });
    await expect(
      adapter.create('schema_pages', { tenant: 't2', slug: 'home' })
    ).resolves.toMatchObject({ tenant: 't2', slug: 'home' });

    let thrown: unknown;
    try {
      await adapter.create('schema_pages', { tenant: 't1', slug: 'home' });
    } catch (err) {
      thrown = err;
    }
    const conflict = thrown as { code?: string; fields?: string[] } | undefined;
    expect(conflict?.code).toBe('UNIQUE_CONSTRAINT');
    // The stable Forge contract: exactly the conflicting column names, never real D1's raw
    // diagnostic suffix leaking into `.fields` (spec 051 — found by testing against real D1; see
    // `packages/db/src/constraint-error.ts`'s `parseSqliteUniqueConstraintMessage`).
    expect(conflict?.fields).toEqual(['tenant', 'slug']);
  });

  it('allows an update that keeps the same (tenant, slug) tuple', async () => {
    const adapter = realAdapter();
    await adapter.syncSchema([pages]);
    const created = await adapter.create('schema_pages', { tenant: 't3', slug: 'contact' });

    await expect(
      adapter.update('schema_pages', created.id as string, { tenant: 't3', slug: 'contact' })
    ).resolves.toMatchObject({ tenant: 't3', slug: 'contact' });
  });

  it('rejects an update that moves a record into another record’s (tenant, slug) tuple', async () => {
    const adapter = realAdapter();
    await adapter.syncSchema([pages]);
    await adapter.create('schema_pages', { tenant: 't4', slug: 'taken' });
    const other = await adapter.create('schema_pages', { tenant: 't4', slug: 'free' });

    let thrown: unknown;
    try {
      await adapter.update('schema_pages', other.id as string, { slug: 'taken' });
    } catch (err) {
      thrown = err;
    }
    expect((thrown as { code?: string } | undefined)?.code).toBe('UNIQUE_CONSTRAINT');
  });
});

describe('D1DatabaseAdapter — real local D1 binding: additive schema evolution', () => {
  it('preserves existing rows and makes a newly added column usable after a second syncSchema()', async () => {
    const adapter = realAdapter();

    const v1 = defineCollection({
      slug: 'schema_evolve',
      fields: { title: defineField.text({ required: true }) }
    });
    await adapter.syncSchema([v1]);
    const existing = await adapter.create('schema_evolve', { title: 'from version A' });

    const v2 = defineCollection({
      slug: 'schema_evolve',
      fields: {
        title: defineField.text({ required: true }),
        summary: defineField.text()
      }
    });
    await adapter.syncSchema([v2]);

    const stillThere = await adapter.findById('schema_evolve', existing.id as string);
    expect(stillThere?.title).toBe('from version A');

    const withSummary = await adapter.create('schema_evolve', {
      title: 'from version B',
      summary: 'new column works'
    });
    expect(withSummary.summary).toBe('new column works');
  });
});
