import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import type { Injector as InjectorType } from '@angular/core';
import { ForgeAnalyticsApiService, ForgeApiError } from '@forge-cms/angular';
import type { AnalyticsSummaryResponse } from '@forge-cms/angular';
import { ForgeAnalyticsDashboardComponent } from './analytics-dashboard.component.js';

/** Exposes the `protected` signals/methods the template relies on, for white-box state assertions. */
interface Testable {
  loading: () => boolean;
  error: () => string | null;
  data: () => AnalyticsSummaryResponse | null;
  load: () => Promise<void>;
  range: () => string;
  changeLabel: () => string | null;
  chartBars: () => { x: number; y: number; height: number; bucket: string; pageviews: number }[];
  chartWidth: () => number;
  onRangeChange: (event: Event) => void;
}

function createInjector(api: Pick<ForgeAnalyticsApiService, 'getSummary'>): InjectorType {
  return Injector.create({
    providers: [
      { provide: ForgeAnalyticsApiService, useValue: api },
      {
        provide: ForgeAnalyticsDashboardComponent,
        useClass: ForgeAnalyticsDashboardComponent,
        deps: []
      }
    ]
  });
}

function createComponent(api: Pick<ForgeAnalyticsApiService, 'getSummary'>): {
  component: Testable;
  injector: InjectorType;
} {
  const injector = createInjector(api);
  const component = runInInjectionContext(
    injector,
    () => injector.get(ForgeAnalyticsDashboardComponent) as unknown as Testable
  );
  return { component, injector };
}

const CONFIGURED_SUMMARY: AnalyticsSummaryResponse = {
  configured: true,
  range: '7d',
  totals: { pageviews: 12, previousPageviews: 6, changePct: 100 },
  timeline: [{ bucket: '2026-01-01', pageviews: 12 }],
  topPages: [{ path: '/', pageviews: 12 }],
  referrers: [{ host: 'Direct', pageviews: 12 }],
  countries: [{ country: 'US', pageviews: 12 }]
};

