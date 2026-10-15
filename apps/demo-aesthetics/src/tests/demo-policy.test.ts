/**
 * Spec 098: the shared public demo's mutation allowlist, its global daily budget, and the protection
 * of the seeded content. No Cloudflare account is involved: the D1 budget runs its real SQL against
 * `node:sqlite` behind a D1-shaped shim, and the middleware runs inside an in-process h3 app.
 */
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { createApp, defineEventHandler, toWebHandler } from 'h3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@forge-cms/cloudflare';
import {
  MAX_DOCUMENTS,
  MAX_PRUNE_PER_WRITE,
  PUBLIC_DAILY_BUDGETS,
  PUBLIC_MAX_BODY_BYTES,
  SEEDED_DOCUMENTS,
  resetThrottle
} from '../server/api/demo-limits';
import {
  D1BudgetStore,
  MemoryBudgetStore,
  decide,
  resetMemoryBudget,
  resolveDemoMode
} from '../server/api/demo-policy';
import { createRuntime, type DemoRuntime } from '../server/api/runtime';
import { seedContent } from '../server/api/seed';
import { migrations } from '../server/api/migrations';
import demoGuard from '../server/middleware/demo-guard';

// `node:sqlite` is prefix-only; Vite's resolver strips the prefix and fails, so load it natively.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

// --- A D1-shaped shim over a real SQLite -----------------------------------------------------------

interface Shim {
  db: D1Database;
  sqlite: DatabaseSyncType;
  /** Statements prepared against the database: what a request would cost in D1 round trips. */
  calls: string[];
}

function d1Shim(createBudgetTable = true): Shim {
  const sqlite = new DatabaseSync(':memory:');
  const calls: string[] = [];
  if (createBudgetTable) {
    const migration = migrations.find((m) => m.id === '20261015_001_demo_budget');
    for (const statement of migration?.statements ?? []) sqlite.exec(statement.sql);
  }
  const db = {
    prepare(query: string) {
      calls.push(query);
      const statement = sqlite.prepare(query);
      let values: unknown[] = [];
      const bound = {
        bind(...next: unknown[]) {
          values = next;
          return bound;
        },
        async first() {
          return (statement.get(...(values as never[])) as unknown) ?? null;
        },
        async run() {
          statement.run(...(values as never[]));
          return { results: [], success: true };
        },
        async all() {
          return { results: statement.all(...(values as never[])), success: true };
        }
      };
      return bound;
    }
  } as unknown as D1Database;
  return { db, sqlite, calls };
}

const rows = (shim: Shim): { bucket: string; used: number }[] =>
  shim.sqlite.prepare('SELECT bucket, used FROM demo_budget ORDER BY bucket').all() as never;

const DAY = new Date('2026-10-15T12:00:00Z');

// --- The allowlist ---------------------------------------------------------------------------------

describe('public demo allowlist', () => {
  const allowed: [string, string, string][] = [
    ['POST', '/api/auth/login', 'AUTH_LOGIN'],
    ['POST', '/api/auth/logout', 'PASS'],
    ['POST', '/api/analytics/collect', 'ANALYTICS_COLLECT'],
    ['POST', '/api/site/bookings', 'BOOKING_CREATE'],
    ['PUT', '/api/v1/notices/abc123', 'CONTENT_UPDATE'],
    ['PUT', '/api/v1/notices/abc123?locale=es', 'CONTENT_UPDATE']
  ];
  it.each(allowed)('allows %s %s as %s', (method, path, cls) => {
    expect(decide(method, path)).toEqual({ action: 'allow', cls });
  });

  const denied: [string, string, string][] = [
    ['POST', '/api/v1/media', 'demo_uploads_disabled'],
    ['DELETE', '/api/v1/notices/abc', 'demo_delete_disabled'],
    ['DELETE', '/api/v1/services/abc', 'demo_delete_disabled'],
    ['POST', '/api/v1/notices', 'demo_create_disabled'],
    ['POST', '/api/v1/services', 'demo_create_disabled'],
    ['PUT', '/api/v1/services/abc', 'demo_read_only'],
    ['PUT', '/api/v1/site_settings/abc', 'demo_read_only'],
    ['PUT', '/api/v1/notices/abc/extra', 'demo_read_only'],
    ['POST', '/api/auth/signup', 'demo_accounts_disabled'],
    ['POST', '/api/auth/users', 'demo_accounts_disabled'],
    ['PUT', '/api/auth/users/1', 'demo_accounts_disabled'],
    ['DELETE', '/api/auth/users/1', 'demo_accounts_disabled'],
    ['PUT', '/api/site/bookings', 'demo_read_only'],
    ['POST', '/api/anything-new', 'demo_read_only']
  ];
  it.each(denied)('refuses %s %s with %s', (method, path, code) => {
    expect(decide(method, path)).toMatchObject({ action: 'deny', status: 403, code });
  });

  it('only ever answers visitors in plain sentences', () => {
    for (const [method, path] of denied) {
      const decision = decide(method, path);
      if (decision.action === 'deny') {
        expect(decision.message).not.toMatch(/cloudflare|d1|r2|quota|billing|stack/i);
      }
    }
  });

  it('is public only by explicit flag', () => {
    expect(resolveDemoMode(undefined)).toBe('full');
    expect(resolveDemoMode({})).toBe('full');
    expect(resolveDemoMode({ FORGE_PUBLIC_DEMO: '0' })).toBe('full');
    expect(resolveDemoMode({ FORGE_PUBLIC_DEMO: 'true' })).toBe('full');
    expect(resolveDemoMode({ FORGE_PUBLIC_DEMO: '1' })).toBe('public');
  });
});

