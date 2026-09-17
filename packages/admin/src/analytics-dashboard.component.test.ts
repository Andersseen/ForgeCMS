import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import type { Injector as InjectorType } from '@angular/core';
import { ForgeAnalyticsApiService } from '@forge-cms/angular';
import type { AnalyticsSummaryResponse } from '@forge-cms/angular';
import { ForgeAnalyticsDashboardComponent } from './analytics-dashboard.component.js';

/** Exposes the `protected` signals/methods the template relies on, for white-box state assertions. */
interface Testable {
  loading: () => boolean;
  error: () => string | null;
  data: () => AnalyticsSummaryResponse | null;
  load: () => Promise<void>;
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
        throw new Error('Failed to fetch analytics: 500');
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
});
