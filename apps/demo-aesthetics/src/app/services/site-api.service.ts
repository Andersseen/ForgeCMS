import { Injectable } from '@angular/core';
import { ForgeApiError } from '@forge-cms/angular';
import type {
  BookingRequest,
  HomePayload,
  PostDetail,
  PostSummary,
  ServiceDetailPayload,
  ServicesPayload,
  SiteSettings,
  TeamMember
} from '../../shared/site-content';

interface Envelope<T> {
  data: T;
}

/**
 * The public site's data layer.
 *
 * `CmsApiService` can express every query this site makes (filters, sort, limit, depth, status —
 * spec 041), and the admin uses it. The public pages deliberately don't: each one needs several
 * collections at once, so a server endpoint composes them on the Local API (`/api/site/*`) and the
 * browser makes one request per page. The composition runs as an anonymous visitor, so access and
 * draft rules apply exactly as over HTTP, and the response is a small view model rather than raw CMS
 * documents (internal fields never leave the server).
 */
@Injectable({ providedIn: 'root' })
export class SiteApiService {
  /**
   * Failures use the SDK's structured `ForgeApiError` (spec 075), so a page can tell a real 404 from
   * an outage. The operator detail goes to the console; pages only ever show visitor copy.
   */
  private async get<T>(path: string): Promise<T> {
    const url = `/api/site/${path}`;
    let response: Response;
    try {
      response = await fetch(url);
    } catch (cause) {
      console.warn(`[lumea] ${url} could not be reached`, cause);
      throw new ForgeApiError({
        kind: 'network',
        code: 'NETWORK_ERROR',
        message: `${url} could not be reached`,
        cause
      });
    }
    const body = (await response.json().catch(() => undefined)) as
      | (Partial<Envelope<T>> & { error?: { code?: string } })
      | undefined;
    if (!response.ok) {
      if (response.status !== 404) console.warn(`[lumea] ${url} failed with ${response.status}`);
      throw new ForgeApiError({
        kind: 'http',
        status: response.status,
        code: body?.error?.code ?? 'HTTP_ERROR',
        message: `${url} failed with ${response.status}`
      });
    }
    if (body === undefined || !('data' in body)) {
      throw new ForgeApiError({
        kind: 'invalid-response',
        status: response.status,
        code: 'INVALID_RESPONSE',
        message: `${url} returned an unexpected response`
      });
    }
    return body.data as T;
  }

  home(): Promise<HomePayload> {
    return this.get<HomePayload>('home');
  }

  services(): Promise<ServicesPayload> {
    return this.get<ServicesPayload>('services');
  }

  service(slug: string): Promise<ServiceDetailPayload> {
    return this.get<ServiceDetailPayload>(`services/${encodeURIComponent(slug)}`);
  }

  team(): Promise<TeamMember[]> {
    return this.get<TeamMember[]>('team');
  }

  journal(): Promise<PostSummary[]> {
    return this.get<PostSummary[]>('journal');
  }

  post(slug: string): Promise<PostDetail> {
    return this.get<PostDetail>(`journal/${encodeURIComponent(slug)}`);
  }

  settings(): Promise<SiteSettings | null> {
    return this.get<SiteSettings | null>('settings');
  }

  async requestBooking(request: BookingRequest): Promise<{ id: string }> {
    let response: Response;
    try {
      response = await fetch('/api/site/bookings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request)
      });
    } catch {
      // Not retried: a lost connection leaves the server-side outcome unknown (spec 075).
      throw new Error(
        'We could not reach the clinic. Check your connection before sending the request again.'
      );
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        data?: { details?: { field: string; message: string }[] };
        statusMessage?: string;
      } | null;
      const detail = body?.data?.details?.[0]?.message;
      throw new Error(detail ?? 'We could not send your request. Please try again.');
    }

    const body = (await response.json()) as Envelope<{ id: string }>;
    return body.data;
  }
}
