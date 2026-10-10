import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import type { DatabaseAdapter } from '@forge-cms/db';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from './runtime.js';
import { MAX_LIMIT, handleList } from './handlers.js';

// Spec 089 — the amount of database work an operation performs is a contract, not an accident:
//   * relation population is BATCHED: one query per relation field, however many rows are returned
//     (no N+1), with a fixed ceiling for a whole page;
//   * structurally invalid or over-limit queries are rejected before ANY database call;
//   * valid bounded queries cost a fixed number of calls, independent of how wide the query is.
// Calls are counted at the adapter boundary with a test-only proxy; there is no production telemetry.

type Calls = Record<string, number>;

function counting(database: DatabaseAdapter) {
  const calls: Calls = {};
  const args: Record<string, unknown[][]> = {};
  const proxy = new Proxy(database, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== 'function' || typeof property !== 'string') return value;
      return (...a: unknown[]) => {
        calls[property] = (calls[property] ?? 0) + 1;
        (args[property] ??= []).push(a);
        return (value as (...x: unknown[]) => unknown).apply(target, a);
      };
    }
  });
  const reset = () => {
    for (const key of Object.keys(calls)) delete calls[key];
    for (const key of Object.keys(args)) delete args[key];
  };
  const total = () => Object.values(calls).reduce((sum, n) => sum + n, 0);
  return { proxy, calls, args, reset, total };
}

const authors = defineCollection({
  slug: 'authors',
  access: { read: () => true },
  fields: {
    name: defineField.text({ required: true }),
    favorite: defineField.relation({ collection: 'posts' }) // a cycle: posts -> authors -> posts
  }
});
const tags = defineCollection({
  slug: 'tags',
  access: { read: () => true },
  fields: { label: defineField.text({ required: true }) }
});
const media = defineCollection({
  slug: 'media',
  upload: true,
  access: { read: () => true },
  fields: { alt: defineField.text() }
});
const posts = defineCollection({
  slug: 'posts',
  access: { read: () => true },
  fields: {
    title: defineField.text({ required: true }),
    rank: defineField.number(),
    featured: defineField.boolean(),
    author: defineField.relation({ collection: 'authors' }),
    tags: defineField.relation({ collection: 'tags', many: true }),
    cover: defineField.upload({ collection: 'media' })
  }
});

async function seed(postCount: number) {
  const inner = new InMemoryDatabaseAdapter();
  const db = counting(inner);
  const runtime = new ForgeCmsRuntime({
    collections: [authors, tags, media, posts],
    adapters: {
      database: db.proxy,
      auth: new InMemoryAuthAdapter(),
      storage: new InMemoryStorageAdapter()
    }
  });
  runtime.init();
  await runtime.syncSchema();

  const authorIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    authorIds.push(
      (await runtime.create({ collection: 'authors', data: { name: `a${i}` } })).id as string
    );
  }
  const tagIds: string[] = [];
  for (let i = 0; i < 20; i++) {
    tagIds.push(
      (await runtime.create({ collection: 'tags', data: { label: `t${i}` } })).id as string
    );
  }
  const coverId = (await runtime.create({ collection: 'media', data: { alt: 'c' } })).id as string;
  for (let i = 0; i < postCount; i++) {
    await runtime.create({
      collection: 'posts',
      data: {
        title: `p${i}`,
        rank: i,
        featured: i % 2 === 0,
        author: authorIds[i % authorIds.length]!,
        tags: [tagIds[i % tagIds.length]!, tagIds[(i + 7) % tagIds.length]!],
        cover: coverId
      }
    });
  }
  db.reset();
  return { runtime, db, authorIds };
}

describe('relation population is batched (no N+1)', () => {
  it('a depth-1 page costs the same number of database calls for 10 rows as for 100', async () => {
    const small = await seed(10);
    const large = await seed(100);

    await small.runtime.find({ collection: 'posts', depth: 1, limit: 10 });
    await large.runtime.find({ collection: 'posts', depth: 1, limit: 100 });

    // posts page + count + exactly ONE lookup per relation/upload field (author, tags, cover).
    expect(small.db.calls).toEqual({ findMany: 4, count: 1 });
    expect(large.db.calls).toEqual(small.db.calls);
  });

  it('batches by id: each lookup is a single `id in (…)` carrying every distinct target at once', async () => {
    const { runtime, db } = await seed(100);
    await runtime.find({ collection: 'posts', depth: 1, limit: 100 });

    const lookups = (db.args['findMany'] ?? []).slice(1) as Array<
      [{ collection: string; where: { id: { in: string[] } } }]
    >;
    expect(lookups.map(([o]) => o.collection).sort()).toEqual(['authors', 'media', 'tags']);
    for (const [options] of lookups) {
      const ids = options.where.id.in;
      expect(new Set(ids).size).toBe(ids.length); // de-duplicated: 100 posts share 5 authors / 20 tags / 1 cover
    }
    const sizes = Object.fromEntries(lookups.map(([o]) => [o.collection, o.where.id.in.length]));
    expect(sizes).toEqual({ authors: 5, tags: 20, media: 1 });
  });

  it('a single document at depth 1 is one read plus one lookup per relation field', async () => {
    const { runtime, db } = await seed(30);
    const [first] = (await runtime.find({ collection: 'posts', limit: 1 })).docs;
    db.reset();
    await runtime.findByID({ collection: 'posts', id: first!.id as string, depth: 1 });
    expect(db.calls).toEqual({ findById: 1, findMany: 3 });
  });

  it('depth 0 populates nothing and costs only the page and its count', async () => {
    const { runtime, db } = await seed(50);
    await runtime.find({ collection: 'posts', depth: 0, limit: 50 });
    expect(db.calls).toEqual({ findMany: 1, count: 1 });
  });

  it('depth 1 does not recurse through a relation cycle: the same fixed cost with cyclic data', async () => {
    const { runtime, db, authorIds } = await seed(20);
    const [anyPost] = (await runtime.find({ collection: 'posts', limit: 1 })).docs;
    for (const id of authorIds) {
      await runtime.update({ collection: 'authors', id, data: { favorite: anyPost!.id } });
    }
    db.reset();
    const page = await runtime.find({ collection: 'posts', depth: 1, limit: 20 });
    expect(db.calls).toEqual({ findMany: 4, count: 1 });
    // One level only: the populated author still carries the raw id of its own relation.
    const author = page.docs[0]!.author as unknown as { favorite: unknown };
    expect(typeof author.favorite).toBe('string');
  });

  it('an untrusted caller pays a bounded, row-count-independent overhead for access-checked population', async () => {
    const small = await seed(10);
    const large = await seed(100);
    await small.runtime.find({
      collection: 'posts',
      depth: 1,
      limit: 10,
      overrideAccess: false,
      user: null
    });
    await large.runtime.find({
      collection: 'posts',
      depth: 1,
      limit: 100,
      overrideAccess: false,
      user: null
    });
    expect(large.db.calls).toEqual(small.db.calls);
    expect(large.db.total()).toBeLessThanOrEqual(8);
  });
});

