import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import { D1DatabaseAdapter } from '../../src/d1.adapter.js';

describe('D1DatabaseAdapter — real local D1 binding: binding validation (spec 051 §14)', () => {
  it('throws a clear, dev-facing error naming the exact missing binding, against a real Miniflare env', () => {
    const adapter = new D1DatabaseAdapter({ binding: 'NOT_A_REAL_BINDING' });
    // `env` here is the real Miniflare-provisioned object (has `DB`/`BUCKET`, not this made-up name) —
    // proves the check works against the actual shape a Worker receives, not just a plain `{}`/mock.
    expect(() => adapter.init(env)).toThrow(
      'D1DatabaseAdapter requires env.NOT_A_REAL_BINDING binding'
    );
  });

  it('the default binding name resolves against the real env without configuration', () => {
    expect(() => new D1DatabaseAdapter().init(env)).not.toThrow();
  });
});

describe('D1DatabaseAdapter — real local D1 binding: unregistered/unsynced collection errors', () => {
  it('a query against a collection that was never synced fails distinguishably from a query failure', async () => {
    const adapter = new D1DatabaseAdapter().init(env);
    // Never called syncSchema() for this collection — the adapter's own registry, not just the SQL
    // table, is missing it.
    await expect(adapter.findMany({ collection: 'never_registered' })).rejects.toThrow(
      "Collection 'never_registered' not registered. Call syncSchema first."
    );
  });

  it('a table that disappears out-of-band after being registered fails as a real D1 error, not a leaked 500 elsewhere', async () => {
    const phantom = defineCollection({
      slug: 'phantom_table',
      fields: { title: defineField.text({ required: true }) }
    });
    const adapter = new D1DatabaseAdapter().init(env);
    await adapter.syncSchema([phantom]);
    await adapter.create('phantom_table', { title: 'will vanish' });

    // Simulate the table disappearing out-of-band (a stale backup restore, manual admin action) —
    // the adapter still believes it's registered, but the next real query hits an actual D1
    // "no such table" failure, not a mock one.
    await env.DB.exec('DROP TABLE "phantom_table"');

    let thrown: unknown;
    try {
      await adapter.findMany({ collection: 'phantom_table' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    // Not a UniqueConstraintError or any Forge-typed error — this is deliberately left as the raw
    // adapter-level failure here; `toErrorResponse` (proven in http-integration.test.ts) is what's
    // responsible for turning it into a clean, non-leaking 500 at the HTTP boundary.
    expect((thrown as { code?: string }).code).not.toBe('UNIQUE_CONSTRAINT');
  });
});
