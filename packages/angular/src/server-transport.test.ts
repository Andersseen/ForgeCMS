// Spec 078 (roadmap S01): CmsApiService / ForgeAuthSession on a real `platformServer`, in a Node
// environment where `window`, `location` and `document` do not exist (any access throws).
import '@angular/compiler';
import '@angular/platform-server/init';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Component,
  Injector,
  PLATFORM_ID,
  REQUEST,
  provideZonelessChangeDetection,
  runInInjectionContext,
  type ApplicationRef,
  type PlatformRef
} from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { INITIAL_CONFIG, platformServer, provideServerRendering } from '@angular/platform-server';
import { CmsApiService } from './api.service.js';
import { ForgeAuthSession } from './auth-session.js';
import { FORGE_SERVER_CONTEXT } from './server-token.js';
import {
  provideForgeCmsServer,
  resolveServerContext,
  selectCookies,
  validateServerOrigin,
  type ForgeServerConfig
} from './server-context.js';
import { FORGE_CMS_CONFIG, ForgeApiError, provideForgeCms, type ForgeCmsConfig } from './types.js';

const ORIGIN = 'http://cms.internal:3000';

interface FetchCall {
  url: string;
  init: RequestInit;
}

const calls: FetchCall[] = [];
let respond: (url: string, init: RequestInit) => Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

const LIST = {
  data: [],
  meta: {
    collection: 'posts',
    count: 0,
    totalDocs: 0,
    page: 1,
    totalPages: 0,
    hasNextPage: false,
    hasPrevPage: false
  }
};

const BROWSER_GLOBALS = ['window', 'location', 'document'] as const;
/** Forge source frames that read a browser global. Angular's own server-safe probes are allowed. */
const forgeAccesses: string[] = [];

beforeAll(() => {
  for (const name of BROWSER_GLOBALS) {
    expect(name in globalThis).toBe(false);
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        const caller = new Error().stack?.split('\n')[2] ?? '';
        if (/packages\/angular\/src\/(?!.*\.test\.ts)/.test(caller)) {
          forgeAccesses.push(`${name} ← ${caller.trim()}`);
        }
        return undefined;
      }
    });
  }
});

afterAll(() => {
  for (const name of BROWSER_GLOBALS) delete (globalThis as Record<string, unknown>)[name];
});

afterEach(() => {
  expect(forgeAccesses).toEqual([]);
});

