import { inject, provideEnvironmentInitializer } from '@angular/core';
import type { EnvironmentProviders, Provider } from '@angular/core';
import { FORGE_ANALYTICS_CONFIG, type ForgeAnalyticsConfig } from './analytics-config.js';
import { ForgeAnalyticsTracker } from './analytics-tracker.service.js';

/**
 * Opts an app into the pageview tracker. No `APP_INITIALIZER` precedent exists in this repo;
 * `provideEnvironmentInitializer` is the current Angular idiom for "instantiate this singleton once
 * the app boots" (the older `ENVIRONMENT_INITIALIZER` token it wraps is deprecated as of the pinned
 * `@angular/core` version), and is enough here since the tracker does all its own work from its
 * constructor.
 */
export function provideForgeAnalytics(
  config: ForgeAnalyticsConfig = {}
): (Provider | EnvironmentProviders)[] {
  return [
    { provide: FORGE_ANALYTICS_CONFIG, useValue: config },
    provideEnvironmentInitializer(() => {
      if (config.enabled !== false) inject(ForgeAnalyticsTracker);
    })
  ];
}
