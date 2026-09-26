import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import type { CollectionDefinition } from '@forge-cms/core';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import {
  relationLifecycleCollections,
  runRelationLifecycleContractTests
} from '@forge-cms/testing/contracts';
import { D1DatabaseAdapter } from '../../src/d1.adapter.js';

// Spec 064's real-D1 evidence, inside workerd against Miniflare's local D1 (SQLite). Every contender is
// its own `ForgeCmsRuntime` over its own `D1DatabaseAdapter` on the one shared binding — as independent
// as two Worker isolates are from the code's point of view. Each test uses its own table prefix, so the
// per-file D1 storage needs no cleanup. This is local workerd evidence, not production D1.

function runtimeOver(database: D1DatabaseAdapter | object, collections: CollectionDefinition[]) {
  const runtime = new ForgeCmsRuntime({
    env,
    collections,
    adapters: {
      database: database as D1DatabaseAdapter,
      auth: new InMemoryAuthAdapter(),
      storage: new InMemoryStorageAdapter()
    }
  });
  runtime.init();
  return runtime;
}

describe('D1DatabaseAdapter — real local D1 binding: relation lifecycle under independent writers', () => {
  runRelationLifecycleContractTests(async ({ prefix, parties, gate }) => {
    const contenders = [];
    for (let i = 0; i < parties; i++) {
      const runtime = runtimeOver(
        gate.wrap(new D1DatabaseAdapter().init(env), i),
        relationLifecycleCollections(prefix)
      );
      await runtime.syncSchema();
      contenders.push(runtime);
    }
    const raw = runtimeOver(
      new D1DatabaseAdapter().init(env),
      relationLifecycleCollections(prefix)
    );
    await raw.syncSchema();
    return { contenders, database: raw.adapters.database };
  });
});

describe('D1DatabaseAdapter — real local D1 binding: a late database failure rolls back the whole graph', () => {
  it('a trigger failing the last cascaded delete leaves A, B and C in place', async () => {
    const collections = [
      defineCollection({ slug: 'rlf_authors', fields: { name: defineField.text() } }),
      defineCollection({
        slug: 'rlf_posts',
        fields: { author: defineField.relation({ collection: 'rlf_authors', onDelete: 'cascade' }) }
      }),
      defineCollection({
        slug: 'rlf_comments',
        fields: { post: defineField.relation({ collection: 'rlf_posts', onDelete: 'cascade' }) }
      })
    ];
    const runtime = runtimeOver(new D1DatabaseAdapter().init(env), collections);
    await runtime.syncSchema();
    const a = await runtime.create({ collection: 'rlf_authors', data: { name: 'A' } });
    const p = await runtime.create({ collection: 'rlf_posts', data: { author: a.id } });
    const c = await runtime.create({ collection: 'rlf_comments', data: { post: p.id } });
    await env.DB.prepare(
      `CREATE TRIGGER "rlf_fail" BEFORE DELETE ON "rlf_comments" BEGIN SELECT RAISE(ABORT, 'injected'); END`
    ).run();

    await expect(
      runtime.delete({ collection: 'rlf_authors', id: a.id as string })
    ).rejects.toThrow();

    const db = runtime.adapters.database;
    expect(await db.findById('rlf_authors', a.id as string)).not.toBeNull();
    expect(await db.findById('rlf_posts', p.id as string)).not.toBeNull();
    expect(await db.findById('rlf_comments', c.id as string)).not.toBeNull();
    await env.DB.prepare(`DROP TRIGGER "rlf_fail"`).run();
  });
});

describe('D1DatabaseAdapter — real local D1 binding: large relation writes stay under the bound-parameter limit', () => {
  it('a many relation with 200 new ids is validated and committed', async () => {
    const collections = [
      defineCollection({ slug: 'rlb_tags', fields: { label: defineField.text() } }),
      defineCollection({
        slug: 'rlb_posts',
        fields: { tags: defineField.relation({ collection: 'rlb_tags', many: true }) }
      })
    ];
    const runtime = runtimeOver(new D1DatabaseAdapter().init(env), collections);
    await runtime.syncSchema();
    const ids = Array.from({ length: 200 }, (_, i) => `t${i}`);
    for (const id of ids) {
      await runtime.adapters.database.create('rlb_tags', { id, label: id });
    }

    const post = await runtime.create({ collection: 'rlb_posts', data: { tags: ids } });
    expect((post.tags as string[]).length).toBe(200);
    await expect(
      runtime.create({ collection: 'rlb_posts', data: { tags: [...ids, 'ghost'] } })
    ).rejects.toThrow(/'ghost'/);
  });
});
