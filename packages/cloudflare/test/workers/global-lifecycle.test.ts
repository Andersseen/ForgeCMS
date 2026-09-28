import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import type { CollectionDefinition, GlobalDefinition } from '@forge-cms/core';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import {
  globalLifecycleGlobals,
  localeMergeCollections,
  runGlobalLifecycleContractTests,
  runLocaleMergeContractTests
} from '@forge-cms/testing/contracts';
import { D1DatabaseAdapter } from '../../src/d1.adapter.js';

// Spec 066's real-D1 evidence, inside workerd against Miniflare's local D1 (SQLite). Every contender is
// its own `ForgeCmsRuntime` over its own `D1DatabaseAdapter` on the one shared binding. Each test uses
// its own global prefix, so the per-file D1 storage needs no cleanup. Local workerd, not production D1.

function runtimeOver(
  database: D1DatabaseAdapter,
  globals: GlobalDefinition[],
  collections: CollectionDefinition[] = []
) {
  const runtime = new ForgeCmsRuntime({
    env,
    collections,
    globals,
    adapters: { database, auth: new InMemoryAuthAdapter(), storage: new InMemoryStorageAdapter() }
  });
  runtime.init();
  return runtime;
}

describe('D1DatabaseAdapter — real local D1 binding: global document lifecycle under independent writers', () => {
  runGlobalLifecycleContractTests(async ({ prefix, parties, gate }) => {
    const contenders = [];
    for (let i = 0; i < parties; i++) {
      const runtime = runtimeOver(
        gate.wrap(new D1DatabaseAdapter().init(env)),
        globalLifecycleGlobals(prefix)
      );
      await runtime.syncSchema();
      contenders.push(runtime);
    }
    const raw = runtimeOver(new D1DatabaseAdapter().init(env), globalLifecycleGlobals(prefix));
    await raw.syncSchema();
    return { contenders, database: raw.adapters.database };
  });
});

describe('D1DatabaseAdapter — real local D1 binding: localized fields (spec 066)', () => {
  it('stores, merges and resolves per-locale values', async () => {
    // Before spec 066 the per-locale map was bound as a plain column value (reproduced on libSQL; D1
    // shares the same value codec).
    const pages = defineCollection({
      slug: 'loc_pages',
      locales: ['en', 'es'],
      fields: {
        title: defineField.text({ localized: true }),
        summary: defineField.textarea({ localized: true }),
        views: defineField.number()
      }
    });
    const runtime = runtimeOver(new D1DatabaseAdapter().init(env), [], [pages]);
    await runtime.syncSchema();

    const page = await runtime.create({
      collection: 'loc_pages',
      locale: 'en',
      data: { title: 'Hi', summary: 'Short', views: 3 }
    });
    await runtime.update({
      collection: 'loc_pages',
      id: page.id as string,
      locale: 'es',
      data: { title: 'Hola' }
    });

    expect(await runtime.adapters.database.findById('loc_pages', page.id as string)).toMatchObject({
      title: { en: 'Hi', es: 'Hola' },
      summary: { en: 'Short' },
      views: 3
    });
    expect(
      await runtime.findByID({ collection: 'loc_pages', id: page.id as string, locale: 'es' })
      // `summary` has no Spanish value: it falls back to the first locale.
    ).toMatchObject({ title: 'Hola', summary: 'Short', views: 3 });
  });
});

describe('D1DatabaseAdapter — real local D1 binding: collection locale merges (spec 067)', () => {
  runLocaleMergeContractTests(async ({ prefix, parties, gate }) => {
    const contenders = [];
    for (let i = 0; i < parties; i++) {
      const runtime = runtimeOver(
        gate.wrap(new D1DatabaseAdapter().init(env)),
        [],
        localeMergeCollections(prefix)
      );
      await runtime.syncSchema();
      contenders.push(runtime);
    }
    const raw = runtimeOver(new D1DatabaseAdapter().init(env), [], localeMergeCollections(prefix));
    await raw.syncSchema();
    return { contenders, database: raw.adapters.database };
  });
});
