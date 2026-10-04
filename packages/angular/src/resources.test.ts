// @vitest-environment jsdom
/**
 * Resource concurrency, reset and credential-boundary contract (spec 077, roadmap C03).
 *
 * Every request goes through a custom {@link ForgeTransport} whose responses the test settles by hand, so
 * ordering is decided by the test, never by timers. Effects run through `TestBed.tick()`.
 */
import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EnvironmentInjector,
  createEnvironmentInjector,
  provideZonelessChangeDetection,
  runInInjectionContext,
  signal
} from '@angular/core';
import type { WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { ForgeAuthSession } from './auth-session.js';
import { collectionResource, documentResource } from './resources.js';
import type { CollectionRequest, DocumentRequest } from './resources.js';
import type { UntypedForgeSchema } from './schema.js';
import { ForgeApiError, provideForgeCms } from './types.js';
import type { ForgeCmsConfig, ForgeTransport, ForgeTransportRequest } from './types.js';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

interface PendingCall {
  request: ForgeTransportRequest;
  url: string;
  signal: AbortSignal | undefined;
  resolve(body: unknown, status?: number): void;
  reject(error: unknown): void;
}

/**
 * A transport that never answers on its own. By default it **ignores** the abort signal (like a custom
 * transport that does not support cancellation); `honorAbort` makes it reject on abort the way `fetch` does.
 */
class ControlledTransport {
  readonly calls: PendingCall[] = [];
  honorAbort = false;

  readonly transport: ForgeTransport = (request) =>
    new Promise<Response>((resolve, reject) => {
      const call: PendingCall = {
        request,
        url: request.url,
        signal: request.signal,
        resolve: (body, status = 200) =>
          resolve(
            new Response(body === undefined ? null : JSON.stringify(body), {
              status,
              headers: { 'content-type': 'application/json' }
            })
          ),
        reject
      };
      if (this.honorAbort) {
        request.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        );
      }
      this.calls.push(call);
    });

  /** Calls whose URL contains `fragment`, oldest first. */
  to(fragment: string): PendingCall[] {
    return this.calls.filter((call) => call.url.includes(fragment));
  }

  last(fragment: string): PendingCall {
    const call = this.to(fragment).at(-1);
    if (call === undefined) throw new Error(`no request to ${fragment}`);
    return call;
  }
}

function list(docs: Record<string, unknown>[]): unknown {
  return {
    data: docs,
    meta: {
      collection: 'posts',
      count: docs.length,
      totalDocs: docs.length,
      page: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPrevPage: false
    }
  };
}

/** Lets the transport → JSON decode → resource handlers chain run to completion. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  TestBed.tick();
}

let transport: ControlledTransport;

function setup(config: ForgeCmsConfig = {}): void {
  transport = new ControlledTransport();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideForgeCms({ transport: transport.transport, ...config })
    ]
  });
}

function posts(
  params: WritableSignal<CollectionRequest | undefined>,
  injector: EnvironmentInjector = TestBed.inject(EnvironmentInjector)
) {
  const resource = runInInjectionContext(injector, () => collectionResource(() => params()));
  TestBed.tick();
  return resource;
}

/** Any document request, at either depth. */
type AnyDocumentRequest = DocumentRequest<UntypedForgeSchema, string, 0 | 1>;

function doc(params: WritableSignal<AnyDocumentRequest | undefined>) {
  const resource = TestBed.runInInjectionContext(() => documentResource(() => params()));
  TestBed.tick();
  return resource;
}

beforeEach(() => setup());
afterEach(() => TestBed.resetTestingModule());

