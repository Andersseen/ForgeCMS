/**
 * The demo runs in public with its admin password printed on the landing page, on a free Cloudflare
 * plan. These tests cover what stops that from being expensive: the per-IP write throttle, the read
 * cache, and the ceilings and floors the content model enforces.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ForgeCmsRuntime } from '@forge-cms/runtime';
import {
  MAX_DOCUMENTS,
  MIN_DOCUMENTS,
  cachedRead,
  clearReadCache,
  resetThrottle,
  throttleWrite
} from '../server/api/demo-limits';
import { createRuntime, type ServerEnv } from '../server/api/runtime';
import { seedContent } from '../server/api/seed';

describe('write throttle', () => {
  beforeEach(() => resetThrottle());

  it('allows a normal burst and then holds the line', () => {
    const results = Array.from({ length: 20 }, () => throttleWrite('1.2.3.4'));
    const allowed = results.filter((result) => result.allowed).length;

    expect(allowed).toBe(12);
    expect(results.at(-1)?.allowed).toBe(false);
    expect(results.at(-1)?.retryAfter).toBeGreaterThan(0);
  });

  it('keeps one visitor from spending another visitor budget', () => {
    for (let i = 0; i < 20; i += 1) throttleWrite('1.2.3.4');

    expect(throttleWrite('5.6.7.8').allowed).toBe(true);
  });

  it('forgives once the window passes', () => {
    const start = 1_000_000;
    for (let i = 0; i < 20; i += 1) throttleWrite('1.2.3.4', start);

    expect(throttleWrite('1.2.3.4', start).allowed).toBe(false);
    expect(throttleWrite('1.2.3.4', start + 61_000).allowed).toBe(true);
  });

  it('stops the whole isolate before the daily quota can be reached', () => {
    // Many IPs, each politely under its own limit: the global bucket is what catches this.
    let allowed = 0;
    for (let ip = 0; ip < 400; ip += 1) {
      for (let i = 0; i < 5; i += 1) {
        if (throttleWrite(`10.0.${Math.floor(ip / 256)}.${ip % 256}`).allowed) allowed += 1;
      }
    }

    expect(allowed).toBeLessThanOrEqual(240);
  });
});

describe('read cache', () => {
  beforeEach(() => clearReadCache());

  it('runs the loader once per key per window', async () => {
    let calls = 0;
    const load = async () => {
      calls += 1;
      return 'payload';
    };

    expect(await cachedRead('/api/site/home', load)).toBe('payload');
    await cachedRead('/api/site/home', load);
    await cachedRead('/api/site/home', load);

    expect(calls).toBe(1);
  });

  it('keys by path, so two pages do not share a payload', async () => {
    await cachedRead('/api/site/services/a', async () => 'a');
    expect(await cachedRead('/api/site/services/b', async () => 'b')).toBe('b');
  });

  it('reloads once the entry expires', async () => {
    let calls = 0;
    const load = async () => {
      calls += 1;
      return calls;
    };

    await cachedRead('/api/site/home', load, 1_000_000);
    await cachedRead('/api/site/home', load, 1_000_000 + 61_000);

    expect(calls).toBe(2);
  });

  it('does not cache a failure', async () => {
    await expect(
      cachedRead('/api/site/boom', async () => {
        throw new Error('nope');
      })
    ).rejects.toThrow('nope');

    expect(await cachedRead('/api/site/boom', async () => 'recovered')).toBe('recovered');
  });
});

describe('content-model guardrails', () => {
  let cms: ForgeCmsRuntime<ServerEnv>;

  beforeEach(async () => {
    cms = createRuntime();
    await cms.syncSchema();
    await seedContent(cms);
  });

  it('prunes the oldest rows once a collection passes its ceiling', async () => {
    const ceiling = MAX_DOCUMENTS.bookings ?? 0;
    expect(ceiling).toBeGreaterThan(0);

    const before = await cms.count({ collection: 'bookings' });
    for (let i = 0; i < ceiling - before + 5; i += 1) {
      await cms.create({
        collection: 'bookings',
        data: {
          name: `Visitor ${i}`,
          email: `visitor${i}@example.com`,
          preferredDate: new Date().toISOString()
        }
      });
    }

    // The writes all succeeded — a demo that starts rejecting bookings is a broken demo — but the
    // collection never grew past its ceiling.
    expect(await cms.count({ collection: 'bookings' })).toBe(ceiling);
  });

  it('keeps the newest rows when it prunes', async () => {
    const ceiling = MAX_DOCUMENTS.testimonials ?? 0;
    const before = await cms.count({ collection: 'testimonials' });

    for (let i = 0; i < ceiling - before + 3; i += 1) {
      await cms.create({
        collection: 'testimonials',
        data: { author: `Visitor ${i}`, quote: 'Lovely', rating: 5, _status: 'published' }
      });
    }

    const { docs } = await cms.find({ collection: 'testimonials', limit: 100, status: 'all' });
    expect(docs.some((doc) => doc.author === `Visitor ${ceiling - before + 2}`)).toBe(true);
  });

  it('refuses a delete that would strip the public site', async () => {
    const floor = MIN_DOCUMENTS.services ?? 0;
    const { docs } = await cms.find({ collection: 'services', limit: 50, status: 'all' });

    // Delete down to the floor, then one more.
    const deletable = docs.slice(0, docs.length - floor);
    for (const doc of deletable) {
      await cms.delete({ collection: 'services', id: String(doc.id) });
    }

    const remaining = await cms.find({ collection: 'services', limit: 50, status: 'all' });
    await expect(
      cms.delete({ collection: 'services', id: String(remaining.docs[0]?.id) })
    ).rejects.toThrow(/keeps at least/);

    expect(await cms.count({ collection: 'services' })).toBe(floor);
  });

  it('leaves collections without a configured limit alone', async () => {
    expect(MAX_DOCUMENTS.users).toBeUndefined();
    expect(MIN_DOCUMENTS.bookings).toBeUndefined();
  });
});
