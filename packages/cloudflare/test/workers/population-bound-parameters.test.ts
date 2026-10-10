import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { D1DatabaseAdapter } from '../../src/d1.adapter.js';

// Spec 089 regression, on real (local) D1: D1 allows 100 bound parameters per statement. A depth-1 page whose
// rows reference more than 100 DISTINCT targets used to send one `id in (…)` of that size and fail with
// "too many SQL variables" (a 500 over HTTP). Population now chunks the id lookup.

const tags = defineCollection({
  slug: 'pbp_tags',
  access: { read: () => true },
  fields: { label: defineField.text() }
});
const posts = defineCollection({
  slug: 'pbp_posts',
  access: { read: () => true },
  fields: {
    title: defineField.text(),
    tags: defineField.relation({ collection: 'pbp_tags', many: true })
  }
});

it('populates a page referencing 150 distinct targets on D1', async () => {
  const runtime = new ForgeCmsRuntime({
    env,
    collections: [tags, posts],
    adapters: {
      database: new D1DatabaseAdapter().init(env),
      auth: new InMemoryAuthAdapter(),
      storage: new InMemoryStorageAdapter()
    }
  });
  runtime.init();
  await runtime.syncSchema();
  const ids: string[] = [];
  for (let i = 0; i < 150; i++) {
    ids.push(
      (await runtime.create({ collection: 'pbp_tags', data: { label: `t${i}` } })).id as string
    );
  }
  for (let i = 0; i < 50; i++) {
    await runtime.create({
      collection: 'pbp_posts',
      data: { title: `p${i}`, tags: [ids[i * 3]!, ids[i * 3 + 1]!, ids[i * 3 + 2]!] }
    });
  }

  for (const overrideAccess of [true, false] as const) {
    const page = await runtime.find({
      collection: 'pbp_posts',
      depth: 1,
      limit: 50,
      overrideAccess
    });
    expect(page.docs).toHaveLength(50);
    for (const doc of page.docs) {
      expect(
        (doc.tags as unknown as Array<{ label: string }>).every((t) => /^t\d+$/.test(t.label))
      ).toBe(true);
      expect(doc.tags as unknown[]).toHaveLength(3);
    }
  }
});
