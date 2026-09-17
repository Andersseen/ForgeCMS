import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ForgeAnalyticsApiService } from './analytics-api.service.js';
import { ApiAuthError } from './types.js';

let respond: () => Response;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

beforeEach(() => {
  respond = () => jsonResponse({ data: { configured: false } });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(respond()))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ForgeAnalyticsApiService', () => {
  it('requests the given range with credentials included', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(respond()));
    vi.stubGlobal('fetch', fetchMock);

    await new ForgeAnalyticsApiService().getSummary('30d');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/analytics/summary?range=30d',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('returns the not-configured shape as-is', async () => {
    const result = await new ForgeAnalyticsApiService().getSummary('7d');
    expect(result.configured).toBe(false);
  });

  it('returns a full summary when configured', async () => {
    respond = () =>
      jsonResponse({
        data: {
          configured: true,
          range: '7d',
          totals: { pageviews: 10, previousPageviews: 5, changePct: 100 },
          timeline: [],
          topPages: [],
          referrers: [],
          countries: []
        }
      });

    const result = await new ForgeAnalyticsApiService().getSummary('7d');
    expect(result.configured).toBe(true);
    expect(result.totals?.pageviews).toBe(10);
  });

  it('throws ApiAuthError on 401', async () => {
    respond = () => new Response(null, { status: 401 });
    await expect(new ForgeAnalyticsApiService().getSummary('24h')).rejects.toBeInstanceOf(
      ApiAuthError
    );
  });

  it('throws a status-suffixed error on other failures', async () => {
    respond = () => new Response(null, { status: 403 });
    await expect(new ForgeAnalyticsApiService().getSummary('24h')).rejects.toThrow(
      'Failed to fetch analytics: 403'
    );
  });
});