// --- The global budget -----------------------------------------------------------------------------

describe.each([
  ['memory', () => ({ store: new MemoryBudgetStore() })],
  [
    'D1 (real SQL)',
    () => {
      const shim = d1Shim();
      return { store: new D1BudgetStore(shim.db), shim };
    }
  ]
])('daily budget — %s', (_name, make) => {
  it('allows exactly N and refuses N+1', async () => {
    const { store } = make();
    const limit = 7;
    const results = [];
    for (let i = 0; i < limit + 3; i += 1) {
      results.push(await store.consume('CONTENT_UPDATE', limit, DAY));
    }
    expect(results.filter((r) => r.allowed)).toHaveLength(limit);
    expect(results.slice(limit).every((r) => !r.allowed && r.reason === 'exhausted')).toBe(true);
  });

  it('holds under 20 simultaneous callers racing for the last slots', async () => {
    const { store } = make();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => store.consume('BOOKING_CREATE', 5, DAY))
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });

  it('keeps classes in separate buckets', async () => {
    const { store } = make();
    for (let i = 0; i < 3; i += 1) await store.consume('CONTENT_UPDATE', 3, DAY);
    expect((await store.consume('CONTENT_UPDATE', 3, DAY)).allowed).toBe(false);
    expect((await store.consume('BOOKING_CREATE', 3, DAY)).allowed).toBe(true);
  });

  it('starts a new budget on the next UTC day', async () => {
    const { store } = make();
    await store.consume('CONTENT_UPDATE', 1, DAY);
    expect((await store.consume('CONTENT_UPDATE', 1, DAY)).allowed).toBe(false);
    expect(
      (await store.consume('CONTENT_UPDATE', 1, new Date('2026-10-16T00:00:01Z'))).allowed
    ).toBe(true);
  });

  it('reports what is left without writing', async () => {
    const { store } = make();
    await store.consume('CONTENT_UPDATE', PUBLIC_DAILY_BUDGETS.CONTENT_UPDATE, DAY);
    const remaining = await store.remaining(DAY);
    expect(remaining?.CONTENT_UPDATE).toBe(PUBLIC_DAILY_BUDGETS.CONTENT_UPDATE - 1);
    expect(remaining?.BOOKING_CREATE).toBe(PUBLIC_DAILY_BUDGETS.BOOKING_CREATE);
  });
});

