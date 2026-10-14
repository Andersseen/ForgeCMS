import { describe, expect, it, vi } from 'vitest';
import type { AnalyticsEngineDataset, AnalyticsSummaryResult } from '@forge-cms/cloudflare';
import { collectPageview } from '../server/analytics/collect';
import { getAnalyticsSummary } from '../server/analytics/summary';

// The Forge Analytics onboarding recipe (spec 093). The guide embeds these two source files, so these
// tests are the recipe's evidence: privacy of the collector and the read-side states.

function dataset(): { binding: AnalyticsEngineDataset; points: unknown[] } {
  const points: unknown[] = [];
  return { binding: { writeDataPoint: (point) => void points.push(point) }, points };
}

describe('collector (POST /api/analytics/collect)', () => {
  it('records only sanitized pathname, referrer host, country and a server-side site id', () => {
    const { binding, points } = dataset();
    collectPageview({
      body: {
        pathname: '/services/botox?utm_source=x&email=a@b.co#frag',
        referrer: 'https://news.example.com/article?id=7',
        ip: '203.0.113.9',
        email: 'visitor@example.com',
        userId: 'u_1',
        visitorId: 'v_1'
      },
      env: { ANALYTICS: binding, FORGE_ANALYTICS_SITE_ID: 'clinic' },
      requestHost: 'clinic.example.org',
      countryHeader: 'es'
    });

    expect(points).toHaveLength(1);
    const point = JSON.stringify(points[0]);
    expect(points[0]).toEqual({
      indexes: ['clinic'],
      blobs: ['pageview', '/services/botox', 'news.example.com', 'ES', ''],
      doubles: [1]
    });
    for (const forbidden of [
      'utm_source',
      'email',
      'a@b.co',
      'frag',
      'article',
      '203.0.113.9',
      'u_1',
      'v_1',
      '?id=7'
    ]) {
      expect(point).not.toContain(forbidden);
    }
  });

  it('drops a same-site referrer and an unresolved country', () => {
    const { binding, points } = dataset();
    collectPageview({
      body: { pathname: '/', referrer: 'https://clinic.example.org/about' },
      env: { ANALYTICS: binding },
      requestHost: 'clinic.example.org',
      countryHeader: 'XX'
    });
    expect(points[0]).toEqual({
      indexes: ['default'],
      blobs: ['pageview', '/', '', '', ''],
      doubles: [1]
    });
  });

  it('survives hostile bodies', () => {
    const { binding, points } = dataset();
    for (const body of [undefined, null, 'text', 42, [], { pathname: { x: 1 }, referrer: 5 }]) {
      collectPageview({
        body,
        env: { ANALYTICS: binding },
        requestHost: 'h',
        countryHeader: undefined
      });
    }
    expect(points).toHaveLength(6);
    expect(JSON.stringify(points)).not.toContain('"x"');
  });

  it('is a safe no-op without the ANALYTICS binding', () => {
    expect(() =>
      collectPageview({ body: { pathname: '/a' }, env: {}, requestHost: 'h', countryHeader: 'ES' })
    ).not.toThrow();
    expect(() =>
      collectPageview({ body: {}, env: undefined, requestHost: 'h', countryHeader: undefined })
    ).not.toThrow();
  });
});

const SUMMARY: AnalyticsSummaryResult = {
  range: '7d',
  totals: { pageviews: 10, previousPageviews: 5, changePct: 100 },
  timeline: [],
  topPages: [{ path: '/', pageviews: 10 }],
  referrers: [],
  countries: []
};

describe('summary (GET /api/analytics/summary, behind admin auth)', () => {
  it('rejects an invalid or missing range', async () => {
    for (const range of [undefined, '', '1y', 7, ['7d']]) {
      expect(await getAnalyticsSummary({ range, env: {} })).toMatchObject({ status: 400 });
    }
  });

  it('reports configured:false without the read credentials, and never builds a client', async () => {
    const createClient = vi.fn();
    expect(await getAnalyticsSummary({ range: '7d', env: {}, createClient })).toEqual({
      status: 200,
      data: { configured: false }
    });
    expect(
      await getAnalyticsSummary({ range: '7d', env: { CLOUDFLARE_ACCOUNT_ID: 'a' }, createClient })
    ).toEqual({ status: 200, data: { configured: false } });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('loads the summary for a valid range with the sanitized site id', async () => {
    const getSummary = vi.fn().mockResolvedValue(SUMMARY);
    const createClient = vi.fn().mockReturnValue({ getSummary });
    const result = await getAnalyticsSummary({
      range: '7d',
      env: {
        CLOUDFLARE_ACCOUNT_ID: 'acct',
        CLOUDFLARE_ANALYTICS_TOKEN: 'tok',
        FORGE_ANALYTICS_SITE_ID: "x'; DROP"
      },
      createClient
    });
    expect(result).toEqual({ status: 200, data: { configured: true, ...SUMMARY } });
    expect(getSummary).toHaveBeenCalledWith('xDROP', '7d');
    expect(JSON.stringify(result)).not.toContain('tok');
  });

  it('turns a failed query (dataset never written) into an empty, configured summary', async () => {
    const createClient = vi
      .fn()
      .mockReturnValue({ getSummary: vi.fn().mockRejectedValue(new Error('no dataset')) });
    const result = await getAnalyticsSummary({
      range: '30d',
      env: { CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_ANALYTICS_TOKEN: 't' },
      createClient
    });
    expect(result).toMatchObject({
      status: 200,
      data: {
        configured: true,
        range: '30d',
        totals: { pageviews: 0, previousPageviews: 0, changePct: null }
      }
    });
  });
});