beforeEach(() => {
  calls.length = 0;
  respond = () => Promise.resolve(json(LIST));
  vi.stubGlobal('fetch', (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return respond(url, init);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

@Component({ selector: 'app-root', template: '' })
class Root {}

interface ServerApp {
  appRef: ApplicationRef;
  platform: PlatformRef;
  api: CmsApiService;
  destroy(): void;
}

/** One render's platform + application, exactly as `renderApplication` builds them. */
async function serverApp(options: {
  request?: Request | null;
  config?: ForgeCmsConfig;
  server?: ForgeServerConfig | null;
}): Promise<ServerApp> {
  const platform = platformServer([
    { provide: INITIAL_CONFIG, useValue: { document: '<app-root></app-root>', url: '/' } },
    ...(options.request !== undefined ? [{ provide: REQUEST, useValue: options.request }] : [])
  ]);
  const server = options.server === undefined ? { origin: ORIGIN } : options.server;
  const appRef = await bootstrapApplication(
    Root,
    {
      providers: [
        provideZonelessChangeDetection(),
        provideServerRendering(),
        provideForgeCms(options.config ?? {}),
        ...(server ? provideForgeCmsServer(server) : [])
      ]
    },
    { platformRef: platform }
  );
  return {
    appRef,
    platform,
    api: appRef.injector.get(CmsApiService),
    destroy: () => platform.destroy()
  };
}

function incoming(headers: Record<string, string>): Request {
  return new Request('http://ignored.invalid/page', { headers });
}

function headersOf(call: FetchCall | undefined): Record<string, string> {
  return { ...(call?.init.headers as Record<string, string>) };
}

describe('server origin and URLs', () => {
  it('resolves the relative defaults against the configured origin, touching no browser global', async () => {
    const app = await serverApp({});
    await app.api.getDocuments('posts');
    await app.api.getCurrentUser();
    expect(calls.map((call) => call.url)).toEqual([
      `${ORIGIN}/api/v1/posts`,
      `${ORIGIN}/api/auth/me`
    ]);
    app.destroy();
  });

  it('keeps an absolute base URL as given', async () => {
    const app = await serverApp({
      config: { baseUrl: 'https://cms.example.com/api/v1/', trustedOrigins: [] }
    });
    await app.api.getDocuments('posts');
    expect(calls[0]?.url).toBe('https://cms.example.com/api/v1/posts');
    app.destroy();
  });

  it('never follows Host / X-Forwarded-Host / Forwarded to choose a target', async () => {
    const app = await serverApp({
      request: incoming({
        host: 'evil.example',
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'https',
        forwarded: 'host=evil.example;proto=https',
        cookie: 'forge_session=abc'
      }),
      server: { origin: ORIGIN, forwardCookies: ['forge_session'] }
    });
    await app.api.getDocuments('posts');
    expect(calls[0]?.url).toBe(`${ORIGIN}/api/v1/posts`);
    app.destroy();
  });

  it('encodes identifiers, so a document id cannot move the request to another origin', async () => {
    const app = await serverApp({});
    respond = () => Promise.resolve(json({ data: { id: 'x' } }));
    await app.api.getDocument('posts', '//evil.example/x');
    expect(calls[0]?.url).toBe(`${ORIGIN}/api/v1/posts/%2F%2Fevil.example%2Fx`);
    await expect(app.api.getDocument('posts', '..')).rejects.toThrow(TypeError);
    app.destroy();
  });

  it('accepts only absolute http(s) origins without path, query or credentials', () => {
    expect(validateServerOrigin('https://site.example')).toBe('https://site.example');
    expect(validateServerOrigin('https://site.example/')).toBe('https://site.example');
    expect(validateServerOrigin('http://127.0.0.1:5175')).toBe('http://127.0.0.1:5175');
    for (const bad of [
      '',
      'site.example',
      '/api',
      '//site.example',
      'ftp://site.example',
      'javascript:alert(1)',
      'https://site.example/api',
      'https://site.example?x=1',
      'https://site.example#x',
      'https://user:pass@site.example',
      'https://site example',
      'HTTPS://SITE.EXAMPLE',
      42,
      undefined
    ]) {
      expect(() => validateServerOrigin(bad), String(bad)).toThrow(/invalid server origin/);
    }
  });

  it('a malformed configured origin fails the render instead of falling back', async () => {
    await expect(serverApp({ server: { origin: 'https://site.example/api' } })).rejects.toThrow(
      /invalid server origin/
    );
  });
});

describe('identity forwarding', () => {
  it('is anonymous by default: no cookie and no authorization, even when the visitor sent both', async () => {
    const app = await serverApp({
      request: incoming({ cookie: 'forge_session=abc', authorization: 'Bearer visitor' })
    });
    await app.api.getDocuments('posts');
    expect(headersOf(calls[0])).toEqual({});
    expect(calls[0]?.init.credentials).toBeUndefined();
    app.destroy();
  });

  it('a render without REQUEST (prerender, SSG) is anonymous', async () => {
    const app = await serverApp({
      server: { origin: ORIGIN, forwardCookies: ['forge_session'], forwardAuthorization: true }
    });
    await app.api.getDocuments('posts');
    expect(headersOf(calls[0])).toEqual({});
    app.destroy();
  });

  it('forwards only the listed cookies of the current request', async () => {
    const app = await serverApp({
      request: incoming({
        cookie: 'theme=dark; forge_session=abc.def; tracking=1; forge_session=second'
      }),
      server: { origin: ORIGIN, forwardCookies: ['forge_session'] }
    });
    await app.api.getDocuments('posts');
    expect(headersOf(calls[0])).toEqual({ cookie: 'forge_session=abc.def' });
    app.destroy();
  });

  it('forwards Authorization only when enabled, and never on login/signup/logout', async () => {
    const app = await serverApp({
      request: incoming({ authorization: 'Bearer visitor-token' }),
      server: { origin: ORIGIN, forwardAuthorization: true }
    });
    await app.api.getDocuments('posts');
    expect(headersOf(calls[0])['authorization']).toBe('Bearer visitor-token');

    respond = () => Promise.resolve(json({ data: { user: { id: 'u' } } }));
    await app.api.login('a@b.c', 'pw').catch(() => undefined);
    expect(headersOf(calls[1])['authorization']).toBeUndefined();
    app.destroy();
  });

  it('sends no credential to another origin, a protocol-relative or a malformed base URL', async () => {
    const request = incoming({ cookie: 'forge_session=abc', authorization: 'Bearer visitor' });
    const server = {
      origin: ORIGIN,
      forwardCookies: ['forge_session'],
      forwardAuthorization: true
    };
    for (const baseUrl of [
      'https://other.example/api/v1',
      '//other.example/api/v1',
      'http://cms.internal:3001/api/v1',
      'https://cms.internal:3000/api/v1',
      'http://[bad/api/v1'
    ]) {
      calls.length = 0;
      const app = await serverApp({ request, server, config: { baseUrl } });
      await app.api.getDocuments('posts').catch(() => undefined);
      expect(headersOf(calls[0]), baseUrl).toEqual({});
      app.destroy();
    }
  });

  it('a trusted origin may receive the forwarded Authorization, never the site cookie', async () => {
    const app = await serverApp({
      request: incoming({ cookie: 'forge_session=abc', authorization: 'Bearer visitor' }),
      server: { origin: ORIGIN, forwardCookies: ['forge_session'], forwardAuthorization: true },
      config: {
        baseUrl: 'https://cms.example.com/api/v1',
        trustedOrigins: ['https://cms.example.com']
      }
    });
    await app.api.getDocuments('posts');
    expect(headersOf(calls[0])).toEqual({ authorization: 'Bearer visitor' });
    app.destroy();
  });

  it('the configured origin receives both forwarded credentials', async () => {
    const app = await serverApp({
      request: incoming({ cookie: 'forge_session=abc', authorization: 'Bearer visitor' }),
      server: { origin: ORIGIN, forwardCookies: ['forge_session'], forwardAuthorization: true }
    });
    await app.api.getDocuments('posts');
    expect(headersOf(calls[0])).toEqual({
      cookie: 'forge_session=abc',
      authorization: 'Bearer visitor'
    });
    app.destroy();
  });

  it('an app-owned authToken is sent alone; mixing it with visitor forwarding is refused', async () => {
    const app = await serverApp({ config: { authToken: 'server-key' } });
    await app.api.getDocuments('posts');
    expect(headersOf(calls[0])).toEqual({ authorization: 'Bearer server-key' });
    app.destroy();

    await expect(
      serverApp({
        config: { authToken: 'server-key' },
        server: { origin: ORIGIN, forwardCookies: ['forge_session'] }
      })
    ).rejects.toThrow(/authToken cannot be combined/);
    await expect(
      serverApp({
        config: { authToken: () => null },
        server: { origin: ORIGIN, forwardAuthorization: true }
      })
    ).rejects.toThrow(/authToken cannot be combined/);
  });

  it("a credentials: 'omit' client never forwards cookies, even with forwardCookies (no error)", async () => {
    const app = await serverApp({
      config: { credentials: 'omit' },
      request: incoming({ cookie: 'forge_session=abc', authorization: 'Bearer visitor' }),
      server: { origin: ORIGIN, forwardCookies: ['forge_session'] }
    });
    await app.api.getDocuments('posts');
    expect(headersOf(calls[0])).toEqual({});
    app.destroy();
  });

  it('without server config, an absolute URL ignores location, sends no credentials field and never follows redirects', async () => {
    const app = await serverApp({
      server: null,
      config: { baseUrl: 'https://cms.example.com/api/v1', authToken: 'server-key' }
    });
    await app.api.getDocuments('posts');
    expect(calls[0]?.url).toBe('https://cms.example.com/api/v1/posts');
    expect(headersOf(calls[0])).toEqual({});
    expect('credentials' in (calls[0]?.init ?? {})).toBe(false);
    expect(calls[0]?.init.redirect).toBe('manual');
    app.destroy();

    const trusted = await serverApp({
      server: null,
      config: {
        baseUrl: 'https://cms.example.com/api/v1',
        authToken: 'server-key',
        trustedOrigins: ['https://cms.example.com']
      }
    });
    await trusted.api.getDocuments('posts');
    expect(headersOf(calls[1])).toEqual({ authorization: 'Bearer server-key' });
    trusted.destroy();
  });

  it('rejects an invalid cookie name', () => {
    expect(() =>
      resolveServerContext({ origin: ORIGIN, forwardCookies: ['bad name'] }, null)
    ).toThrow(/invalid cookie name/);
    expect(() => resolveServerContext({ origin: ORIGIN, forwardCookies: ['a;b'] }, null)).toThrow(
      /invalid cookie name/
    );
  });

  it('selectCookies keeps exact names only', () => {
    expect(selectCookies('xforge_session=1; forge_session=2', ['forge_session'])).toBe(
      'forge_session=2'
    );
    expect(selectCookies('a=1; =x; b', ['a', 'b'])).toBe('a=1');
    expect(selectCookies(null, ['a'])).toBeUndefined();
    expect(selectCookies('a=1', [])).toBeUndefined();
  });
});

describe('server transport', () => {
  it('sends no credentials field and never follows a redirect', async () => {
    const app = await serverApp({});
    respond = () =>
      Promise.resolve(new Response(null, { status: 302, headers: { location: 'https://x.test' } }));
    const error = await app.api.getDocuments('posts').catch((err: unknown) => err);
    expect(calls[0]?.init.redirect).toBe('manual');
    expect('credentials' in (calls[0]?.init ?? {})).toBe(false);
    expect(error).toBeInstanceOf(ForgeApiError);
    expect((error as ForgeApiError).kind).toBe('http');
    expect((error as ForgeApiError).status).toBe(302);
    app.destroy();
  });

  it('without provideForgeCmsServer, a relative URL rejects with SERVER_ORIGIN_REQUIRED and no fetch', async () => {
    const app = await serverApp({ server: null });
    const error = await app.api.getDocuments('posts').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ForgeApiError);
    expect((error as ForgeApiError).code).toBe('SERVER_ORIGIN_REQUIRED');
    expect((error as ForgeApiError).kind).toBe('network');
    expect(calls).toHaveLength(0);
    app.destroy();
  });

  it('a custom transport still receives relative URLs without server config', async () => {
    const transport = vi.fn(() => Promise.resolve(json(LIST)));
    const app = await serverApp({ server: null, config: { transport } });
    await app.api.getDocuments('posts');
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({ url: '/api/v1/posts' }));
    app.destroy();
  });

  it('holds whenStable() open until the request settles', async () => {
    let finish: (response: Response) => void = () => undefined;
    respond = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const app = await serverApp({});
    let stable = false;
    const pending = app.api.getDocuments('posts');
    void app.appRef.whenStable().then(() => (stable = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stable).toBe(false);
    finish(json(LIST));
    await pending;
    await app.appRef.whenStable();
    expect(stable).toBe(true);
    app.destroy();
  });

  it('destroying the application aborts its in-flight requests (and only its own)', async () => {
    respond = (_url, init) =>
      new Promise((resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError'))
        );
        setTimeout(() => resolve(json(LIST)), 50);
      });
    const doomed = await serverApp({});
    const survivor = await serverApp({});
    const a = doomed.api.getDocuments('posts').catch((err: unknown) => err);
    const b = survivor.api.getDocuments('posts');
    doomed.destroy();
    const error = await a;
    expect(error).toBeInstanceOf(ForgeApiError);
    expect((error as ForgeApiError).kind).toBe('aborted');
    await expect(b).resolves.toEqual([]);
    const late = await doomed.api.getDocuments('posts').catch((err: unknown) => err);
    expect((late as ForgeApiError).kind).toBe('aborted');
    survivor.destroy();
  });

  it('two renders get two services', async () => {
    const one = await serverApp({});
    const two = await serverApp({});
    expect(one.api).not.toBe(two.api);
    one.destroy();
    two.destroy();
  });
});

describe('ForgeAuthSession on the server', () => {
  async function session(
    options: Parameters<typeof serverApp>[0]
  ): Promise<{ app: ServerApp; session: ForgeAuthSession }> {
    const app = await serverApp(options);
    const auth = app.appRef.injector.get(ForgeAuthSession);
    await auth.ready();
    return { app, session: auth };
  }

  it('anonymous /me (401) → anonymous', async () => {
    respond = () => Promise.resolve(new Response(null, { status: 401 }));
    const { app, session: auth } = await session({});
    expect(auth.status()).toBe('anonymous');
    expect(auth.user()).toBeNull();
    expect(headersOf(calls[0])).toEqual({});
    app.destroy();
  });

  it('the forwarded session cookie → authenticated as that user', async () => {
    respond = (_url, init) =>
      Promise.resolve(
        (init.headers as Record<string, string>)['cookie'] === 'forge_session=a'
          ? json({ data: { id: 'user-a', role: 'editor' } })
          : new Response(null, { status: 401 })
      );
    const { app, session: auth } = await session({
      request: incoming({ cookie: 'forge_session=a' }),
      server: { origin: ORIGIN, forwardCookies: ['forge_session'] }
    });
    expect(auth.status()).toBe('authenticated');
    expect(auth.user()?.id).toBe('user-a');
    app.destroy();
  });

  it('an outage → error, not anonymous', async () => {
    respond = () => Promise.resolve(json({ error: { code: 'X', message: 'down' } }, 503));
    const { app, session: auth } = await session({});
    expect(auth.status()).toBe('error');
    app.destroy();
  });

  it('a network failure → error', async () => {
    respond = () => Promise.reject(new TypeError('fetch failed'));
    const { app, session: auth } = await session({});
    expect(auth.status()).toBe('error');
    expect((auth.error() as ForgeApiError).kind).toBe('network');
    app.destroy();
  });

  it('without server config → error (SERVER_ORIGIN_REQUIRED), no request', async () => {
    const { app, session: auth } = await session({ server: null });
    expect(auth.status()).toBe('error');
    expect((auth.error() as ForgeApiError).code).toBe('SERVER_ORIGIN_REQUIRED');
    expect(calls).toHaveLength(0);
    app.destroy();
  });

  it('each render has its own session and bootstrap promise', async () => {
    respond = () => Promise.resolve(new Response(null, { status: 401 }));
    const one = await session({});
    const two = await session({});
    expect(one.session).not.toBe(two.session);
    expect(one.session.ready()).not.toBe(two.session.ready());
    one.app.destroy();
    two.app.destroy();
  });

  it('teardown during the bootstrap /me does not throw or leak into another render', async () => {
    respond = (_url, init) =>
      new Promise((resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError'))
        );
        setTimeout(() => resolve(new Response(null, { status: 401 })), 30);
      });
    const doomed = await serverApp({});
    const auth = doomed.appRef.injector.get(ForgeAuthSession);
    doomed.destroy();
    await auth.ready();
    expect(auth.status()).toBe('error');
    expect((auth.error() as ForgeApiError).kind).toBe('aborted');
  });
});

describe('browser platform', () => {
  it('provideForgeCmsServer is ignored: relative URL, cookie credentials, no forwarded headers', async () => {
    const injector = Injector.create({
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: REQUEST, useValue: incoming({ cookie: 'forge_session=abc' }) },
        { provide: FORGE_CMS_CONFIG, useValue: {} },
        ...provideForgeCmsServer({ origin: ORIGIN, forwardCookies: ['forge_session'] }),
        { provide: CmsApiService, useClass: CmsApiService, deps: [] }
      ]
    });
    expect(injector.get(FORGE_SERVER_CONTEXT)).toBeNull();
    const api = runInInjectionContext(injector, () => injector.get(CmsApiService));
    await api.getDocuments('posts');
    expect(calls[0]?.url).toBe('/api/v1/posts');
    expect(calls[0]?.init.credentials).toBe('include');
    expect(headersOf(calls[0])).toEqual({});
  });
});
