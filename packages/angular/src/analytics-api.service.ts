import { Injectable } from '@angular/core';
import { ApiAuthError } from './types.js';

export type AnalyticsRange = '24h' | '7d' | '30d' | '90d';

export interface AnalyticsTotals {
  pageviews: number;
  previousPageviews: number;
  changePct: number | null;
}

export interface AnalyticsTimelinePoint {
  bucket: string;
  pageviews: number;
}

export interface AnalyticsSummaryResponse {
  configured: boolean;
  range?: AnalyticsRange;
  totals?: AnalyticsTotals;
  timeline?: AnalyticsTimelinePoint[];
  topPages?: { path: string; pageviews: number }[];
  referrers?: { host: string; pageviews: number }[];
  countries?: { country: string; pageviews: number }[];
}

/**
 * Reads aggregated analytics for the admin dashboard. Kept apart from `CmsApiService`: this isn't CMS
 * document CRUD, and `/api/analytics/*` is a ForgeCMS-wide convention hardcoded here — the same way
 * `CmsApiService.getCurrentUser()` hardcodes `/api/auth/me` rather than deriving it from
 * `FORGE_CMS_CONFIG.baseUrl`.
 */
@Injectable({ providedIn: 'root' })
export class ForgeAnalyticsApiService {
  async getSummary(range: AnalyticsRange): Promise<AnalyticsSummaryResponse> {
    const response = await fetch(`/api/analytics/summary?range=${range}`, {
      credentials: 'include'
    });
    if (response.status === 401) throw new ApiAuthError();
    if (!response.ok) throw new Error(`Failed to fetch analytics: ${response.status}`);
    const result = (await response.json()) as { data: AnalyticsSummaryResponse };
    return result.data;
  }
}
