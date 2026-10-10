import { cpus, platform, arch, release } from 'node:os';
import { describe, expect, it } from 'vitest';
import { handleCreate, handleList } from '@forge-cms/runtime';
import type { ApiContext } from '@forge-cms/api';
import { createRandom, DATASET, FIXTURE_VERSION } from '../src/dataset.js';
import { POPULATE_ID_CHUNK } from '../src/population.js';
import { ADMIN_TOKEN, createFixture } from '../src/fixture.js';
import type { Fixture } from '../src/fixture.js';
import { measure } from '../src/stats.js';
import type { Distribution } from '../src/stats.js';
import { writeReport } from '../src/report.js';

// Spec 089 — the runtime half of the fixed performance fixture. Measures; it does not judge. The budgets in
// ../budgets.json are compared by scripts/quality/performance.mjs after this run, so a regression is a
// reviewable diff against a reviewed number, never a threshold hidden in a test.
//
// Hard invariants that are properties of the design (batching, count/find parity, upload bookkeeping) ARE
// asserted here: they must hold on every machine and need no budget.

const WARMUP = 20;
const ITERATIONS = 200;
const HEAVY_ITERATIONS = 60; // 500-row depth-1 pages
const UPLOAD_ITERATIONS = 100;
const UPLOAD_BYTES = 64 * 1024;
const WORKLOAD_ROUNDS = 6;

type Where = Record<string, unknown>;
const FILTERED: Where = { category: 'news', featured: true };
const NESTED: Where = {
  and: [
    { featured: true },
    { or: [{ views: { gte: 800 } }, { category: 'dev' }] },
    { rank: { lt: 1_500 } }
  ]
};
const MULTI_SORT = [
  { field: 'category', order: 'asc' as const },
  { field: 'views', order: 'desc' as const },
  { field: 'rank', order: 'asc' as const }
];
// The largest `where` the HTTP layer accepts (4096 characters), built only from valid conditions.
const MAX_HTTP_WHERE = ((): string => {
  const or: Where[] = [];
  for (let i = 0; i < 400; i++) {
    or.push({ rank: i * 5 });
    if (JSON.stringify({ or }).length > 4_000) {
      or.pop();
      break;
    }
  }
  return JSON.stringify({ or });
})();

interface Entry {
  group: 'query' | 'count' | 'population' | 'http' | 'upload';
  description: string;
  dbCalls: Record<string, number>;
  dbCallsTotal: number;
  latencyMs: Distribution;
}

const mb = (bytes: number): number => Math.round((bytes / 1024 / 1024) * 10) / 10;

function memory(label: string): { label: string; rssMb: number; heapUsedMb: number } {
  (globalThis as { gc?: () => void }).gc?.();
  const { rss, heapUsed } = process.memoryUsage();
  return { label, rssMb: mb(rss), heapUsedMb: mb(heapUsed) };
}

