import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { CmsApiService } from './api.service.js';
import { ApiAuthError, ApiValidationError, FORGE_CMS_CONFIG } from './types.js';

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

const calls: FetchCall[] = [];
let respond: (url: string) => Response;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function listBody(docs: unknown[], meta: Record<string, unknown> = {}) {
  return {
    data: docs,
    meta: {
      collection: 'services',
      count: docs.length,
      totalDocs: docs.length,
      page: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPrevPage: false,
      ...meta
    }
  };
}

function createService(token: string | null = 'tok-123'): CmsApiService {
  const injector = Injector.create({
    providers: [
      { provide: FORGE_CMS_CONFIG, useValue: { baseUrl: '/api/v1', authToken: () => token } },
      { provide: CmsApiService, useClass: CmsApiService, deps: [] }
    ]
  });
  return runInInjectionContext(injector, () => injector.get(CmsApiService));
}

beforeEach(() => {
  calls.length = 0;
  respond = () => jsonResponse(listBody([]));
  vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return Promise.resolve(respond(url));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CmsApiService — querying', () => {
  it('sends every query option to the list endpoint', async () => {
    const api = createService();
    respond = () => jsonResponse(listBody([{ id: '1' }]));

    await api.getDocuments('services', {
      where: { featured: true, price: { gte: 50 } },
      sort: 'order',
      order: 'asc',
      limit: 3,
      depth: 1
    });

    const url = new URL(calls[0]!.url, 'http://localhost');
    expect(url.pathname).toBe('/api/v1/services');
    expect(url.searchParams.get('featured')).toBe('true');
    expect(url.searchParams.get('price[gte]')).toBe('50');
    expect(url.searchParams.get('sort')).toBe('order');
    expect(url.searchParams.get('limit')).toBe('3');
    expect(url.searchParams.get('depth')).toBe('1');
  });

  it('returns pagination metadata from listDocuments', async () => {
    const api = createService();
    respond = () =>
      jsonResponse(
        listBody([{ id: '1' }], { totalDocs: 42, page: 2, totalPages: 5, hasNextPage: true })
      );

    const result = await api.listDocuments('services', { limit: 10, page: 2 });

    expect(result.docs).toHaveLength(1);
    expect(result.meta.totalDocs).toBe(42);
    expect(result.meta.totalPages).toBe(5);
    expect(result.meta.hasNextPage).toBe(true);
  });

  it('asks for drafts when told to', async () => {
    const api = createService();
    await api.getDocuments('services', { status: 'all' });

    expect(new URL(calls[0]!.url, 'http://localhost').searchParams.get('status')).toBe('all');
  });

  it('serializes a nested and/or where through the shared query helper (spec 050)', async () => {
    const api = createService();
    await api.getDocuments('services', {
      where: {
        and: [{ status: 'published' }, { or: [{ featured: true }, { views: { gte: 100 } }] }]
      }
    });

    const url = new URL(calls[0]!.url, 'http://localhost');
    expect(JSON.parse(url.searchParams.get('where')!)).toEqual({
      and: [{ status: 'published' }, { or: [{ featured: true }, { views: { gte: 100 } }] }]
    });
  });

  it('serializes a multi-field sort as JSON (spec 050)', async () => {
    const api = createService();
    await api.getDocuments('services', {
      sort: [
        { field: 'featured', order: 'desc' },
        { field: 'created_at', order: 'desc' }
      ]
    });

    const url = new URL(calls[0]!.url, 'http://localhost');
    expect(JSON.parse(url.searchParams.get('sort')!)).toEqual([
      { field: 'featured', order: 'desc' },
      { field: 'created_at', order: 'desc' }
    ]);
  });

  it('findOne requests limit: 1 and returns the first document, or null', async () => {
    const api = createService();
    respond = () => jsonResponse(listBody([{ id: '1', slug: 'hello' }]));

    const doc = await api.findOne('posts', { slug: 'hello' });

    const url = new URL(calls[0]!.url, 'http://localhost');
    expect(url.searchParams.get('limit')).toBe('1');
    expect(url.searchParams.get('slug')).toBe('hello');
    expect(doc).toEqual({ id: '1', slug: 'hello' });
  });

  it('findOne returns null when nothing matches', async () => {
    const api = createService();
    respond = () => jsonResponse(listBody([]));

    expect(await api.findOne('posts', { slug: 'nope' })).toBeNull();
  });
});

describe('CmsApiService — authentication', () => {
  it('sends the token on reads, not just writes', async () => {
    const api = createService('tok-123');

    await api.getDocuments('services');
    await api.getDocument('services', 'abc');
    await api.getCollections();

    for (const call of calls) {
      expect((call.init?.headers as Record<string, string>)['authorization']).toBe(
        'Bearer tok-123'
      );
    }
  });

  it('omits the header when there is no token', async () => {
    const api = createService(null);
    await api.getDocuments('services');

    expect((calls[0]!.init?.headers as Record<string, string>)['authorization']).toBeUndefined();
  });

  it('maps a 401 to ApiAuthError', async () => {
    const api = createService();
    respond = () => jsonResponse({ error: 'Unauthorized' }, 401);

    await expect(api.getDocuments('services')).rejects.toBeInstanceOf(ApiAuthError);
  });

  it('maps a validation envelope to ApiValidationError', async () => {
    const api = createService();
    respond = () =>
      jsonResponse(
        {
          error: 'Validation failed',
          details: [{ field: 'name', message: 'Required', code: 'required' }]
        },
        400
      );

    await expect(api.createDocument('services', {})).rejects.toBeInstanceOf(ApiValidationError);
  });
});

describe('CmsApiService — uploads', () => {
  it('posts multipart form data with the file part named "file"', async () => {
    const api = createService();
    respond = () => jsonResponse({ data: { id: 'm1', filename: 'a.png' } }, 201);

    const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' });
    const result = await api.uploadFile('media', file, { alt: 'A picture' });

    const body = calls[0]!.init?.body as FormData;
    expect(calls[0]!.init?.method).toBe('POST');
    expect(body.get('file')).toBeInstanceOf(File);
    expect(body.get('alt')).toBe('A picture');
    // The browser must set the multipart boundary itself.
    expect((calls[0]!.init?.headers as Record<string, string>)['content-type']).toBeUndefined();
    expect(result).toEqual({ id: 'm1', filename: 'a.png' });
  });
});

describe('CmsApiService — draft/publish', () => {
  it('setDocumentStatus PUTs just the _status field to the document endpoint', async () => {
    const api = createService();
    respond = () => jsonResponse({ data: { id: 'p1', _status: 'published' } });

    const result = await api.setDocumentStatus('posts', 'p1', 'published');

    expect(calls[0]!.url).toBe('/api/v1/posts/p1');
    expect(calls[0]!.init?.method).toBe('PUT');
    expect(JSON.parse(calls[0]!.init?.body as string)).toEqual({ _status: 'published' });
    expect(result).toEqual({ id: 'p1', _status: 'published' });
  });
});