describe('ForgeAnalyticsDashboardComponent', () => {
  it('starts in a loading state', () => {
    const { component } = createComponent({ getSummary: vi.fn(async () => CONFIGURED_SUMMARY) });
    expect(component.loading()).toBe(true);
  });

  it('resolves to configured data on success', async () => {
    const { component, injector } = createComponent({
      getSummary: vi.fn(async () => CONFIGURED_SUMMARY)
    });

    await runInInjectionContext(injector, () => component.load());

    expect(component.loading()).toBe(false);
    expect(component.error()).toBeNull();
    expect(component.data()?.configured).toBe(true);
    expect(component.data()?.totals?.pageviews).toBe(12);
  });

  it('renders a "not configured" shape when the server reports no binding/credentials', async () => {
    const { component, injector } = createComponent({
      getSummary: vi.fn(async () => ({ configured: false }))
    });

    await runInInjectionContext(injector, () => component.load());

    expect(component.data()?.configured).toBe(false);
    expect(component.error()).toBeNull();
  });

  it('surfaces a failed request as a friendly error message', async () => {
    const { component, injector } = createComponent({
      getSummary: vi.fn(async () => {
        throw new ForgeApiError({
          kind: 'http',
          status: 500,
          code: 'HTTP_ERROR',
          message: 'Failed to fetch analytics: 500'
        });
      })
    });

    await runInInjectionContext(injector, () => component.load());

    expect(component.loading()).toBe(false);
    expect(component.error()).toBe('Something went wrong on the server. Please try again.');
  });

  it('treats zero pageviews as distinct from "not configured"', async () => {
    const { component, injector } = createComponent({
      getSummary: vi.fn(async () => ({
        ...CONFIGURED_SUMMARY,
        totals: { pageviews: 0, previousPageviews: 0, changePct: null }
      }))
    });

    await runInInjectionContext(injector, () => component.load());

    expect(component.data()?.configured).toBe(true);
    expect(component.data()?.totals?.pageviews).toBe(0);
  });

  describe('range selection', () => {
    it('defaults to 7d and reloads with the chosen range', async () => {
      const getSummary = vi.fn(
        async (range: string) => ({ ...CONFIGURED_SUMMARY, range }) as AnalyticsSummaryResponse
      );
      const { component, injector } = createComponent({ getSummary });
      expect(component.range()).toBe('7d');

      await runInInjectionContext(injector, () => component.load());
      expect(getSummary).toHaveBeenLastCalledWith('7d');

      component.onRangeChange({ target: { value: '90d' } } as unknown as Event);
      await vi.waitFor(() => expect(getSummary).toHaveBeenLastCalledWith('90d'));
      expect(component.range()).toBe('90d');
      await vi.waitFor(() => expect(component.data()?.range).toBe('90d'));
    });
  });

  describe('error and retry', () => {
    it('shows the error, then recovers when the request is retried', async () => {
      const getSummary = vi
        .fn<(range: string) => Promise<AnalyticsSummaryResponse>>()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce(CONFIGURED_SUMMARY);
      const { component, injector } = createComponent({ getSummary });

      await runInInjectionContext(injector, () => component.load());
      expect(component.error()).not.toBeNull();
      expect(component.data()).toBeNull();

      await runInInjectionContext(injector, () => component.load());
      expect(component.error()).toBeNull();
      expect(component.data()?.totals?.pageviews).toBe(12);
      expect(component.loading()).toBe(false);
    });
  });

  describe('previous-period change label', () => {
    const labelFor = async (changePct: number | null): Promise<string | null> => {
      const { component, injector } = createComponent({
        getSummary: vi.fn(async () => ({
          ...CONFIGURED_SUMMARY,
          totals: { pageviews: 10, previousPageviews: 5, changePct }
        }))
      });
      await runInInjectionContext(injector, () => component.load());
      return component.changeLabel();
    };

    it('signs a positive change with +', async () => {
      expect(await labelFor(100)).toBe('+100% vs. previous period');
    });
    it('keeps the minus of a negative change', async () => {
      expect(await labelFor(-25)).toBe('-25% vs. previous period');
    });
    it('shows +0% for no change', async () => {
      expect(await labelFor(0)).toBe('+0% vs. previous period');
    });
    it('shows no label when there is no previous period to compare', async () => {
      expect(await labelFor(null)).toBeNull();
    });
  });

  describe('timeline bars', () => {
    it('scales bars against the busiest bucket and keeps the bucket order', async () => {
      const { component, injector } = createComponent({
        getSummary: vi.fn(async () => ({
          ...CONFIGURED_SUMMARY,
          timeline: [
            { bucket: 'a', pageviews: 5 },
            { bucket: 'b', pageviews: 10 },
            { bucket: 'c', pageviews: 0 }
          ]
        }))
      });
      await runInInjectionContext(injector, () => component.load());

      const bars = component.chartBars();
      expect(bars.map((bar) => bar.bucket)).toEqual(['a', 'b', 'c']);
      expect(bars.map((bar) => bar.height)).toEqual([50, 100, 0]);
      expect(bars.map((bar) => bar.y)).toEqual([50, 0, 100]);
      expect(bars[1]?.x).toBeGreaterThan(bars[0]?.x ?? 0);
      expect(component.chartWidth()).toBeGreaterThan(0);
    });

    it('has no bars (and a non-zero chart width) when there is no traffic', async () => {
      const { component, injector } = createComponent({
        getSummary: vi.fn(async () => ({ ...CONFIGURED_SUMMARY, timeline: [] }))
      });
      await runInInjectionContext(injector, () => component.load());
      expect(component.chartBars()).toEqual([]);
      expect(component.chartWidth()).toBeGreaterThan(0);
    });
  });

  it('exposes top pages, referrers and countries from the summary', async () => {
    const { component, injector } = createComponent({
      getSummary: vi.fn(async () => ({
        ...CONFIGURED_SUMMARY,
        topPages: [
          { path: '/', pageviews: 9 },
          { path: '/services', pageviews: 3 }
        ],
        referrers: [{ host: 'news.example.com', pageviews: 4 }],
        countries: [
          { country: 'ES', pageviews: 8 },
          { country: 'US', pageviews: 4 }
        ]
      }))
    });
    await runInInjectionContext(injector, () => component.load());

    expect(component.data()?.topPages?.map((p) => p.path)).toEqual(['/', '/services']);
    expect(component.data()?.referrers?.[0]?.host).toBe('news.example.com');
    expect(component.data()?.countries?.map((c) => c.country)).toEqual(['ES', 'US']);
  });
});