describe('runtime performance fixture', () => {
  it('measures query, count, population, HTTP list and upload on the fixed dataset', async () => {
    const memorySamples: ReturnType<typeof memory>[] = [];
    const gcExposed = typeof (globalThis as { gc?: unknown }).gc === 'function';

    // Memory: after module load and before any fixture exists; then after the schema exists; then loaded.
    memorySamples.push(memory('process-start'));
    const fixture: Fixture = await createFixture({ load: true });
    try {
      memorySamples.push(memory('fixture-loaded'));
      const { runtime, database, storage } = fixture;
      const posts = (extra: Record<string, unknown> = {}) => ({
        collection: 'posts',
        sort: 'rank',
        ...extra
      });
      const entries: Record<string, Entry> = {};

      async function record(
        name: string,
        group: Entry['group'],
        description: string,
        operation: () => Promise<unknown>,
        iterations = ITERATIONS
      ): Promise<void> {
        database.reset();
        await operation();
        const dbCalls = database.snapshot();
        const dbCallsTotal = database.total();
        const latencyMs = await measure(operation, { warmup: WARMUP, iterations });
        entries[name] = { group, description, dbCalls, dbCallsTotal, latencyMs };
      }

      // --- query ------------------------------------------------------------------------------------
      await record('query.first_page', 'query', 'find posts, sort rank, limit 50, offset 0', () =>
        runtime.find(posts({ limit: 50 }))
      );
      await record(
        'query.later_page',
        'query',
        'find posts, sort rank, limit 50, offset 1500',
        () => runtime.find(posts({ limit: 50, offset: 1_500 }))
      );
      await record(
        'query.filtered',
        'query',
        'find posts where category=news AND featured, limit 50',
        () => runtime.find(posts({ limit: 50, where: FILTERED }))
      );
      await record(
        'query.nested_where',
        'query',
        'find posts, nested and/or (3 levels), limit 50',
        () => runtime.find(posts({ limit: 50, where: NESTED }))
      );
      await record('query.multi_sort', 'query', 'find posts, 3-field sort, limit 50', () =>
        runtime.find({ collection: 'posts', limit: 50, sort: MULTI_SORT })
      );

      // --- count (same predicates as the finds above) -------------------------------------------------
      await record('count.filtered', 'count', 'count posts with the filtered predicate', () =>
        runtime.count({ collection: 'posts', where: FILTERED })
      );
      await record('count.nested_where', 'count', 'count posts with the nested predicate', () =>
        runtime.count({ collection: 'posts', where: NESTED })
      );

      // --- population (depth 1: author + 3 tags + cover) ----------------------------------------------
      await record('population.page_50', 'population', 'find posts depth 1, limit 50', () =>
        runtime.find(posts({ limit: 50, depth: 1 }))
      );
      await record(
        'population.page_500',
        'population',
        'find posts depth 1, limit 500 (the hard maximum)',
        () => runtime.find(posts({ limit: 500, depth: 1 })),
        HEAVY_ITERATIONS
      );
      await record('population.by_id', 'population', 'findByID post depth 1', () =>
        runtime.findByID({ collection: 'posts', id: 'post-00001', depth: 1 })
      );

      // --- HTTP: what the admin list actually requests -------------------------------------------------
      const listRequest = (query: string): ApiContext<unknown> => ({
        request: new Request(`http://forge.test/api/v1/posts?${query}`, {
          headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
        }),
        params: { collection: 'posts' },
        env: undefined
      });
      const httpList = async (query: string) => {
        const response = await handleList(listRequest(query), { runtime, requireAuth: true });
        const body = await response.text();
        if (response.status !== 200)
          throw new Error(`list failed: ${response.status} ${body.slice(0, 200)}`);
        return body;
      };
      await record(
        'http.admin_list_page',
        'http',
        'GET list as the admin: status=all, limit 50, offset 50, sort rank',
        () => httpList('status=all&limit=50&offset=50&sort=rank&order=asc')
      );
      await record('http.admin_filtered_list', 'http', 'GET list with a filter and a sort', () =>
        httpList(`status=all&limit=25&category=news&sort=views&order=desc`)
      );
      await record(
        'http.max_where',
        'http',
        `GET list with the largest accepted where (${MAX_HTTP_WHERE.length} chars)`,
        () => httpList(`where=${encodeURIComponent(MAX_HTTP_WHERE)}&limit=50&sort=rank`)
      );
      const rejected = async () => {
        const deep = '{"and":['.repeat(8) + '{"featured":true}' + ']}'.repeat(8);
        const response = await handleList(listRequest(`where=${encodeURIComponent(deep)}`), {
          runtime
        });
        if (response.status !== 400) throw new Error(`expected 400, got ${response.status}`);
        await response.text();
      };
      await record(
        'http.rejected_deep_where',
        'http',
        'GET list with an over-deep where (rejected 400)',
        rejected
      );
      expect(entries['http.rejected_deep_where']!.dbCallsTotal).toBe(0);

      // --- invariants -----------------------------------------------------------------------------------
      // 1. find and count apply one predicate, on this dataset too.
      for (const [where] of [[FILTERED], [NESTED]] as const) {
        const page = await runtime.find(posts({ limit: 50, where }));
        expect(page.totalDocs).toBe(await runtime.count({ collection: 'posts', where }));
      }
      // 2. Population is batched: one lookup per relation field per 80 DISTINCT targets (D1 allows 100 bound
      //    parameters per statement), however many rows reference them — never one per row.
      const RELATION_FIELDS = ['author', 'tags', 'cover'] as const;
      const expectedLookups = async (limit: number): Promise<number> => {
        const raw = await runtime.find(posts({ limit, depth: 0 }));
        let lookups = 0;
        for (const field of RELATION_FIELDS) {
          const distinct = new Set<string>();
          for (const doc of raw.docs) {
            const value = doc[field];
            for (const id of Array.isArray(value) ? value : [value])
              if (typeof id === 'string') distinct.add(id);
          }
          lookups += Math.ceil(distinct.size / POPULATE_ID_CHUNK);
        }
        return lookups;
      };
      const callsFor = async (limit: number): Promise<Record<string, number>> => {
        database.reset();
        const page = await runtime.find(posts({ limit, depth: 1 }));
        expect(page.docs).toHaveLength(limit);
        return database.snapshot();
      };
      const populationByPageSize: Record<number, Record<string, number>> = {};
      let overBound = 0;
      for (const size of [10, 50, 500]) {
        populationByPageSize[size] = await callsFor(size);
        const expected = 1 + (await expectedLookups(size)); // the page query + the chunked lookups
        overBound = Math.max(overBound, (populationByPageSize[size]!['findMany'] ?? 0) - expected);
        expect(populationByPageSize[size]!['findMany']).toBe(expected);
      }

      // --- upload: the real multipart handler, a fixed payload, InMemory storage -------------------------
      const payload = new Uint8Array(UPLOAD_BYTES);
      const random = createRandom(0xfeed);
      for (let i = 0; i < payload.length; i++) payload[i] = Math.floor(random() * 256);
      const mediaBefore = await runtime.count({ collection: 'media' });
      let uploads = 0;
      const upload = async () => {
        const body = new FormData();
        body.set(
          'file',
          new File([payload], `upload-${uploads++}.bin`, { type: 'application/octet-stream' })
        );
        body.set('alt', 'perf upload');
        const response = await handleCreate(
          {
            request: new Request('http://forge.test/api/v1/media', {
              method: 'POST',
              body,
              headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
            }),
            params: { collection: 'media' },
            env: undefined
          },
          { runtime, requireAuth: true }
        );
        if (response.status !== 201)
          throw new Error(`upload failed: ${response.status} ${await response.text()}`);
        await response.text();
      };
      await record(
        'upload.multipart_64kib',
        'upload',
        `POST multipart ${UPLOAD_BYTES / 1024} KiB through handleCreate (InMemory storage)`,
        upload,
        UPLOAD_ITERATIONS
      );
      // Every upload left exactly: one owning document with correct metadata, one stored object, no intent.
      const expectedUploads = 1 + WARMUP + UPLOAD_ITERATIONS;
      const media = await database.database.findMany({ collection: 'media', limit: 5_000 });
      const uploaded = media.filter(
        (m) =>
          typeof m['_storageKey'] === 'string' && /upload-\d+\.bin$/.test(String(m['filename']))
      );
      expect(await runtime.count({ collection: 'media' })).toBe(mediaBefore + expectedUploads);
      expect(uploaded).toHaveLength(expectedUploads);
      for (const doc of uploaded) {
        expect(doc['filesize']).toBe(UPLOAD_BYTES);
        expect(doc['contentType']).toBe('application/octet-stream');
      }
      const stored = await storage.list('media/');
      expect(new Set(stored.map((o) => o.key))).toEqual(
        new Set(uploaded.map((m) => m['_storageKey']))
      );
      expect(await database.database.findMany({ collection: '_forge_storage_intents' })).toEqual(
        []
      );

      // --- memory: a representative mix, repeated, with garbage collection before each reading ---------
      const mix = async () => {
        for (let i = 0; i < 40; i++) {
          await runtime.find(posts({ limit: 50, depth: 1, offset: (i % 20) * 50 }));
          await runtime.find(posts({ limit: 50, where: NESTED }));
          await runtime.count({ collection: 'posts', where: FILTERED });
          await httpList('status=all&limit=50&offset=0&sort=rank');
        }
      };
      for (let round = 1; round <= WORKLOAD_ROUNDS; round++) {
        await mix();
        memorySamples.push(memory(`after-workload-${round}`));
      }

      const workload = memorySamples.slice(-WORKLOAD_ROUNDS);
      const growth = (key: 'heapUsedMb' | 'rssMb'): number =>
        Math.round((workload.at(-1)![key] - workload[WORKLOAD_ROUNDS / 2 - 1]![key]) * 10) / 10;

      const report = {
        schema: 1,
        fixture: {
          version: FIXTURE_VERSION,
          dataset: DATASET,
          database: 'libSQL (on-disk file)',
          storage: 'in-memory'
        },
        environment: {
          node: process.version,
          os: `${platform()} ${release()}`,
          arch: arch(),
          cpu: cpus()[0]?.model ?? 'unknown',
          cpuCount: cpus().length,
          ci: process.env['CI'] === 'true',
          gcExposed,
          buildMode: 'dist (compiled @forge-cms/* packages)'
        },
        method: {
          warmup: WARMUP,
          iterations: ITERATIONS,
          heavyIterations: HEAVY_ITERATIONS,
          uploadIterations: UPLOAD_ITERATIONS,
          uploadBytes: UPLOAD_BYTES,
          clock: 'performance.now()',
          percentile: 'nearest-rank'
        },
        operations: entries,
        populationByPageSize,
        invariants: {
          // 0 = every page issued exactly 1 page query + ceil(distinct targets / 80) lookups per relation field.
          populationCallsOverBound: overBound
        },
        memory: {
          afterFixtureLoad: memorySamples[1],
          afterWorkload: memorySamples.at(-1),
          samples: memorySamples,
          // Growth across the last half of the repetitions of the same mix: a steady state shows ~0, a
          // leak keeps climbing. RSS includes native allocator behaviour, so it is a ceiling, not a trend.
          heapGrowthMb: growth('heapUsedMb'),
          rssGrowthMb: growth('rssMb')
        }
      };
      writeReport('runtime.json', report);
    } finally {
      fixture.dispose();
    }
  }, 300_000);
});
