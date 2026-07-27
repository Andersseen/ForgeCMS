import { Injectable } from '@angular/core';
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
 * `CmsApiService` from `@forge-cms/angular` is not used here: it can only fetch a whole collection
 * (`getDocuments(collection)` takes no filter, sort, limit or depth — finding 15), and the site
 * needs composed, access-filtered payloads. Those are built server-side on the Local API and
 * fetched with plain `fetch` from here.
 */
@Injectable({ providedIn: 'root' })
export class SiteApiService {
  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`/api/site/${path}`);
    if (!response.ok) {
      throw new Error(`Request to /api/site/${path} failed with ${response.status}`);
    }
    const body = (await response.json()) as Envelope<T>;
    return body.data;
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
    const response = await fetch('/api/site/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request)
    });

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
