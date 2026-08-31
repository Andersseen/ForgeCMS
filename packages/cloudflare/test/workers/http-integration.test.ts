import { env, exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiKeyAuthAdapter } from '@forge-cms/auth';
import { D1DatabaseAdapter } from '../../src/d1.adapter.js';
import { articles } from './fixtures/worker.js';

/**
 * The one real-Worker-runtime HTTP integration fixture (spec 051 §10):
 * `Request → Forge HTTP handler (handleList) → machine auth → collection access → real D1 query →
 * Response`, exercised through the actual `fetch` export of `test/workers/fixtures/worker.ts` running
 * inside workerd — not a mocked handler, not a direct Local API call.
 */
describe('HTTP integration — real Worker runtime, real D1, machine auth + access + query', () => {
  let scopedKey: string;
  let unscopedKey: string;

  beforeAll(async () => {
    // Warms up the worker's lazily-built runtime (creates the `articles` table and the
    // `_forge_api_keys` table via the *same* real D1 binding this test file also uses) and doubles
    // as the "no credential" 401 case.
    const anonymous = await exports.default.fetch(new Request('https://forge.test/articles'));
    expect(anonymous.status).toBe(401);

    // A fresh adapter instance's `collections` registry is per-instance JS state, populated only by
    // calling `syncSchema()` on *that* instance — even though it shares the worker's real D1 tables,
    // it must register them for itself too before `create()`/`findById()` will recognize them.
    const database = new D1DatabaseAdapter().init(env);
    await database.syncSchema([articles]);
    const auth = new ApiKeyAuthAdapter();
    auth.init({ apiKeyDatabase: database });
    await auth.syncSchema();

    const scoped = await auth.createApiKey({
      name: 'http-integration-scoped',
      scopes: ['articles:read'],
      metadata: { tenant: 'acme' }
    });
    scopedKey = scoped.secret;

    const unscoped = await auth.createApiKey({ name: 'http-integration-unscoped' });
    unscopedKey = unscoped.secret;

    await database.create('articles', { title: 'Acme public post', tenant: 'acme' });
    await database.create('articles', { title: 'Other tenant post', tenant: 'other' });
  });

  it('valid key + scope + correct tenant → 200, scoped to that tenant only', async () => {
    const response = await exports.default.fetch(
      new Request('https://forge.test/articles', {
        headers: { authorization: `Bearer ${scopedKey}` }
      })
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as { data: { title: string; tenant: string }[] };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((doc) => doc.tenant === 'acme')).toBe(true);
  });

  it('valid key without the required scope → 403', async () => {
    const response = await exports.default.fetch(
      new Request('https://forge.test/articles', {
        headers: { authorization: `Bearer ${unscopedKey}` }
      })
    );
    expect(response.status).toBe(403);
  });

  it('invalid key → 401', async () => {
    const response = await exports.default.fetch(
      new Request('https://forge.test/articles', {
        headers: { authorization: 'Bearer forge_00000000-0000-0000-0000-000000000000_garbage' }
      })
    );
    expect(response.status).toBe(401);
  });

  it('a real D1 infrastructure failure (missing table) → 500, without leaking internals', async () => {
    const response = await exports.default.fetch(
      new Request('https://forge.test/unsynced', {
        headers: { authorization: `Bearer ${scopedKey}` }
      })
    );
    expect(response.status).toBe(500);

    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).not.toMatch(/SQL|SQLITE|D1_ERROR|no such table|unsynced/i);
  });
});
