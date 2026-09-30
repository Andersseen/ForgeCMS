import { afterEach, describe, expect, it, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { CmsApiService } from './api.service.js';
import { ForgeAuthSession } from './auth-session.js';
import { encodePathSegment, isCredentialTarget, joinUrl } from './transport.js';
import {
  ApiAuthActionError,
  ApiAuthError,
  ApiValidationError,
  FORGE_CMS_CONFIG,
  ForgeApiError,
  isForgeApiError,
  type ForgeCmsConfig,
  type ForgeTransportRequest
} from './types.js';

/**
 * Spec 075 (roadmap C01): URL configuration, identifier encoding, credential policy, the structured
 * error table and the `/me`/logout session semantics — all through an injected transport, so every
 * case is deterministic. The real-HTTP proof under a custom mount lives in
 * `apps/tiny-project/src/tests/custom-mount.integration.test.ts`.
 */

type Responder = (request: ForgeTransportRequest) => Response | Promise<Response>;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const forgeError = (status: number, code: string, message: string, details?: unknown): Response =>
  json({ error: { code, message, ...(details !== undefined && { details }) } }, status);

function setup(
  config: Omit<ForgeCmsConfig, 'transport'> = {},
  respond: Responder = () => json({ data: [] })
) {
  const requests: ForgeTransportRequest[] = [];
  const state = { respond };
  const injector = Injector.create({
    providers: [
      {
        provide: FORGE_CMS_CONFIG,
        useValue: {
          ...config,
          transport: async (request: ForgeTransportRequest) => {
            requests.push(request);
            return state.respond(request);
          }
        } satisfies ForgeCmsConfig
      },
      { provide: CmsApiService, useClass: CmsApiService, deps: [] },
      { provide: ForgeAuthSession, useClass: ForgeAuthSession, deps: [] }
    ]
  });
  const api = runInInjectionContext(injector, () => injector.get(CmsApiService));
  const session = () => runInInjectionContext(injector, () => injector.get(ForgeAuthSession));
  return { api, session, requests, state };
}

async function rejection(promise: Promise<unknown>): Promise<ForgeApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ForgeApiError) return error;
    throw new Error(`expected a ForgeApiError, got ${String(error)}`);
  }
  throw new Error('expected the call to reject');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('URL configuration', () => {
  it('defaults to same-origin /api/v1 and /api/auth', async () => {
    const { api, requests, state } = setup();
    await api.getDocuments('posts');
    state.respond = () => json({ data: null }, 200);
    await api.getCurrentUser();
    expect(requests.map((r) => r.url)).toEqual(['/api/v1/posts', '/api/auth/me']);
  });

  it('works with no config provider at all (provideForgeCms() defaults)', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      calls.push(url);
      return Promise.resolve(json({ data: [] }));
    });
    const injector = Injector.create({
      providers: [{ provide: CmsApiService, useClass: CmsApiService, deps: [] }]
    });
    const api = runInInjectionContext(injector, () => injector.get(CmsApiService));
    await api.getDocuments('posts');
    expect(calls).toEqual(['/api/v1/posts']);
  });

  it.each([
    ['/cms/api', '/cms/api/posts/abc'],
    ['/cms/api/', '/cms/api/posts/abc'],
    ['/api/v1//', '/api/v1/posts/abc'],
    ['https://example.com/cms/api', 'https://example.com/cms/api/posts/abc'],
    ['https://example.com/cms/api/', 'https://example.com/cms/api/posts/abc'],
    ['https://example.com', 'https://example.com/posts/abc']
  ])('joins content base %s without doubled or lost slashes', async (baseUrl, expected) => {
    const { api, requests, state } = setup({ baseUrl });
    state.respond = () => json({ data: { id: 'abc' } });
    await api.getDocument('posts', 'abc');
    expect(requests[0]!.url).toBe(expected);
  });

  it('uses a custom auth base for every auth method', async () => {
    const { api, requests, state } = setup({ authBaseUrl: '/account-api/' });
    state.respond = (r) =>
      r.url.endsWith('/logout') || r.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : json({ data: { id: 'u', user: { id: 'u' }, token: 't' } });
    await api.login('a@b.c', 'pw');
    await api.signup({ email: 'a@b.c', password: 'pw' });
    await api.getCurrentUser();
    await api.getUsers();
    await api.createUser({ email: 'a@b.c', password: 'pw' });
    await api.updateUser('u', { name: 'x' });
    await api.deleteUser('u');
    await api.logout();
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      'POST /account-api/login',
      'POST /account-api/signup',
      'GET /account-api/me',
      'GET /account-api/users',
      'POST /account-api/users',
      'PUT /account-api/users/u',
      'DELETE /account-api/users/u',
      'POST /account-api/logout'
    ]);
  });

  it('keeps the query string after the encoded path', async () => {
    const { api, requests } = setup({ baseUrl: '/cms/' });
    await api.getDocuments('posts', { limit: 2, where: { title: 'a b' } });
    expect(requests[0]!.url).toBe('/cms/posts?limit=2&title=a+b');
  });
});

