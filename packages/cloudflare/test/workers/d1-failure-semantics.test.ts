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

// Spec 059: a conditional write must never turn a failure into `{ applied: false }` — "the condition
// was not met" and "the database could not answer" are different facts and callers act on the
// difference (a last-admin refusal is a 409-shaped answer; a D1 outage is a 500).
describe('D1DatabaseAdapter — real local D1 binding: conditional write failure semantics (spec 059)', () => {
  const guard = { keepAtLeast: { where: { role: 'admin' }, others: 1 } };

  it('rejects for an unregistered collection instead of reporting not-applied', async () => {
    const adapter = new D1DatabaseAdapter().init(env);
    await expect(
      adapter.updateIf('cw_never_registered', 'x', { role: 'a' }, guard)
    ).rejects.toThrow("Collection 'cw_never_registered' not registered. Call syncSchema first.");
    await expect(adapter.deleteIf('cw_never_registered', 'x', guard)).rejects.toThrow(
      "Collection 'cw_never_registered' not registered. Call syncSchema first."
    );
  });

  it('rejects an unknown column before any statement runs, leaving the row untouched', async () => {
    const people = defineCollection({
      slug: 'cw_unknown_column',
      fields: { role: defineField.text() }
    });
    const adapter = new D1DatabaseAdapter().init(env);
    await adapter.syncSchema([people]);
    await adapter.create('cw_unknown_column', { id: 'p1', role: 'admin' });

    await expect(
      adapter.updateIf('cw_unknown_column', 'p1', { role: 'x', nope: 1 }, {})
    ).rejects.toThrow("Unknown column 'nope'");
    await expect(
      adapter.updateIf('cw_unknown_column', 'p1', { role: 'x' }, { targetMatches: { nope: 1 } })
    ).rejects.toThrow("Unknown column 'nope'");
    expect((await adapter.findById('cw_unknown_column', 'p1'))?.role).toBe('admin');
  });

  it('a table that disappears out-of-band fails as a real D1 error, not as applied: false', async () => {
    const vanishing = defineCollection({
      slug: 'cw_vanishing',
      fields: { role: defineField.text() }
    });
    const adapter = new D1DatabaseAdapter().init(env);
    await adapter.syncSchema([vanishing]);
    await adapter.create('cw_vanishing', { id: 'v1', role: 'admin' });
    await env.DB.exec('DROP TABLE "cw_vanishing"');

    await expect(adapter.updateIf('cw_vanishing', 'v1', { role: 'x' }, guard)).rejects.toThrow(
      /no such table/i
    );
    await expect(adapter.deleteIf('cw_vanishing', 'v1', guard)).rejects.toThrow(/no such table/i);
  });
});
