import { Injectable } from '@angular/core';
import { ApiAuthError, ForgeApiError } from './types.js';

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
 * document CRUD, and `/api/analytics/*` is still hardcoded here. Experimental (spec 057) and outside
 * spec 075: it does not use `FORGE_CMS_CONFIG` or its transport.
 */
@Injectable({ providedIn: 'root' })
export class ForgeAnalyticsApiService {
  async getSummary(range: AnalyticsRange): Promise<AnalyticsSummaryResponse> {
    const response = await fetch(`/api/analytics/summary?range=${range}`, {
      credentials: 'include'
    });
    if (response.status === 401) throw new ApiAuthError();
    if (!response.ok) {
      throw new ForgeApiError({
        kind: 'http',
        status: response.status,
        code: 'HTTP_ERROR',
        message: `Failed to fetch analytics: ${response.status}`
      });
    }
    const result = (await response.json()) as { data: AnalyticsSummaryResponse };
    return result.data;
  }
}