describe('find and count share one predicate', () => {
  it('the filter that selects the page is the filter that counts it', async () => {
    const { runtime, db } = await seed(40);
    const where = {
      and: [{ featured: true }, { or: [{ rank: { gte: 10 } }, { title: { contains: 'p1' } }] }]
    };
    const page = await runtime.find({
      collection: 'posts',
      where,
      limit: 5,
      sort: [{ field: 'rank', order: 'desc' }]
    });

    const [findOptions] = db.args['findMany']![0] as [{ where: unknown }];
    const [, countWhere] = db.args['count']![0] as [string, unknown];
    expect(countWhere).toEqual(findOptions.where);
    expect(page.totalDocs).toBe(await runtime.count({ collection: 'posts', where }));
    expect(page.docs).toHaveLength(5);
  });
});

describe('query work is bounded before and during execution', () => {
  async function http(runtime: ForgeCmsRuntime, query: string) {
    return handleList(
      {
        request: new Request(`http://x/api/v1/posts?${query}`),
        params: { collection: 'posts' },
        env: undefined
      },
      { runtime }
    );
  }
  const nested = (levels: number): Record<string, unknown> => {
    let node: Record<string, unknown> = { featured: true };
    for (let i = 0; i < levels; i++) node = { and: [node] };
    return node;
  };

  it('rejects structurally invalid queries with zero database calls', async () => {
    const { runtime, db } = await seed(5);
    const invalid: unknown[] = [
      { and: [] },
      { or: 'x' },
      { and: [1] },
      { and: [[]] },
      { rank: { eq: 1, bogus: 2 } },
      { nope: 1 },
      nested(7)
    ];
    for (const where of invalid) {
      await expect(
        runtime.find({ collection: 'posts', where: where as never })
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        runtime.count({ collection: 'posts', where: where as never })
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(db.total()).toBe(0);
  });

  it('accepts the deepest legal nesting at a fixed cost of one page query and one count', async () => {
    const { runtime, db } = await seed(5);
    await runtime.find({ collection: 'posts', where: nested(6) as never });
    expect(db.calls).toEqual({ findMany: 1, count: 1 });
  });

  it('a wide valid query costs the same two calls as a narrow one, and validates quickly', async () => {
    const { runtime, db } = await seed(5);
    const wide = { or: Array.from({ length: 2_000 }, (_, i) => ({ rank: i })) };
    const started = performance.now();
    await runtime.find({ collection: 'posts', where: wide as never });
    const elapsed = performance.now() - started;
    expect(db.calls).toEqual({ findMany: 1, count: 1 });
    expect(elapsed).toBeLessThan(2_000); // generous: this only catches super-linear validation, not drift
  });

  it('an over-long `where`, an over-large limit and a bad offset never reach the database over HTTP', async () => {
    const { runtime, db } = await seed(5);
    const tooLong = encodeURIComponent(
      JSON.stringify({ or: Array.from({ length: 600 }, (_, i) => ({ rank: i })) })
    );
    expect(decodeURIComponent(tooLong).length).toBeGreaterThan(4096);
    for (const query of [`where=${tooLong}`, `limit=${MAX_LIMIT + 1}`, 'offset=-1', 'limit=1e3']) {
      expect((await http(runtime, query)).status).toBe(400);
    }
    expect(db.total()).toBe(0);
  });

  it('the largest legal page is bounded by MAX_LIMIT rows', async () => {
    const { runtime } = await seed(MAX_LIMIT + 20);
    const response = await http(runtime, `limit=${MAX_LIMIT}`);
    const body = (await response.json()) as { data: unknown[]; meta: { totalDocs: number } };
    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(MAX_LIMIT);
    expect(body.meta.totalDocs).toBe(MAX_LIMIT + 20);
  });

  it('a very long multi-field sort is validated per field without extra database calls', async () => {
    const { runtime, db } = await seed(5);
    const sort = Array.from({ length: 200 }, (_, i) => ({
      field: (i % 2 === 0 ? 'rank' : 'title') as 'rank' | 'title',
      order: 'asc' as const
    }));
    await runtime.find({ collection: 'posts', sort });
    expect(db.calls).toEqual({ findMany: 1, count: 1 });
    await expect(
      runtime.find({
        collection: 'posts',
        sort: [...sort, { field: 'nope' as never, order: 'asc' }]
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(db.calls).toEqual({ findMany: 1, count: 1 }); // the invalid one added nothing
  });
});