describe('collectionResource — first load, success, failure', () => {
  it('stays idle without a request: nothing is sent', () => {
    const resource = posts(signal(undefined));
    expect(resource.value()).toBeUndefined();
    expect(resource.isLoading()).toBe(false);
    expect(resource.error()).toBeNull();
    expect(transport.calls).toHaveLength(0);
  });

  it('loads, then exposes the result', async () => {
    const resource = posts(signal({ collection: 'posts', limit: 2 }));
    expect(resource.isLoading()).toBe(true);
    expect(resource.value()).toBeUndefined();
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.url).toBe('/api/v1/posts?limit=2');

    transport.last('/posts').resolve(list([{ id: 'p1' }]));
    await settle();

    expect(resource.isLoading()).toBe(false);
    expect(resource.error()).toBeNull();
    expect(resource.value()?.docs).toEqual([{ id: 'p1' }]);
  });

  it('passes an AbortSignal to the transport', () => {
    posts(signal({ collection: 'posts' }));
    expect(transport.calls[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(transport.calls[0]?.signal?.aborted).toBe(false);
  });

  it('surfaces a current HTTP failure as the same ForgeApiError, with its metadata', async () => {
    const resource = posts(signal({ collection: 'posts' }));
    transport
      .last('/posts')
      .resolve(
        { error: { code: 'FORBIDDEN', message: 'No access', details: { why: 'role' } } },
        403
      );
    await settle();

    const error = resource.error();
    expect(error).toBeInstanceOf(ForgeApiError);
    expect(error).toMatchObject({ kind: 'http', status: 403, code: 'FORBIDDEN' });
    expect((error as ForgeApiError).details).toEqual({ why: 'role' });
    expect(resource.isLoading()).toBe(false);
    expect(resource.value()).toBeUndefined();
  });

  it('surfaces a current network failure, never as success', async () => {
    const resource = posts(signal({ collection: 'posts' }));
    transport.last('/posts').reject(new TypeError('Failed to fetch'));
    await settle();

    expect(resource.error()).toMatchObject({ kind: 'network', code: 'NETWORK_ERROR' });
    expect(resource.value()).toBeUndefined();
    expect(resource.isLoading()).toBe(false);
  });

  it('a failed reload clears the previous value (value and error are never both set)', async () => {
    const resource = posts(signal({ collection: 'posts' }));
    transport.last('/posts').resolve(list([{ id: 'p1' }]));
    await settle();

    resource.reload();
    TestBed.tick();
    transport.last('/posts').resolve({ error: { code: 'BOOM', message: 'down' } }, 500);
    await settle();

    expect(resource.error()).toMatchObject({ status: 500, code: 'BOOM' });
    expect(resource.value()).toBeUndefined();
  });
});

describe('collectionResource — supersession', () => {
  it('slow A, fast B: A is aborted, B wins, A resolving late changes nothing', async () => {
    const params = signal<CollectionRequest | undefined>({
      collection: 'posts',
      limit: 10,
      page: 1
    });
    const resource = posts(params);
    const a = transport.last('offset=0');

    params.set({ collection: 'posts', limit: 10, page: 2 });
    TestBed.tick();
    const b = transport.last('offset=10');

    expect(a.signal?.aborted).toBe(true);
    expect(b.signal?.aborted).toBe(false);

    b.resolve(list([{ id: 'b' }]));
    await settle();
    expect(resource.value()?.docs).toEqual([{ id: 'b' }]);

    // This transport ignores the signal: A still resolves, and must not win.
    a.resolve(list([{ id: 'a' }]));
    await settle();
    expect(resource.value()?.docs).toEqual([{ id: 'b' }]);
    expect(resource.isLoading()).toBe(false);
    expect(resource.error()).toBeNull();
  });

  it('A resolving before B, after B started, never shows A', async () => {
    const params = signal<CollectionRequest | undefined>({
      collection: 'posts',
      limit: 10,
      page: 1
    });
    const resource = posts(params);
    const a = transport.last('offset=0');
    params.set({ collection: 'posts', limit: 10, page: 2 });
    TestBed.tick();

    a.resolve(list([{ id: 'a' }]));
    await settle();

    expect(resource.value()).toBeUndefined();
    expect(resource.isLoading()).toBe(true);
  });

  it('A rejecting after B began is not a stale error', async () => {
    const params = signal<CollectionRequest | undefined>({
      collection: 'posts',
      limit: 10,
      page: 1
    });
    const resource = posts(params);
    const a = transport.last('offset=0');
    params.set({ collection: 'posts', limit: 10, page: 2 });
    TestBed.tick();

    a.resolve({ error: { code: 'BOOM', message: 'old failure' } }, 500);
    await settle();
    expect(resource.error()).toBeNull();
    expect(resource.isLoading()).toBe(true);

    transport.last('offset=10').resolve(list([{ id: 'b' }]));
    await settle();
    expect(resource.error()).toBeNull();
    expect(resource.value()?.docs).toEqual([{ id: 'b' }]);
  });

  it('an intentional abort (fetch-like transport) never becomes an error', async () => {
    transport.honorAbort = true;
    const params = signal<CollectionRequest | undefined>({
      collection: 'posts',
      limit: 10,
      page: 1
    });
    const resource = posts(params);
    params.set({ collection: 'posts', limit: 10, page: 2 });
    TestBed.tick();
    await settle();

    expect(resource.error()).toBeNull();
    expect(resource.isLoading()).toBe(true);
  });

  it('a query change resets the value: the previous query is never shown as the current one', async () => {
    const params = signal<CollectionRequest | undefined>({
      collection: 'posts',
      limit: 10,
      page: 1
    });
    const resource = posts(params);
    transport.last('offset=0').resolve(list([{ id: 'a' }]));
    await settle();
    expect(resource.value()?.docs).toEqual([{ id: 'a' }]);

    params.set({ collection: 'posts', limit: 10, page: 2 });
    TestBed.tick();
    expect(resource.value()).toBeUndefined();
    expect(resource.isLoading()).toBe(true);
    expect(resource.error()).toBeNull();
  });

  it('an equal request built anew is the same request: the value is kept while it reloads', async () => {
    const params = signal<CollectionRequest | undefined>({
      collection: 'posts',
      limit: 10,
      page: 1
    });
    const resource = posts(params);
    transport.last('offset=0').resolve(list([{ id: 'a' }]));
    await settle();

    params.set({ collection: 'posts', limit: 10, page: 1 });
    TestBed.tick();
    expect(transport.to('offset=0')).toHaveLength(2);
    expect(resource.value()?.docs).toEqual([{ id: 'a' }]);
    expect(resource.isLoading()).toBe(true);
  });
});

describe('collectionResource — idle', () => {
  it('valid → undefined aborts A, resets everything, and A can never repopulate', async () => {
    const params = signal<CollectionRequest | undefined>({ collection: 'posts' });
    const resource = posts(params);
    const first = transport.last('/posts');
    first.resolve(list([{ id: 'a' }]));
    await settle();

    params.set({ collection: 'posts', limit: 10, page: 2 });
    TestBed.tick();
    const a = transport.last('offset=10');

    params.set(undefined);
    TestBed.tick();
    expect(a.signal?.aborted).toBe(true);
    expect(resource.value()).toBeUndefined();
    expect(resource.isLoading()).toBe(false);
    expect(resource.error()).toBeNull();

    a.resolve(list([{ id: 'late' }]));
    await settle();
    expect(resource.value()).toBeUndefined();
    expect(resource.isLoading()).toBe(false);
    expect(resource.error()).toBeNull();
  });

  it('slow A → idle: a late rejection stays invisible', async () => {
    const params = signal<CollectionRequest | undefined>({ collection: 'posts' });
    const resource = posts(params);
    const a = transport.last('/posts');
    params.set(undefined);
    TestBed.tick();

    a.reject(new TypeError('Failed to fetch'));
    await settle();
    expect(resource.error()).toBeNull();
    expect(resource.isLoading()).toBe(false);
  });

  it('idle resets a previous error; undefined → valid is a fresh first load', async () => {
    const params = signal<CollectionRequest | undefined>({ collection: 'posts' });
    const resource = posts(params);
    transport.last('/posts').resolve({ error: { code: 'BOOM', message: 'x' } }, 500);
    await settle();
    expect(resource.error()).not.toBeNull();

    params.set(undefined);
    TestBed.tick();
    expect(resource.error()).toBeNull();

    params.set({ collection: 'posts' });
    TestBed.tick();
    expect(resource.isLoading()).toBe(true);
    expect(resource.value()).toBeUndefined();
    transport.last('/posts').resolve(list([{ id: 'p' }]));
    await settle();
    expect(resource.value()?.docs).toEqual([{ id: 'p' }]);
  });
});

describe('collectionResource — reload', () => {
  it('reload while loading aborts the active request and sends the current params once', async () => {
    const resource = posts(signal({ collection: 'posts' }));
    const first = transport.last('/posts');

    resource.reload();
    resource.reload();
    TestBed.tick();

    expect(first.signal?.aborted).toBe(true);
    expect(transport.to('/posts')).toHaveLength(2);

    transport.last('/posts').resolve(list([{ id: 'new' }]));
    await settle();
    first.resolve(list([{ id: 'old' }]));
    await settle();
    expect(resource.value()?.docs).toEqual([{ id: 'new' }]);
  });

  it('reload after success keeps the value while loading and clears an error', async () => {
    const resource = posts(signal({ collection: 'posts' }));
    transport.last('/posts').resolve(list([{ id: 'p1' }]));
    await settle();

    resource.reload();
    TestBed.tick();
    expect(resource.value()?.docs).toEqual([{ id: 'p1' }]);
    expect(resource.isLoading()).toBe(true);
    expect(resource.error()).toBeNull();

    transport.last('/posts').resolve(list([{ id: 'p2' }]));
    await settle();
    expect(resource.value()?.docs).toEqual([{ id: 'p2' }]);
    expect(resource.isLoading()).toBe(false);
  });

  it('reload while idle sends nothing', () => {
    const resource = posts(signal(undefined));
    resource.reload();
    TestBed.tick();
    expect(transport.calls).toHaveLength(0);
    expect(resource.isLoading()).toBe(false);
  });
});

describe('collectionResource — destroy', () => {
  it('destroying the owner aborts the request and freezes the signals', async () => {
    const owner = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
    const resource = posts(signal({ collection: 'posts' }), owner);
    const call = transport.last('/posts');

    owner.destroy();
    expect(call.signal?.aborted).toBe(true);

    call.resolve(list([{ id: 'late' }]));
    await settle();
    expect(resource.value()).toBeUndefined();
    expect(resource.isLoading()).toBe(true);
    expect(resource.error()).toBeNull();

    resource.reload();
    await settle();
    expect(transport.calls).toHaveLength(1);
  });
});

describe('documentResource', () => {
  it('A → B: A cannot overwrite B, and B never shows A while it loads', async () => {
    const params = signal<AnyDocumentRequest | undefined>({ collection: 'posts', id: 'a' });
    const resource = doc(params);
    transport.last('/posts/a').resolve({ data: { id: 'a' } });
    await settle();

    params.set({ collection: 'posts', id: 'b' });
    TestBed.tick();
    expect(resource.value()).toBeUndefined();

    params.set({ collection: 'posts', id: 'a', depth: 1 });
    TestBed.tick();
    const aAgain = transport.last('/posts/a?depth=1');
    params.set({ collection: 'posts', id: 'b' });
    TestBed.tick();

    transport.last('/posts/b').resolve({ data: { id: 'b' } });
    aAgain.resolve({ data: { id: 'a' } });
    await settle();
    expect(resource.value()).toEqual({ id: 'b' });
  });

  it('edit → create (no id): the old request never refills the resource', async () => {
    const params = signal<AnyDocumentRequest | undefined>({ collection: 'posts', id: 'a' });
    const resource = doc(params);
    const a = transport.last('/posts/a');
    params.set(undefined);
    TestBed.tick();

    a.resolve({ data: { id: 'a' } });
    await settle();
    expect(resource.value()).toBeUndefined();
    expect(a.signal?.aborted).toBe(true);
  });

  it('encodes the id and keeps the C01 error for a missing document', async () => {
    const resource = doc(signal({ collection: 'posts', id: 'a/b' }));
    expect(transport.calls[0]?.url).toBe('/api/v1/posts/a%2Fb');
    transport.calls[0]?.resolve({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    await settle();
    expect(resource.error()).toMatchObject({ kind: 'http', status: 404, code: 'NOT_FOUND' });
  });
});

describe('credential boundary — ForgeAuthSession', () => {
  const A = { id: 'user-a', email: 'a@example.com', role: 'editor' };
  const B = { id: 'user-b', email: 'b@example.com', role: 'editor' };

  /** A session whose bootstrap `/me` has been answered with `user`. */
  async function session(user: typeof A | null): Promise<ForgeAuthSession> {
    const forgeSession = TestBed.inject(ForgeAuthSession);
    const me = transport.last('/api/auth/me');
    if (user === null) me.resolve(undefined, 401);
    else me.resolve({ data: user });
    await forgeSession.ready();
    return forgeSession;
  }

  it('the bootstrap /me does not invalidate resources that loaded meanwhile', async () => {
    const resource = posts(signal({ collection: 'posts' }));
    transport.last('/posts').resolve(list([{ id: 'p' }]));
    await settle();
    await session(A);
    TestBed.tick();

    expect(transport.to('/posts')).toHaveLength(1);
    expect(resource.value()?.docs).toEqual([{ id: 'p' }]);
  });

  it('A → logout: the value disappears immediately, A’s in-flight request never commits', async () => {
    const forgeSession = await session(A);
    const resource = posts(signal({ collection: 'posts' }));
    transport.last('/posts').resolve(list([{ id: 'private-of-a' }]));
    await settle();

    resource.reload();
    TestBed.tick();
    const inFlight = transport.last('/posts');

    const logout = forgeSession.logout();
    transport.last('/logout').resolve(undefined, 204);
    await logout;

    // Synchronous: no tick has re-run the resource yet.
    expect(resource.value()).toBeUndefined();
    expect(resource.isLoading()).toBe(true);

    inFlight.resolve(list([{ id: 'private-of-a' }]));
    await settle();
    expect(inFlight.signal?.aborted).toBe(true);
    expect(resource.value()).toBeUndefined();

    // Reloaded as the anonymous visitor.
    transport.last('/posts').resolve(list([{ id: 'public' }]));
    await settle();
    expect(resource.value()?.docs).toEqual([{ id: 'public' }]);
  });

  it('a failed logout still drops the previous user’s data', async () => {
    const forgeSession = await session(A);
    const resource = posts(signal({ collection: 'posts' }));
    transport.last('/posts').resolve(list([{ id: 'private-of-a' }]));
    await settle();

    const logout = forgeSession.logout();
    transport.last('/logout').reject(new TypeError('offline'));
    await logout;

    expect(forgeSession.error()).not.toBeNull();
    expect(resource.value()).toBeUndefined();
  });

  it('anonymous → login: protected resources reload under the new identity', async () => {
    const forgeSession = await session(null);
    const resource = posts(signal({ collection: 'posts' }));
    const anonymous = transport.last('/posts');
    anonymous.resolve({ error: { code: 'UNAUTHORIZED', message: 'Sign in' } }, 401);
    await settle();
    expect(resource.error()).toMatchObject({ status: 401 });
    expect(forgeSession.status()).toBe('anonymous');
    // A 401 while anonymous is not an identity change: no refetch loop.
    expect(transport.to('/posts')).toHaveLength(1);

    const login = forgeSession.login('a@example.com', 'pw');
    transport.last('/login').resolve({ data: { token: 't', user: A } });
    await login;

    expect(resource.error()).toBeNull();
    expect(resource.isLoading()).toBe(true);
    TestBed.tick();
    expect(transport.to('/posts')).toHaveLength(2);
    transport.last('/posts').resolve(list([{ id: 'private-of-a' }]));
    await settle();
    expect(resource.value()?.docs).toEqual([{ id: 'private-of-a' }]);
  });

  it('logout → login as B: a request started under A never commits after B is current', async () => {
    const forgeSession = await session(A);
    const resource = posts(signal({ collection: 'posts' }));
    const underA = transport.last('/posts');

    const logout = forgeSession.logout();
    transport.last('/logout').resolve(undefined, 204);
    await logout;
    const login = forgeSession.login('b@example.com', 'pw');
    transport.last('/login').resolve({ data: { token: 't', user: B } });
    await login;
    TestBed.tick();

    underA.resolve(list([{ id: 'private-of-a' }]));
    await settle();
    expect(resource.value()).toBeUndefined();

    transport.last('/posts').resolve(list([{ id: 'private-of-b' }]));
    await settle();
    expect(resource.value()?.docs).toEqual([{ id: 'private-of-b' }]);
  });

  it('login as B straight from A (no logout) is an identity change too', async () => {
    const forgeSession = await session(A);
    const resource = posts(signal({ collection: 'posts' }));
    transport.last('/posts').resolve(list([{ id: 'private-of-a' }]));
    await settle();

    const login = forgeSession.login('b@example.com', 'pw');
    transport.last('/login').resolve({ data: { token: 't', user: B } });
    await login;
    expect(resource.value()).toBeUndefined();
  });

  it('a 401 while authenticated (expiry) invalidates once and reloads anonymously', async () => {
    const forgeSession = await session(A);
    const list1 = posts(signal({ collection: 'posts' }));
    const list2 = posts(signal({ collection: 'pages' }));
    transport.last('/posts').resolve(list([{ id: 'private-of-a' }]));
    await settle();

    transport.last('/pages').resolve({ error: { code: 'UNAUTHORIZED', message: 'Expired' } }, 401);
    await settle();

    expect(forgeSession.expired()).toBe(true);
    expect(list1.value()).toBeUndefined();
    expect(transport.to('/posts')).toHaveLength(2);
    expect(transport.to('/pages')).toHaveLength(2);
    // The 401 that caused the expiry belonged to the previous identity; the retry under the new one
    // is pending, not an error.
    expect(list2.error()).toBeNull();
    expect(list2.isLoading()).toBe(true);
  });

  it('signup producing a new session invalidates', async () => {
    const forgeSession = await session(null);
    const resource = posts(signal({ collection: 'posts' }));
    transport.last('/posts').resolve(list([{ id: 'public' }]));
    await settle();

    const signup = forgeSession.signup({ email: 'b@example.com', password: 'pw' });
    transport.last('/signup').resolve({ data: { token: 't', user: B } });
    await signup;
    expect(resource.value()).toBeUndefined();
    TestBed.tick();
    expect(transport.to('/posts')).toHaveLength(2);
  });

  it('a failed login while anonymous is not an identity change', async () => {
    const forgeSession = await session(null);
    const resource = posts(signal({ collection: 'posts' }));
    transport.last('/posts').resolve(list([{ id: 'public' }]));
    await settle();

    const login = forgeSession.login('x@example.com', 'bad');
    transport
      .last('/login')
      .resolve({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid' } }, 401);
    await login;
    TestBed.tick();
    expect(resource.value()?.docs).toEqual([{ id: 'public' }]);
    expect(transport.to('/posts')).toHaveLength(1);
  });

  it('refresh() finding another user (signed in elsewhere) invalidates', async () => {
    const forgeSession = await session(A);
    const resource = posts(signal({ collection: 'posts' }));
    transport.last('/posts').resolve(list([{ id: 'private-of-a' }]));
    await settle();

    const refresh = forgeSession.refresh();
    transport.last('/api/auth/me').resolve({ data: B });
    await refresh;
    expect(resource.value()).toBeUndefined();
  });
});

describe('credential boundary — authToken and custom transports', () => {
  it('a static API key reaches the transport and never invalidates', async () => {
    TestBed.resetTestingModule();
    setup({ authToken: 'api-key', credentials: 'omit' });
    const resource = posts(signal({ collection: 'posts' }));
    const call = transport.last('/posts');
    expect(call.request.headers['authorization']).toBe('Bearer api-key');
    expect(call.request.credentials).toBe('omit');
    call.resolve(list([{ id: 'p' }]));
    await settle();
    expect(resource.value()?.docs).toEqual([{ id: 'p' }]);
    expect(transport.calls).toHaveLength(1);
  });

  it('a signal-backed authToken function is observed: a new token is a new identity', async () => {
    const token = signal<string | null>('token-a');
    TestBed.resetTestingModule();
    setup({ authToken: () => token() });
    const resource = posts(signal({ collection: 'posts' }));
    const underA = transport.last('/posts');
    expect(underA.request.headers['authorization']).toBe('Bearer token-a');

    token.set('token-b');
    expect(resource.value()).toBeUndefined();
    TestBed.tick();
    expect(underA.signal?.aborted).toBe(true);
    const underB = transport.last('/posts');
    expect(underB.request.headers['authorization']).toBe('Bearer token-b');

    underA.resolve(list([{ id: 'of-a' }]));
    underB.resolve(list([{ id: 'of-b' }]));
    await settle();
    expect(resource.value()?.docs).toEqual([{ id: 'of-b' }]);

    token.set(null);
    TestBed.tick();
    expect(resource.value()).toBeUndefined();
    expect(transport.last('/posts').request.headers['authorization']).toBeUndefined();
  });
});
