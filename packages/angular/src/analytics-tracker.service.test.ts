import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import type { Injector as InjectorType } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { FORGE_ANALYTICS_CONFIG } from './analytics-config.js';
import { ForgeAnalyticsTracker } from './analytics-tracker.service.js';

/** Only `.events.subscribe` is used by the tracker — a real `Router` needs a full platform. */
function createFakeRouter(): { router: Router; emit: (event: unknown) => void } {
  let handler: ((event: unknown) => void) | undefined;
  const router = {
    events: {
      subscribe: (fn: (event: unknown) => void) => {
        handler = fn;
        return { unsubscribe: () => {} };
      }
    }
  } as unknown as Router;
  return { router, emit: (event) => handler?.(event) };
}

function createInjector(router: Router, config?: { endpoint?: string }): InjectorType {
  return Injector.create({
    providers: [
      { provide: Router, useValue: router },
      { provide: ForgeAnalyticsTracker, useClass: ForgeAnalyticsTracker, deps: [] },
      ...(config ? [{ provide: FORGE_ANALYTICS_CONFIG, useValue: config }] : [])
    ]
  });
}

beforeEach(() => {
  vi.stubGlobal('window', {});
  vi.stubGlobal('location', { pathname: '/' });
  vi.stubGlobal('document', { referrer: '' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function createSendBeaconSpy(): {
  sendBeacon: (url: string, data?: BodyInit) => boolean;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    sendBeacon: (url: string) => {
      calls.push(url);
      return true;
    },
    calls
  };
}

describe('ForgeAnalyticsTracker', () => {
  it('sends exactly one beacon on construction (initial pageview)', () => {
    const { sendBeacon, calls } = createSendBeaconSpy();
    vi.stubGlobal('navigator', { sendBeacon });
    const { router } = createFakeRouter();
    const injector = createInjector(router);

    runInInjectionContext(injector, () => injector.get(ForgeAnalyticsTracker));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe('/api/analytics/collect');
  });

  it('does not send a second beacon for a NavigationEnd with the same pathname', () => {
    const { sendBeacon, calls } = createSendBeaconSpy();
    vi.stubGlobal('navigator', { sendBeacon });
    const { router, emit } = createFakeRouter();
    const injector = createInjector(router);

    runInInjectionContext(injector, () => injector.get(ForgeAnalyticsTracker));
    emit(new NavigationEnd(1, '/', '/'));

    expect(calls).toHaveLength(1);
  });

  it('sends a new beacon when the pathname actually changes', () => {
    const { sendBeacon, calls } = createSendBeaconSpy();
    vi.stubGlobal('navigator', { sendBeacon });
    const { router, emit } = createFakeRouter();
    const injector = createInjector(router);

    runInInjectionContext(injector, () => injector.get(ForgeAnalyticsTracker));
    vi.stubGlobal('location', { pathname: '/about' });
    emit(new NavigationEnd(2, '/about', '/about'));

    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe('/api/analytics/collect');
  });

  it('respects a configured endpoint', () => {
    const { sendBeacon, calls } = createSendBeaconSpy();
    vi.stubGlobal('navigator', { sendBeacon });
    const { router } = createFakeRouter();
    const injector = createInjector(router, { endpoint: '/custom/collect' });

    runInInjectionContext(injector, () => injector.get(ForgeAnalyticsTracker));

    expect(calls[0]).toBe('/custom/collect');
  });

  it('falls back to fetch with keepalive and no credentials when sendBeacon is unavailable', () => {
    vi.stubGlobal('navigator', {});
    const fetchCalls: { url: string; init?: RequestInit }[] = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), ...(init !== undefined && { init }) });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);
    const { router } = createFakeRouter();
    const injector = createInjector(router);

    runInInjectionContext(injector, () => injector.get(ForgeAnalyticsTracker));

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.init?.keepalive).toBe(true);
    expect(fetchCalls[0]?.init?.credentials).toBe('omit');
  });

  it('does nothing outside a browser environment', () => {
    vi.stubGlobal('window', undefined);
    const { sendBeacon, calls } = createSendBeaconSpy();
    vi.stubGlobal('navigator', { sendBeacon });
    const { router } = createFakeRouter();
    const injector = createInjector(router);

    runInInjectionContext(injector, () => injector.get(ForgeAnalyticsTracker));

    expect(calls).toHaveLength(0);
  });
});
