import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import { ApiKeyAuthAdapter } from '@forge-cms/auth';
import { D1DatabaseAdapter } from '../../src/d1.adapter.js';

const documents = defineCollection({
  slug: 'json_parity_docs',
  fields: {
    payload: defineField.json(),
    tags: defineField.relation({ collection: 'tags', many: true })
  }
});

describe('D1DatabaseAdapter — real local D1 binding: JSON serialization parity', () => {
  it.each([
    ['null', null],
    ['empty object', {}],
    ['empty array', []],
    ['boolean true', true],
    ['boolean false', false],
    ['zero', 0],
    ['negative float', -3.5],
    ['unicode string', { greeting: 'héllo 世界 🎉' }],
    ['nested JSON', { a: { b: { c: [1, 2, { d: 'deep' }] } }, list: [null, false, 0, ''] }]
  ])('round-trips %s through a real D1 json field', async (_label, value) => {
    const adapter = new D1DatabaseAdapter().init(env);
    await adapter.syncSchema([documents]);

    const created = await adapter.create('json_parity_docs', { payload: value, tags: [] });
    const found = await adapter.findById('json_parity_docs', created.id as string);

    expect(found?.payload).toEqual(value);
  });

  it('round-trips a many-relation array of ids', async () => {
    const adapter = new D1DatabaseAdapter().init(env);
    await adapter.syncSchema([documents]);

    const created = await adapter.create('json_parity_docs', {
      payload: { ok: true },
      tags: ['tag-1', 'tag-2', 'tag-3']
    });
    const found = await adapter.findById('json_parity_docs', created.id as string);

    expect(found?.tags).toEqual(['tag-1', 'tag-2', 'tag-3']);
  });

  it('round-trips an empty many-relation array', async () => {
    const adapter = new D1DatabaseAdapter().init(env);
    await adapter.syncSchema([documents]);

    const created = await adapter.create('json_parity_docs', { payload: null, tags: [] });
    const found = await adapter.findById('json_parity_docs', created.id as string);

    expect(found?.tags).toEqual([]);
  });
});

describe('D1DatabaseAdapter — real local D1 binding: API-key scopes/metadata JSON parity', () => {
  it('round-trips scopes (array) and metadata (nested object) through real D1', async () => {
    const database = new D1DatabaseAdapter().init(env);
    const auth = new ApiKeyAuthAdapter();
    auth.init({ apiKeyDatabase: database });
    await auth.syncSchema();

    const { apiKey, secret } = await auth.createApiKey({
      name: 'json-parity-key',
      scopes: ['articles:read', 'articles:write'],
      metadata: { tenant: 'acme', limits: { requestsPerMinute: 60 }, tags: [] }
    });

    expect(apiKey.scopes).toEqual(['articles:read', 'articles:write']);
    expect(apiKey.metadata).toEqual({
      tenant: 'acme',
      limits: { requestsPerMinute: 60 },
      tags: []
    });

    // `secret` here is already the full bearer token (`<prefix>_<id>_<secret>`), returned once.
    const session = await auth.validateSession(secret);
    expect(session?.user.scopes).toEqual(['articles:read', 'articles:write']);
    expect(session?.user.metadata).toEqual({
      tenant: 'acme',
      limits: { requestsPerMinute: 60 },
      tags: []
    });
  });
});
