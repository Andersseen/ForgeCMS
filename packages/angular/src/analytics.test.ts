import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { Injector, createEnvironmentInjector, EnvironmentInjector } from '@angular/core';
import { FORGE_ANALYTICS_CONFIG } from './analytics-config.js';
import { ForgeAnalyticsTracker } from './analytics-tracker.service.js';
import { provideForgeAnalytics } from './analytics.js';

function boot(config?: Parameters<typeof provideForgeAnalytics>[0]) {
  const created = vi.fn();
  class FakeTracker {
    constructor() {
      created();
    }
  }
  const parent = Injector.create({ providers: [] }) as unknown as EnvironmentInjector;
  const providers = provideForgeAnalytics(config);
  createEnvironmentInjector(
    [...providers, { provide: ForgeAnalyticsTracker, useClass: FakeTracker }],
    parent
  );
  return { created, providers };
}

describe('provideForgeAnalytics', () => {
  it('registers the config and instantiates the tracker once at start-up', () => {
    const { created, providers } = boot({ endpoint: '/x' });
    expect(created).toHaveBeenCalledTimes(1);
    expect(providers).toContainEqual({
      provide: FORGE_ANALYTICS_CONFIG,
      useValue: { endpoint: '/x' }
    });
  });
  it('defaults to enabled', () => {
    expect(boot().created).toHaveBeenCalledTimes(1);
  });
  it('does nothing when explicitly disabled', () => {
    expect(boot({ enabled: false }).created).not.toHaveBeenCalled();
  });
});
