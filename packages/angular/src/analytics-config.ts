/**
 * Kept apart from `analytics-tracker.service.ts` and `analytics.ts` so the tracker can depend on the
 * token and `provideForgeAnalytics` can depend on both the token and the tracker, without either of
 * those two ever importing each other (`import/no-cycle` is an error in this repo) — the same reason
 * `types.ts` sits apart from `api.service.ts`.
 */
import { InjectionToken } from '@angular/core';

export interface ForgeAnalyticsConfig {
  /** Defaults to `true`. */
  enabled?: boolean;
  /** Same-origin collector endpoint. Defaults to `/api/analytics/collect`. */
  endpoint?: string;
}

export const FORGE_ANALYTICS_CONFIG = new InjectionToken<ForgeAnalyticsConfig>(
  'FORGE_ANALYTICS_CONFIG'
);
