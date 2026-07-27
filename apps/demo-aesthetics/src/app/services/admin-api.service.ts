import { Injectable } from '@angular/core';
import { AUTH_TOKEN_KEY } from '../auth-token';

interface ListResponse<T> {
  data: T[];
  meta: { collection: string; count: number; totalDocs?: number };
}

/**
 * The bits of the admin's data access that `CmsApiService` cannot express.
 *
 * FINDING 17: `getDocuments(collection)` takes no options, so it always lists with the API's
 * defaults — and the default for a `drafts: true` collection is **published only**. An editor
 * opening `/admin/collections/services` would therefore never see the draft they came to finish.
 * Every call here exists because the shipped client has no equivalent.
 */
@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    return { ...extra, ...(token ? { authorization: `Bearer ${token}` } : {}) };
  }

  /** Lists a collection including drafts, with an optional sort and limit. */
  async listDocuments<T = Record<string, unknown>>(
    collection: string,
    options: {
      status?: 'all' | 'draft' | 'published';
      sort?: string;
      order?: 'asc' | 'desc';
      limit?: number;
    } = {}
  ): Promise<T[]> {
    const query = new URLSearchParams();
    query.set('status', options.status ?? 'all');
    if (options.sort) query.set('sort', options.sort);
    if (options.order) query.set('order', options.order);
    if (options.limit !== undefined) query.set('limit', String(options.limit));

    const response = await fetch(`/api/v1/${collection}?${query.toString()}`, {
      headers: this.headers()
    });
    if (!response.ok) throw new Error(`Failed to load ${collection}: ${response.status}`);

    const body = (await response.json()) as ListResponse<T>;
    return body.data;
  }

  /**
   * Uploads a file to an `upload: true` collection.
   *
   * FINDING 18: spec 016 built a real multipart flow on the server, but `CmsApiService` only ever
   * sends JSON — there is no `uploadFile` — so a media library has to hand-roll the FormData POST.
   */
  async uploadMedia(file: File, alt: string): Promise<Record<string, unknown>> {
    const form = new FormData();
    form.set('file', file);
    form.set('alt', alt);
    form.set('filename', file.name);

    const response = await fetch('/api/v1/media', {
      method: 'POST',
      headers: this.headers(),
      body: form
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `Upload failed with ${response.status}`);
    }

    const body = (await response.json()) as { data: Record<string, unknown> };
    return body.data;
  }

  async status(): Promise<{
    database: string;
    auth: string;
    storage: string;
    collections: Record<string, number>;
  }> {
    const response = await fetch('/api/status', { headers: this.headers() });
    if (!response.ok) throw new Error(`Failed to load status: ${response.status}`);
    const body = (await response.json()) as {
      data: {
        database: string;
        auth: string;
        storage: string;
        collections: Record<string, number>;
      };
    };
    return body.data;
  }
}
