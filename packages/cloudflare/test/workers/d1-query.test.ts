import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import {
  runDatabaseAdapterConstraintContractTests,
  runDatabaseAdapterQueryContractTests
} from '@forge-cms/testing/contracts';
import { D1DatabaseAdapter } from '../../src/d1.adapter.js';

// The shared contract suites assume `createAdapter()` hands back an adapter over an *empty* backing
// store every time (the D1 mock does this by constructing a fresh `MockD1Database` per call; the
// InMemory/libSQL suites presumably do the equivalent). `@cloudflare/vitest-plugin` isolates storage
// per *test file*, not per `it()` — the same real D1 binding, and the same `widgets`/`articles` rows
// with fixed ids, would otherwise still be there on the second test's `beforeEach`. This `beforeEach`
// runs *before* the contract suites' own inner `beforeEach` (outer-describe hooks run first), so it
// resets exactly the two fixed table names those suites use — the smallest fix that keeps
// `packages/testing/src/contracts/database.ts` itself untouched (spec 051 §18).
describe('D1DatabaseAdapter — real local D1 binding: shared contract suites', () => {
  beforeEach(async () => {
    for (const table of ['widgets', 'articles']) {
      try {
        await env.DB.exec(`DELETE FROM "${table}"`);
      } catch {
        // Table doesn't exist yet on the first run in this file — fine.
      }
    }
  });

  runDatabaseAdapterConstraintContractTests(() => {
    const adapter = new D1DatabaseAdapter();
    adapter.init(env);
    return adapter;
  });

  runDatabaseAdapterQueryContractTests(() => {
    const adapter = new D1DatabaseAdapter();
    adapter.init(env);
    return adapter;
  });
});

describe('D1DatabaseAdapter — real local D1 binding: empty-OR access-constraint regression', () => {
  // spec 050 found a security bug: an access-rule constraint that legitimately resolves to
  // `{ or: [] }` (e.g. a tenant-less user's `{ or: user.tenants.map(...) }`) means "no branch can
  // ever be true" — deny all. The first-cut SQL adapters compiled an empty `or` to "no filter",
  // returning every row instead of none. `operations.test.ts` proves the fix on InMemory + real
  // libSQL, but `@forge-cms/runtime` cannot depend on `@forge-cms/cloudflare`, so D1 has never had
  // the same regression proven against a real binding until now.
  it('an access rule resolving to `{ or: [] }` denies all, identically to InMemory/libSQL', async () => {
    const gated = defineCollection({
      slug: 'query_empty_or_gate',
      fields: { title: defineField.text({ required: true }) }
    });
    const adapter = new D1DatabaseAdapter().init(env);
    await adapter.syncSchema([gated]);

    await adapter.create('query_empty_or_gate', { title: 'row one' });
    await adapter.create('query_empty_or_gate', { title: 'row two' });

    const results = await adapter.findMany({
      collection: 'query_empty_or_gate',
      where: { or: [] }
    });
    expect(results).toEqual([]);
    expect(await adapter.count('query_empty_or_gate', { or: [] })).toBe(0);
  });

  it('an empty `or: []` nested inside an `and` still zeroes out the whole result on real D1', async () => {
    const gated = defineCollection({
      slug: 'query_empty_or_nested',
      fields: { title: defineField.text({ required: true }), status: defineField.text() }
    });
    const adapter = new D1DatabaseAdapter().init(env);
    await adapter.syncSchema([gated]);
    await adapter.create('query_empty_or_nested', { title: 'a', status: 'published' });

    const results = await adapter.findMany({
      collection: 'query_empty_or_nested',
      where: { and: [{ status: 'published' }, { or: [] }] }
    });
    expect(results).toEqual([]);
  });
});

describe('D1DatabaseAdapter — real local D1 binding: containsValue against real json_each', () => {
  const tagged = defineCollection({
    slug: 'query_contains_value',
    fields: {
      title: defineField.text({ required: true }),
      tags: defineField.relation({ collection: 'tags', many: true })
    }
  });

  it('proves exact match / substring-does-not-match / missing-does-not-match / empty-does-not-match', async () => {
    const adapter = new D1DatabaseAdapter().init(env);
    await adapter.syncSchema([tagged]);

    await adapter.create('query_contains_value', { title: 'has-ab', tags: ['alpha', 'beta'] });
    await adapter.create('query_contains_value', { title: 'has-neither', tags: ['gamma'] });
    await adapter.create('query_contains_value', { title: 'empty', tags: [] });

    const exact = await adapter.findMany({
      collection: 'query_contains_value',
      where: { tags: { containsValue: 'alpha' } }
    });
    expect(exact.map((r) => r.title)).toEqual(['has-ab']);

    // Real SQLite `json_each` membership is exact-element equality, not a substring/LIKE match —
    // 'al' must not match the element 'alpha'.
    const substring = await adapter.findMany({
      collection: 'query_contains_value',
      where: { tags: { containsValue: 'al' } }
    });
    expect(substring).toEqual([]);

    const missing = await adapter.findMany({
      collection: 'query_contains_value',
      where: { tags: { containsValue: 'zzz' } }
    });
    expect(missing).toEqual([]);

    const againstEmptyArrayRow = await adapter.findMany({
      collection: 'query_contains_value',
      where: { title: 'empty', tags: { containsValue: 'alpha' } }
    });
    expect(againstEmptyArrayRow).toEqual([]);
  });
});