describe('identifier encoding', () => {
  const awkward = 'a b+c%d/é?x#y';
  const encoded = 'a%20b%2Bc%25d%2F%C3%A9%3Fx%23y';

  it('encodes a document id as one segment', async () => {
    const { api, requests, state } = setup();
    state.respond = () => json({ data: {} });
    await api.getDocument('posts', awkward);
    await api.updateDocument('posts', awkward, {});
    await api.previewDocument('posts', {}, { id: awkward });
    state.respond = () => new Response(null, { status: 204 });
    await api.deleteDocument('posts', awkward);
    expect(requests.map((r) => r.url)).toEqual([
      `/api/v1/posts/${encoded}`,
      `/api/v1/posts/${encoded}`,
      `/api/v1/posts/${encoded}/preview`,
      `/api/v1/posts/${encoded}`
    ]);
  });

  it('encodes a user id, a global slug and a collection segment', async () => {
    const { api, requests, state } = setup();
    state.respond = () => json({ data: {} });
    await api.updateUser(awkward, {});
    await api.getGlobal(awkward);
    await api.updateGlobal(awkward, {});
    await api.getDocuments(awkward);
    expect(requests.map((r) => r.url)).toEqual([
      `/api/auth/users/${encoded}`,
      `/api/v1/globals/${encoded}`,
      `/api/v1/globals/${encoded}`,
      `/api/v1/${encoded}`
    ]);
  });

  it('never lets an identifier escape to another path or origin', () => {
    expect(joinUrl('/api/v1', [encodePathSegment('//evil.example/x')])).toBe(
      '/api/v1/%2F%2Fevil.example%2Fx'
    );
    for (const bad of ['', '.', '..']) {
      expect(() => encodePathSegment(bad)).toThrow(TypeError);
    }
  });

  it('refuses a dot-segment id before sending anything', async () => {
    const { api, requests } = setup();
    await expect(api.deleteDocument('posts', '..')).rejects.toThrow(TypeError);
    expect(requests).toHaveLength(0);
  });
});

describe('credential policy', () => {
  it('sends cookies and the Bearer token to same-origin relative bases', async () => {
    const { api, requests } = setup({ authToken: 'tok' });
    await api.getDocuments('posts');
    expect(requests[0]!.credentials).toBe('include');
    expect(requests[0]!.headers['authorization']).toBe('Bearer tok');
  });

  it('sends neither to an absolute origin that is not trusted', async () => {
    const { api, requests } = setup({ baseUrl: 'https://cms.example.com/api', authToken: 'tok' });
    await api.getDocuments('posts');
    expect(requests[0]!.credentials).toBe('omit');
    expect(requests[0]!.headers['authorization']).toBeUndefined();
  });

  it('sends both to an explicitly trusted origin', async () => {
    const { api, requests } = setup({
      baseUrl: 'https://cms.example.com/api',
      authToken: () => 'tok',
      trustedOrigins: ['https://cms.example.com']
    });
    await api.getDocuments('posts');
    expect(requests[0]!.credentials).toBe('include');
    expect(requests[0]!.headers['authorization']).toBe('Bearer tok');
  });

  it("treats the page's own origin as trusted and credentials: 'omit' as Bearer-only", async () => {
    vi.stubGlobal('location', { origin: 'https://site.example' });
    expect(isCredentialTarget('https://site.example/api/v1/posts')).toBe(true);
    expect(isCredentialTarget('https://site.example.evil.test/api')).toBe(false);
    expect(isCredentialTarget('//other.example/api')).toBe(false);

    const { api, requests } = setup({ credentials: 'omit', authToken: 'tok' });
    await api.getDocuments('posts');
    expect(requests[0]!.credentials).toBe('omit');
    expect(requests[0]!.headers['authorization']).toBe('Bearer tok');
  });

  it('never attaches the Bearer token to login, signup or logout', async () => {
    const { api, requests, state } = setup({ authToken: 'tok' });
    state.respond = () => json({ data: { token: 't', user: { id: 'u' } } });
    await api.login('a@b.c', 'pw');
    expect(requests[0]!.headers['authorization']).toBeUndefined();
    expect(requests[0]!.credentials).toBe('include');
  });

  it('forwards the AbortSignal to the transport', async () => {
    const { api, requests } = setup();
    const controller = new AbortController();
    await api.getDocuments('posts', undefined, { signal: controller.signal });
    expect(requests[0]!.signal).toBe(controller.signal);
  });
});