describe('D1 budget — storage properties', () => {
  it('is atomic: one statement per allowed call, never read-then-write', async () => {
    const shim = d1Shim();
    const store = new D1BudgetStore(shim.db);
    await store.consume('CONTENT_UPDATE', 5, DAY);
    expect(shim.calls.filter((q) => /^\s*INSERT/i.test(q))).toHaveLength(1);
    expect(shim.calls.some((q) => /^\s*SELECT/i.test(q))).toBe(false);
  });

  it('spends no D1 once a bucket is known exhausted', async () => {
    const shim = d1Shim();
    const store = new D1BudgetStore(shim.db);
    await store.consume('CONTENT_UPDATE', 2, DAY);
    await store.consume('CONTENT_UPDATE', 2, DAY);
    shim.calls.length = 0;
    for (let i = 0; i < 50; i += 1) await store.consume('CONTENT_UPDATE', 2, DAY);
    expect(shim.calls).toHaveLength(0);
  });

  it('refuses without writing when a second isolate finds the bucket already full', async () => {
    const shim = d1Shim();
    await new D1BudgetStore(shim.db).consume('CONTENT_UPDATE', 1, DAY);
    const other = new D1BudgetStore(shim.db);
    expect(await other.consume('CONTENT_UPDATE', 1, DAY)).toEqual({
      allowed: false,
      reason: 'exhausted'
    });
    expect(rows(shim)).toEqual([{ bucket: '2026-10-15:CONTENT_UPDATE', used: 1 }]);
  });

  it('stores only a bucket name and a counter, and stays bounded across days', async () => {
    const shim = d1Shim();
    const store = new D1BudgetStore(shim.db);
    for (let day = 1; day <= 30; day += 1) {
      const when = new Date(Date.UTC(2026, 9, day, 9));
      await store.consume('CONTENT_UPDATE', 5, when);
      await store.consume('BOOKING_CREATE', 5, when);
    }
    const left = rows(shim);
    // Today's two buckets; yesterday's (pruned when today's first call ran) are gone.
    expect(left.length).toBeLessThanOrEqual(2);
    expect(Object.keys(left[0] ?? {}).sort()).toEqual(['bucket', 'used']);
    expect(left.every((row) => /^\d{4}-\d{2}-\d{2}:[A-Z_]+$/.test(row.bucket))).toBe(true);
  });

  it('fails closed when the table is missing or D1 errors', async () => {
    const missing = new D1BudgetStore(d1Shim(false).db);
    expect(await missing.consume('CONTENT_UPDATE', 5, DAY)).toEqual({
      allowed: false,
      reason: 'unavailable'
    });
    expect(await missing.remaining(DAY)).toBeNull();
  });

  it('treats a zero limit as closed', async () => {
    const shim = d1Shim();
    expect((await new D1BudgetStore(shim.db).consume('CONTENT_UPDATE', 0, DAY)).allowed).toBe(
      false
    );
    expect(shim.calls).toHaveLength(0);
  });
});

// --- The middleware --------------------------------------------------------------------------------

