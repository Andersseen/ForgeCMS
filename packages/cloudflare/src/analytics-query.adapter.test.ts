import { describe, expect, it, vi } from 'vitest';
import {
  AnalyticsEngineQueryClient,
  buildPreviousTotalQuery,
  buildTimelineQuery,
  buildTopPagesQuery
} from './analytics-query.adapter.js';

describe('query builders', () => {
  it('uses SUM(_sample_interval) instead of COUNT(*) so sampling never undercounts', () => {
    const sql = buildTimelineQuery('my_dataset', 'site-1', '7d');
    expect(sql).toContain('SUM(_sample_interval)');
    expect(sql).not.toContain('COUNT(*)');
  });

  it('buckets 24h by hour and 7d by day', () => {
    expect(buildTimelineQuery('d', 's', '24h')).toContain("DATE_TRUNC('hour', timestamp)");
    expect(buildTimelineQuery('d', 's', '7d')).toContain("DATE_TRUNC('day', timestamp)");
  });

  // Regression: '24h' once queried a 1-hour window ({ amount: 1, unit: 'HOUR' }) instead of 24.
  it('queries a full 24-hour window for the "24h" range, not 1 hour', () => {
    expect(buildTimelineQuery('d', 's', '24h')).toContain("INTERVAL '24' HOUR");
  });

  it('escapes single quotes and backslashes in the site id', () => {
    expect(buildTimelineQuery('d', "o'brien", '24h')).toContain("index1 = 'o''brien'");
    expect(buildTimelineQuery('d', 'back\\slash', '24h')).toContain("index1 = 'back\\\\slash'");
  });

  it('shifts the previous-period window back by exactly one more window', () => {
    const sql7d = buildPreviousTotalQuery('d', 's', '7d');
    expect(sql7d).toContain("INTERVAL '14' DAY");
    expect(sql7d).toContain("INTERVAL '7' DAY");

    const sql24h = buildPreviousTotalQuery('d', 's', '24h');
    expect(sql24h).toContain("INTERVAL '48' HOUR");
    expect(sql24h).toContain("INTERVAL '24' HOUR");
  });

  it('caps dimension breakdowns at LIMIT 10', () => {
    expect(buildTopPagesQuery('d', 's', '30d')).toContain('LIMIT 10');
  });
});

describe('AnalyticsEngineQueryClient.getSummary', () => {
  it('calls the SQL API 5 times with the right endpoint and auth header', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), ...(init !== undefined && { init }) });
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as typeof fetch;
    const client = new AnalyticsEngineQueryClient({
      accountId: 'acct-1',
      apiToken: 'token-abc',
      dataset: 'my_dataset',
      fetchImpl
    });

    await client.getSummary('site-1', '7d');

    expect(calls).toHaveLength(5);
    const first = calls[0];
    if (!first) throw new Error('expected fetchImpl to have been called');
    expect(first.url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct-1/analytics_engine/sql'
    );
    expect((first.init?.headers as Record<string, string>).authorization).toBe('Bearer token-abc');
  });

  it('derives totals from the timeline and computes change vs. the previous period', async () => {
    const responses: unknown[] = [
      {
        data: [
          { bucket: '2026-01-01', pageviews: 10 },
          { bucket: '2026-01-02', pageviews: 20 }
        ]
      },
      { data: [{ pageviews: 15 }] },
      { data: [{ path: '/', pageviews: 25 }] },
      { data: [{ host: '', pageviews: 20 }] },
      { data: [{ country: '', pageviews: 30 }] }
    ];
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      const body = responses[call];
      call += 1;
      return new Response(JSON.stringify(body), { status: 200 });
    });

    const client = new AnalyticsEngineQueryClient({
      accountId: 'a',
      apiToken: 't',
      dataset: 'd',
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    const summary = await client.getSummary('site-1', '7d');

    expect(summary.totals.pageviews).toBe(30);
    expect(summary.totals.previousPageviews).toBe(15);
    expect(summary.totals.changePct).toBe(100);
    expect(summary.referrers[0]?.host).toBe('Direct');
    expect(summary.countries[0]?.country).toBe('Unknown');
  });

  it('returns null changePct when the previous period had zero pageviews', async () => {
    const responses: unknown[] = [
      { data: [{ bucket: '2026-01-01', pageviews: 5 }] },
      { data: [{ pageviews: 0 }] },
      { data: [] },
      { data: [] },
      { data: [] }
    ];
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      const body = responses[call];
      call += 1;
      return new Response(JSON.stringify(body), { status: 200 });
    });

    const client = new AnalyticsEngineQueryClient({
      accountId: 'a',
      apiToken: 't',
      dataset: 'd',
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    const summary = await client.getSummary('site-1', '24h');

    expect(summary.totals.changePct).toBeNull();
  });

  it('throws when the SQL API responds with a non-2xx status', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 403 }));
    const client = new AnalyticsEngineQueryClient({
      accountId: 'a',
      apiToken: 'bad-token',
      dataset: 'd',
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    await expect(client.getSummary('site-1', '24h')).rejects.toThrow(
      'Analytics Engine SQL API request failed: 403'
    );
  });
});