describe('structured errors', () => {
  it('400 with field details → ApiValidationError whose details forms can use', async () => {
    const details = [{ field: 'title', message: 'Required', code: 'required' }];
    const { api, state } = setup({}, () =>
      forgeError(400, 'VALIDATION_ERROR', 'Invalid data', details)
    );
    const error = await rejection(api.createDocument('posts', {}));
    expect(error).toBeInstanceOf(ApiValidationError);
    expect(error).toMatchObject({ kind: 'http', status: 400, code: 'VALIDATION_ERROR', details });
    expect(error.message).toBe('Invalid data');
    state.respond = () => json({ error: 'Validation failed', details }, 400);
    expect((await rejection(api.createDocument('posts', {}))).details).toEqual(details);
  });

  it('401 → ApiAuthError and one unauthorized notification', async () => {
    const { api } = setup({}, () => forgeError(401, 'UNAUTHORIZED', 'Authentication required'));
    const listener = vi.fn();
    api.onUnauthorized(listener);
    const error = await rejection(api.getUsers());
    expect(error).toBeInstanceOf(ApiAuthError);
    expect(error).toMatchObject({ kind: 'http', status: 401, code: 'UNAUTHORIZED' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(api.unauthorized()).toBe(1);
  });

  it('403 keeps status and code and is never treated as session expiry', async () => {
    const { api } = setup({}, () => forgeError(403, 'FORBIDDEN', 'Forbidden'));
    const listener = vi.fn();
    api.onUnauthorized(listener);
    const error = await rejection(api.deleteDocument('posts', 'p1'));
    expect(error).not.toBeInstanceOf(ApiAuthError);
    expect(error).toMatchObject({ kind: 'http', status: 403, code: 'FORBIDDEN' });
    expect(listener).not.toHaveBeenCalled();
  });

  it.each([
    [404, 'NOT_FOUND', 'Document not found'],
    [413, 'PAYLOAD_TOO_LARGE', 'Request body too large'],
    [429, 'TOO_MANY_REQUESTS', 'Too many attempts'],
    [500, 'INTERNAL_ERROR', 'Internal server error']
  ])('%i keeps status, code and message', async (status, code, message) => {
    const { api } = setup({}, () => forgeError(status, code, message));
    const error = await rejection(api.getDocument('posts', 'p1'));
    expect(error).toMatchObject({ kind: 'http', status, code, message });
  });

  it('409 keeps the constraint details', async () => {
    const details = { field: 'slug', value: 'hello' };
    const { api } = setup({}, () =>
      forgeError(409, 'UNIQUE_CONSTRAINT', 'Slug already exists', details)
    );
    const error = await rejection(api.updateDocument('posts', 'p1', { slug: 'hello' }));
    expect(error).toMatchObject({
      kind: 'http',
      status: 409,
      code: 'UNIQUE_CONSTRAINT',
      message: 'Slug already exists',
      details
    });
  });

  it('an HTML error page keeps its status but never its body', async () => {
    const { api } = setup(
      {},
      () =>
        new Response('<html>cf-ray 8a1b secret-upstream</html>', {
          status: 502,
          headers: { 'content-type': 'text/html' }
        })
    );
    const error = await rejection(api.getDocuments('posts'));
    expect(error).toMatchObject({ kind: 'http', status: 502, code: 'HTTP_ERROR' });
    expect(error.message).toBe('Failed to fetch posts: 502');
    expect(JSON.stringify(error.details ?? null)).not.toContain('secret');
  });

  it('a 2xx with invalid JSON → invalid-response, not a SyntaxError', async () => {
    const { api } = setup({}, () => new Response('<!doctype html>', { status: 200 }));
    const error = await rejection(api.getDocuments('posts'));
    expect(error).toMatchObject({
      kind: 'invalid-response',
      status: 200,
      code: 'INVALID_RESPONSE'
    });
    expect(error).not.toBeInstanceOf(SyntaxError);
  });

  it('a 2xx without the data envelope → invalid-response', async () => {
    const { api } = setup({}, () => json({ ok: true }));
    expect(await rejection(api.getDocument('posts', 'p1'))).toMatchObject({
      kind: 'invalid-response'
    });
  });

  it('a rejected transport → network error with no status', async () => {
    const { api } = setup({}, () => Promise.reject(new TypeError('Failed to fetch')));
    const error = await rejection(api.getDocuments('posts'));
    expect(error).toMatchObject({ kind: 'network', code: 'NETWORK_ERROR', status: undefined });
    expect(isForgeApiError(error, 'network')).toBe(true);
    expect(error.cause).toBeInstanceOf(TypeError);
  });

  it('an aborted request → aborted, distinct from network', async () => {
    const controller = new AbortController();
    const { api } = setup({}, (request) => {
      controller.abort();
      return Promise.reject(request.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    });
    const error = await rejection(
      api.getDocuments('posts', undefined, { signal: controller.signal })
    );
    expect(error).toMatchObject({ kind: 'aborted', code: 'ABORTED', status: undefined });
  });

  it('auth actions fail with ApiAuthActionError carrying the curated message', async () => {
    const { api } = setup({}, () =>
      forgeError(401, 'INVALID_CREDENTIALS', 'Invalid email or password')
    );
    const listener = vi.fn();
    api.onUnauthorized(listener);
    const error = await rejection(api.login('a@b.c', 'wrong'));
    expect(error).toBeInstanceOf(ApiAuthActionError);
    expect(error).toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
    expect(error.message).toBe('Invalid email or password');
    expect(listener).not.toHaveBeenCalled();
  });

  it('never retries a failed write', async () => {
    const { api, requests } = setup({}, () => Promise.reject(new TypeError('Failed to fetch')));
    await rejection(api.createDocument('posts', { title: 'x' }));
    await rejection(api.updateDocument('posts', 'p1', {}));
    await rejection(api.deleteDocument('posts', 'p1'));
    await rejection(api.uploadFile('media', new File(['x'], 'x.txt')));
    await rejection(api.login('a@b.c', 'pw'));
    await rejection(api.signup({ email: 'a@b.c', password: 'pw' }));
    await rejection(api.logout());
    expect(requests).toHaveLength(7);
  });
});

describe('getCurrentUser and ForgeAuthSession', () => {
  it('/me 200 → authenticated user', async () => {
    const { api, session } = setup({}, () => json({ data: { id: 'u1', role: 'admin' } }));
    expect(await api.getCurrentUser()).toEqual({ id: 'u1', role: 'admin' });
    const s = session();
    await s.ready();
    expect(s.status()).toBe('authenticated');
  });

  it('/me 401 → null / anonymous, without an error', async () => {
    const { api, session } = setup({}, () => forgeError(401, 'UNAUTHORIZED', 'Not signed in'));
    expect(await api.getCurrentUser()).toBeNull();
    const s = session();
    await s.ready();
    expect(s.status()).toBe('anonymous');
    expect(s.error()).toBeNull();
  });

  it.each([
    ['500', () => forgeError(500, 'INTERNAL_ERROR', 'Internal server error'), 'http'],
    ['503 HTML', () => new Response('<h1>down</h1>', { status: 503 }), 'http'],
    ['403', () => forgeError(403, 'FORBIDDEN', 'Forbidden'), 'http'],
    ['network', () => Promise.reject(new TypeError('Failed to fetch')), 'network'],
    ['malformed 200', () => new Response('nope', { status: 200 }), 'invalid-response']
  ] as const)('/me %s → session error, never anonymous', async (_name, respond, kind) => {
    const { api, session } = setup({}, respond);
    await expect(api.getCurrentUser()).rejects.toBeInstanceOf(ForgeApiError);
    const s = session();
    await s.ready();
    expect(s.status()).toBe('error');
    expect(s.authenticated()).toBe(false);
    expect(s.error()).toBeInstanceOf(ForgeApiError);
    expect((s.error() as ForgeApiError).kind).toBe(kind);
  });

  it('a 403 on another request does not sign the user out', async () => {
    const { api, session, state } = setup({}, () => json({ data: { id: 'u1' } }));
    const s = session();
    await s.ready();
    state.respond = () => forgeError(403, 'FORBIDDEN', 'Forbidden');
    await rejection(api.getUsers());
    expect(s.status()).toBe('authenticated');
    expect(s.expired()).toBe(false);
  });

  it('logout success → anonymous with no error', async () => {
    const { session, state } = setup({}, () => json({ data: { id: 'u1' } }));
    const s = session();
    await s.ready();
    state.respond = () => new Response(null, { status: 204 });
    await s.logout();
    expect(s.status()).toBe('anonymous');
    expect(s.error()).toBeNull();
  });

  it.each([
    ['network failure', () => Promise.reject(new TypeError('Failed to fetch')), 'network'],
    ['500', () => forgeError(500, 'INTERNAL_ERROR', 'Internal server error'), 'http']
  ] as const)(
    'logout %s → local user cleared, anonymous, structured error kept',
    async (_name, respond, kind) => {
      const { session, state } = setup({}, () => json({ data: { id: 'u1' } }));
      const s = session();
      await s.ready();
      state.respond = respond;
      await s.logout();
      expect(s.user()).toBeNull();
      expect(s.status()).toBe('anonymous');
      expect(s.error()).toBeInstanceOf(ForgeApiError);
      expect((s.error() as ForgeApiError).kind).toBe(kind);
    }
  );
});