function appWith(env: Record<string, unknown> | undefined) {
  const app = createApp();
  app.use(
    defineEventHandler((event) => {
      if (env) event.context['cloudflare'] = { env };
    })
  );
  app.use(demoGuard);
  app.use(defineEventHandler(() => ({ ok: true })));
  const handle = toWebHandler(app);
  return (
    method: string,
    path: string,
    options: { body?: string; headers?: Record<string, string> } = {}
  ) => {
    const body = options.body ?? (method === 'GET' ? undefined : '{}');
    return handle(
      new Request(`http://demo.test${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(body !== undefined && { 'content-length': String(body.length) }),
          ...options.headers
        },
        ...(body !== undefined && { body })
      })
    );
  };
}

describe('public demo middleware', () => {
  beforeEach(() => {
    resetThrottle();
    resetMemoryBudget();
  });

  const publicEnv = { FORGE_PUBLIC_DEMO: '1' };

  it('lets a visitor edit a notice, and nothing else', async () => {
    const call = appWith(publicEnv);
    expect((await call('PUT', '/api/v1/notices/n1')).status).toBe(200);
    expect((await call('POST', '/api/auth/login')).status).toBe(200);
    expect((await call('POST', '/api/site/bookings')).status).toBe(200);
    expect((await call('POST', '/api/analytics/collect')).status).toBe(200);
    expect((await call('GET', '/api/v1/services')).status).toBe(200);
  });

  it.each([
    ['DELETE', '/api/v1/services/s1', 'demo_delete_disabled'],
    ['POST', '/api/v1/services', 'demo_create_disabled'],
    ['POST', '/api/v1/media', 'demo_uploads_disabled'],
    ['PUT', '/api/v1/site_settings/x', 'demo_read_only'],
    ['POST', '/api/auth/signup', 'demo_accounts_disabled'],
    ['POST', '/api/auth/users', 'demo_accounts_disabled']
  ])('answers %s %s with 403 %s', async (method, path, code) => {
    const response = await appWith(publicEnv)(method, path);
    expect(response.status).toBe(403);
    const body = (await response.json()) as { data: { code: string; demo: boolean } };
    expect(body.data).toMatchObject({ code, demo: true });
  });

  it('refuses an upload before reading it, whatever the size', async () => {
    const response = await appWith(publicEnv)('POST', '/api/v1/media', {
      headers: { 'content-type': 'multipart/form-data; boundary=x' }
    });
    expect(response.status).toBe(403);
  });

  it('answers 413 to a body over the public cap, or with no declared length', async () => {
    const call = appWith(publicEnv);
    const big = 'x'.repeat(PUBLIC_MAX_BODY_BYTES + 1);
    expect((await call('PUT', '/api/v1/notices/n1', { body: big })).status).toBe(413);

    const app = createApp();
    app.use(defineEventHandler((e) => void (e.context['cloudflare'] = { env: publicEnv })));
    app.use(demoGuard);
    app.use(defineEventHandler(() => ({ ok: true })));
    const noLength = await toWebHandler(app)(
      new Request('http://demo.test/api/v1/notices/n1', { method: 'PUT' })
    );
    expect(noLength.status).toBe(413);
  });

  it('stops one IP with 429 before it can spend the shared budget', async () => {
    const call = appWith(publicEnv);
    const statuses: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      statuses.push(
        (await call('PUT', '/api/v1/notices/n1', { headers: { 'cf-connecting-ip': '9.9.9.9' } }))
          .status
      );
    }
    expect(statuses.filter((s) => s === 200)).toHaveLength(6);
    expect(statuses.at(-1)).toBe(429);
    // Another visitor is unaffected.
    expect(
      (await call('PUT', '/api/v1/notices/n1', { headers: { 'cf-connecting-ip': '8.8.8.8' } }))
        .status
    ).toBe(200);
  });

  afterEach(() => vi.useRealTimers());

  it('fails closed with 429 once the global content budget is spent, and reads keep working', async () => {
    // The per-isolate limiter resets every minute; only the shared budget can stop this at scale.
    vi.useFakeTimers({ toFake: ['Date'], now: DAY });
    const shim = d1Shim();
    const call = appWith({ ...publicEnv, DB: shim.db });
    let allowed = 0;
    let refused: Response | undefined;
    // Many visitors, each politely under their own limit: only the shared budget can stop this.
    for (let i = 0; i < PUBLIC_DAILY_BUDGETS.CONTENT_UPDATE + 10; i += 1) {
      if (i % 40 === 0) vi.setSystemTime(new Date(DAY.getTime() + (i / 40) * 61_000));
      const response = await call('PUT', '/api/v1/notices/n1', {
        headers: { 'cf-connecting-ip': `10.0.${Math.floor(i / 200)}.${i % 200}` }
      });
      if (response.status === 200) allowed += 1;
      else refused ??= response;
    }
    expect(allowed).toBe(PUBLIC_DAILY_BUDGETS.CONTENT_UPDATE);
    expect(refused?.status).toBe(429);
    expect(((await refused?.json()) as { data: { code: string } }).data.code).toBe(
      'demo_budget_exhausted'
    );

    // Blocked attempts cost no D1 at all, and browsing is unaffected.
    shim.calls.length = 0;
    expect(
      (await call('PUT', '/api/v1/notices/n1', { headers: { 'cf-connecting-ip': '7.7.7.7' } }))
        .status
    ).toBe(429);
    expect(shim.calls).toHaveLength(0);
    expect((await call('GET', '/api/v1/notices')).status).toBe(200);
    expect((await call('GET', '/api/site/home')).status).toBe(200);
  });

  it('budgets bookings separately from notice edits', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: DAY });
    const shim = d1Shim();
    const call = appWith({ ...publicEnv, DB: shim.db });
    for (let i = 0; i < PUBLIC_DAILY_BUDGETS.BOOKING_CREATE + 2; i += 1) {
      if (i % 20 === 0) vi.setSystemTime(new Date(DAY.getTime() + (i / 20) * 61_000));
      await call('POST', '/api/site/bookings', {
        headers: { 'cf-connecting-ip': `10.1.${Math.floor(i / 200)}.${i % 200}` }
      });
    }
    const booking = await call('POST', '/api/site/bookings', {
      headers: { 'cf-connecting-ip': '10.9.9.9' }
    });
    expect(booking.status).toBe(429);
    expect(
      (await call('PUT', '/api/v1/notices/n1', { headers: { 'cf-connecting-ip': '10.9.9.9' } }))
        .status
    ).toBe(200);
  });

  it('answers 503 when the budget table is unavailable', async () => {
    const call = appWith({ ...publicEnv, DB: d1Shim(false).db });
    const response = await call('PUT', '/api/v1/notices/n1');
    expect(response.status).toBe(503);
    expect(((await response.json()) as { data: { code: string } }).data.code).toBe(
      'demo_budget_unavailable'
    );
  });

  it('keeps analytics, content and login in separate limiters', async () => {
    const call = appWith(publicEnv);
    const headers = { 'cf-connecting-ip': '5.5.5.5' };
    for (let i = 0; i < 30; i += 1) await call('POST', '/api/analytics/collect', { headers });
    expect((await call('POST', '/api/analytics/collect', { headers })).status).toBe(200);
    expect((await call('PUT', '/api/v1/notices/n1', { headers })).status).toBe(200);
    expect((await call('POST', '/api/auth/login', { headers })).status).toBe(200);
  });

  it('throttles script-grade API reads but never the public site or the probe', async () => {
    const call = appWith(publicEnv);
    const headers = { 'cf-connecting-ip': '4.4.4.4' };
    let limited = false;
    for (let i = 0; i < 200; i += 1) {
      if ((await call('GET', '/api/v1/services', { headers })).status === 429) limited = true;
    }
    expect(limited).toBe(true);
    expect((await call('GET', '/api/site/home', { headers })).status).toBe(200);
    expect((await call('GET', '/api/status', { headers })).status).toBe(200);
  });
});

describe('full mode keeps the whole dogfood', () => {
  beforeEach(() => resetThrottle());

  it.each([
    ['DELETE', '/api/v1/services/s1'],
    ['POST', '/api/v1/services'],
    ['POST', '/api/v1/media'],
    ['PUT', '/api/v1/site_settings/x']
  ])('lets %s %s through', async (method, path) => {
    expect((await appWith(undefined)(method, path)).status).toBe(200);
    resetThrottle();
  });

  it('still freezes accounts and throttles generic writes', async () => {
    const call = appWith({});
    expect((await call('POST', '/api/auth/users')).status).toBe(403);
    const statuses: number[] = [];
    for (let i = 0; i < 15; i += 1)
      statuses.push((await call('PUT', '/api/v1/services/s1')).status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(12);
    expect(statuses.at(-1)).toBe(429);
  });
});

// --- Seed protection and pruning ---------------------------------------------------------------------

describe('canonical seed content', () => {
  let cms: DemoRuntime;

  beforeEach(async () => {
    cms = createRuntime(undefined, { devMode: true });
    await cms.syncSchema();
    await seedContent(cms);
  });

  it('SEEDED_DOCUMENTS matches what the seed really creates', async () => {
    for (const [slug, expected] of Object.entries(SEEDED_DOCUMENTS)) {
      expect(await cms.count({ collection: slug as 'services' }), slug).toBe(expected);
    }
  });

  it('never prunes a seeded document, however many are created', async () => {
    const seeded = await cms.find({
      collection: 'media',
      sort: 'created_at',
      order: 'asc',
      limit: 100,
      status: 'all'
    });
    const canonical = seeded.docs.slice(0, SEEDED_DOCUMENTS.media).map((d) => d.id);
    expect(canonical).toHaveLength(SEEDED_DOCUMENTS.media ?? -1);

    const ceiling = MAX_DOCUMENTS.media ?? 0;
    for (let i = 0; i < ceiling + 20; i += 1) {
      await cms.create({
        collection: 'media',
        data: {
          filename: `extra-${i}.svg`,
          alt: 'Extra',
          url: `/images/extra-${i}.svg`,
          contentType: 'image/svg+xml',
          filesize: 0
        }
      });
    }

    const after = await cms.find({ collection: 'media', limit: 200, status: 'all' });
    const ids = new Set(after.docs.map((d) => d.id));
    for (const id of canonical) expect(ids.has(id)).toBe(true);
    expect(after.docs).toHaveLength(ceiling);
  });

  it('prunes disposable bookings first and keeps the seeded notices through any volume', async () => {
    const ceiling = MAX_DOCUMENTS.bookings ?? 0;
    for (let i = 0; i < ceiling + 30; i += 1) {
      await cms.create({
        collection: 'bookings',
        data: { name: `V${i}`, email: `v${i}@example.com`, preferredDate: new Date() }
      });
    }
    expect(await cms.count({ collection: 'bookings' })).toBe(ceiling);
    const newest = await cms.find({
      collection: 'bookings',
      where: { name: { eq: `V${ceiling + 29}` } },
      status: 'all'
    });
    expect(newest.docs).toHaveLength(1);
    expect(await cms.count({ collection: 'notices' })).toBe(SEEDED_DOCUMENTS.notices);
  });

  it('prunes at most a handful per write, so one create cannot fan out into many deletes', async () => {
    const ceiling = MAX_DOCUMENTS.testimonials ?? 0;
    const before = await cms.count({ collection: 'testimonials' });
    for (let i = 0; i < ceiling - before + 12; i += 1) {
      await cms.create({
        collection: 'testimonials',
        data: { author: `V${i}`, quote: 'Lovely', rating: 5, _status: 'published' }
      });
    }
    expect(MAX_PRUNE_PER_WRITE).toBeLessThanOrEqual(5);
    expect(await cms.count({ collection: 'testimonials' })).toBe(ceiling);
  });

  it('still refuses to drop a collection below its floor', async () => {
    const { docs } = await cms.find({ collection: 'notices', limit: 10, status: 'all' });
    await cms.delete({ collection: 'notices', id: String(docs[0]?.id) });
    await expect(cms.delete({ collection: 'notices', id: String(docs[1]?.id) })).rejects.toThrow(
      /keeps at least/
    );
  });

  it('keeps notice links inside the site', async () => {
    const [notice] = (await cms.find({ collection: 'notices', limit: 1, status: 'all' })).docs;
    for (const bad of ['javascript:alert(1)', '//evil.example', 'https://evil.example']) {
      const updated = await cms.update({
        collection: 'notices',
        id: String(notice?.id),
        data: { linkPath: bad }
      });
      expect(updated.linkPath).toBe('/booking');
    }
    const ok = await cms.update({
      collection: 'notices',
      id: String(notice?.id),
      data: { linkPath: '/services' }
    });
    expect(ok.linkPath).toBe('/services');
  });
});

// --- Measured amplification ---------------------------------------------------------------------------

describe('operation amplification (why the daily budgets are what they are)', () => {
  const WRITE_METHODS = ['create', 'update', 'delete', 'updateIf', 'deleteIf'] as const;

  async function measure(
    cms: DemoRuntime,
    action: () => Promise<unknown>
  ): Promise<Record<string, number>> {
    const db = cms.adapters.database as unknown as Record<string, (...a: unknown[]) => unknown>;
    const counts: Record<string, number> = {};
    const originals = new Map<string, (...a: unknown[]) => unknown>();
    for (const method of WRITE_METHODS) {
      const original = db[method];
      if (!original) continue;
      originals.set(method, original);
      db[method] = (...args: unknown[]) => {
        counts[method] = (counts[method] ?? 0) + 1;
        return original.apply(db, args);
      };
    }
    try {
      await action();
    } finally {
      for (const [method, original] of originals) db[method] = original;
    }
    return counts;
  }

  const total = (counts: Record<string, number>): number =>
    Object.values(counts).reduce((a, b) => a + b, 0);

  it('a notice edit + publish is a handful of row writes; a booking is two at most', async () => {
    const cms = createRuntime(undefined, { devMode: true });
    await cms.syncSchema();
    await seedContent(cms);
    const [notice] = (await cms.find({ collection: 'notices', limit: 1, status: 'all' })).docs;

    const edit = await measure(cms, () =>
      cms.update({
        collection: 'notices',
        id: String(notice?.id),
        locale: 'en',
        data: { title: 'Edited' }
      })
    );
    const publish = await measure(cms, () =>
      cms.update({
        collection: 'notices',
        id: String(notice?.id),
        data: { _status: 'published' }
      })
    );
    // At the booking ceiling: the create also prunes one.
    for (let i = 0; i < (MAX_DOCUMENTS.bookings ?? 0); i += 1) {
      await cms.create({
        collection: 'bookings',
        data: { name: `V${i}`, email: `v${i}@example.com`, preferredDate: new Date() }
      });
    }
    const booking = await measure(cms, () =>
      cms.create({
        collection: 'bookings',
        data: { name: 'Last', email: 'last@example.com', preferredDate: new Date() }
      })
    );

    // Budgets assume at most ~10 row writes per allowed action. Real D1 also writes index entries, so
    // the daily numbers keep a wide margin below any allowance; this guards the *call* amplification.
    expect(total(edit)).toBeLessThanOrEqual(5);
    expect(total(publish)).toBeLessThanOrEqual(5);
    expect(total(booking)).toBeLessThanOrEqual(1 + MAX_PRUNE_PER_WRITE);
    expect(
      PUBLIC_DAILY_BUDGETS.CONTENT_UPDATE * 2 * 10 + PUBLIC_DAILY_BUDGETS.BOOKING_CREATE * 6 * 10
    ).toBeLessThan(10_000);
  });
});
