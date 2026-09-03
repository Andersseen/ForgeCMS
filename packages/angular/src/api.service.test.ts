import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { CmsApiService } from './api.service.js';
import { ApiAuthActionError, ApiAuthError, ApiValidationError, FORGE_CMS_CONFIG } from './types.js';

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

describe('CmsApiService — credentials', () => {
  it('sends credentials: include on reads and writes alike', async () => {
    const api = createService();
    respond = () => jsonResponse({ data: [] });

    await api.getDocuments('services');
    await api.getCollections();
    await api.getCurrentUser();

    for (const call of calls) {
      expect(call.init?.credentials).toBe('include');
    }
  });
});

describe('CmsApiService — auth actions', () => {
  it('signup posts email/password/name with no role field, credentials included', async () => {
    const api = createService();
    respond = () => jsonResponse({ data: { token: 'tok', user: { id: 'u1' } } }, 201);

    await api.signup({ email: 'a@b.com', password: 'longenough', name: 'Ada' });

    expect(calls[0]!.url).toBe('/api/auth/signup');
    expect(calls[0]!.init?.credentials).toBe('include');
    expect(JSON.parse(calls[0]!.init?.body as string)).toEqual({
      email: 'a@b.com',
      password: 'longenough',
      name: 'Ada'
    });
  });

  it('logout posts to /api/auth/logout with credentials included', async () => {
    const api = createService();
    respond = () => new Response(null, { status: 204 });

    await api.logout();

    expect(calls[0]!.url).toBe('/api/auth/logout');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(calls[0]!.init?.credentials).toBe('include');
  });

  it('login/signup/logout throw ApiAuthActionError carrying the server message and code', async () => {
    const api = createService();
    respond = () =>
      jsonResponse(
        { error: { code: 'UNIQUE_CONSTRAINT', message: 'Email is already in use' } },
        409
      );

    const err = await api.signup({ email: 'a@b.com', password: 'longenough' }).catch((e) => e);

    expect(err).toBeInstanceOf(ApiAuthActionError);
    expect(err.message).toBe('Email is already in use');
    expect(err.code).toBe('UNIQUE_CONSTRAINT');
    expect(err.status).toBe(409);
  });

  it('bumps the unauthorized signal once per observed 401 (for ForgeAuthSession)', async () => {
    const api = createService();
    respond = () => jsonResponse({ error: 'Unauthorized' }, 401);

    expect(api.unauthorized()).toBe(0);
    await expect(api.getDocuments('services')).rejects.toBeInstanceOf(ApiAuthError);
    expect(api.unauthorized()).toBe(1);
    await expect(api.getDocument('services', 'x')).rejects.toBeInstanceOf(ApiAuthError);
    expect(api.unauthorized()).toBe(2);
  });

  it('does not bump unauthorized on a 403', async () => {
    const api = createService();
    respond = () => jsonResponse({ error: { code: 'FORBIDDEN', message: 'Forbidden' } }, 403);

    await expect(api.getDocuments('services')).rejects.toThrow();
    expect(api.unauthorized()).toBe(0);
  });
});

describe('CmsApiService — error message fallback', () => {
  it("surfaces an h3-style { statusMessage } body's text instead of a generic fallback", async () => {
    const api = createService();
    respond = () => jsonResponse({ statusMessage: 'Cannot remove the last remaining admin' }, 409);

    await expect(api.updateUser('u1', { role: 'viewer' })).rejects.toThrow(
      'Cannot remove the last remaining admin'
    );
  });

  it("unwraps the real Forge envelope's nested error.message instead of stringifying the object", async () => {
    const api = createService();
    respond = () =>
      jsonResponse(
        { error: { code: 'UNIQUE_CONSTRAINT', message: 'Cannot remove the last remaining admin' } },
        409
      );

    const err = await api.updateUser('u1', { role: 'viewer' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('Cannot remove the last remaining admin');
    expect((err as Error).message).not.toContain('object Object');
  });

  it('unwraps a validation envelope whose details nest inside error, not at the top level', async () => {
    const api = createService();
    respond = () =>
      jsonResponse(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Document validation failed',
            details: [{ field: 'title', message: 'Required', code: 'required' }]
          }
        },
        400
      );

    const err = await api.createDocument('posts', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiValidationError);
    expect((err as ApiValidationError).details).toEqual([
      { field: 'title', message: 'Required', code: 'required' }
    ]);
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
