import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { CmsApiService } from './api.service.js';
import { ForgeAuthSession } from './auth-session.js';
import { FORGE_CMS_CONFIG } from './types.js';
import type { AuthUser } from './types.js';

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

const ADMIN: AuthUser = { id: 'u1', email: 'admin@forgecms.dev', role: 'admin' };

interface Harness {
  session: ForgeAuthSession;
  api: CmsApiService;
}

function createHarness(): Harness {
  const injector = Injector.create({
    providers: [
      { provide: FORGE_CMS_CONFIG, useValue: { baseUrl: '/api/v1' } },
      { provide: CmsApiService, useClass: CmsApiService, deps: [] },
      { provide: ForgeAuthSession, useClass: ForgeAuthSession, deps: [] }
    ]
  });
  return runInInjectionContext(injector, () => ({
    api: injector.get(CmsApiService),
    session: injector.get(ForgeAuthSession)
  }));
}

beforeEach(() => {
  calls.length = 0;
  respond = () => new Response(null, { status: 401 });
  vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return Promise.resolve(respond(url));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ForgeAuthSession — bootstrap', () => {
  it('starts loading, then resolves to anonymous when /me has no session', async () => {
    const { session } = createHarness();
    expect(session.status()).toBe('loading');

    await session.ready();

    expect(session.status()).toBe('anonymous');
    expect(session.authenticated()).toBe(false);
    expect(session.user()).toBeNull();
  });

  it('resolves to authenticated when /me returns a user', async () => {
    respond = () => jsonResponse({ data: ADMIN });
    const { session } = createHarness();

    await session.ready();

    expect(session.status()).toBe('authenticated');
    expect(session.user()).toEqual(ADMIN);
  });

  it('ready() never triggers more than one bootstrap /me call', async () => {
    respond = () => jsonResponse({ data: ADMIN });
    const { session } = createHarness();

    await Promise.all([session.ready(), session.ready(), session.ready()]);

    const meCalls = calls.filter((c) => c.url.includes('/api/auth/me'));
    expect(meCalls).toHaveLength(1);
  });
});

describe('ForgeAuthSession — login/signup/logout', () => {
  it('login sets user/authenticated directly from the response, no extra /me call', async () => {
    const { session } = createHarness();
    await session.ready();
    calls.length = 0;

    respond = (url) =>
      url.includes('/api/auth/login')
        ? jsonResponse({ data: { token: 'tok', user: ADMIN } })
        : jsonResponse({ data: ADMIN });

    await session.login('admin@forgecms.dev', 'forgecms-demo');

    expect(session.authenticated()).toBe(true);
    expect(session.user()).toEqual(ADMIN);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/api/auth/login');
    expect(calls[0]!.init?.credentials).toBe('include');
  });

  it('a failed login sets error and leaves status anonymous, never throws', async () => {
    const { session } = createHarness();
    await session.ready();

    respond = () =>
      jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' } }, 401);

    await expect(session.login('a@b.com', 'wrong')).resolves.toBeUndefined();

    expect(session.status()).toBe('anonymous');
    expect(session.error()?.message).toBe('Invalid email or password');
  });

  it('signup never has a way to carry a role and sets state directly on success', async () => {
    const { session } = createHarness();
    await session.ready();

    respond = () => jsonResponse({ data: { token: 'tok', user: ADMIN } }, 201);
    await session.signup({ email: 'a@b.com', password: 'longenough' });

    const body = JSON.parse(
      calls.find((c) => c.url.includes('/api/auth/signup'))!.init!.body as string
    );
    expect(body).toEqual({ email: 'a@b.com', password: 'longenough' });
    expect(session.authenticated()).toBe(true);
  });

  it('logout clears local state even when the request fails', async () => {
    respond = () => jsonResponse({ data: ADMIN });
    const { session } = createHarness();
    await session.ready();
    expect(session.authenticated()).toBe(true);

    respond = () => new Response(null, { status: 500 });
    await session.logout();

    expect(session.authenticated()).toBe(false);
    expect(session.user()).toBeNull();
  });
});

describe('ForgeAuthSession — 401 downgrade', () => {
  it('transitions authenticated -> anonymous and sets expired() on an observed 401', async () => {
    respond = () => jsonResponse({ data: ADMIN });
    const { session, api } = createHarness();
    await session.ready();
    expect(session.authenticated()).toBe(true);

    respond = () => new Response(null, { status: 401 });
    await expect(api.getDocuments('posts')).rejects.toThrow();

    expect(session.status()).toBe('anonymous');
    expect(session.expired()).toBe(true);
  });

  it('a 403 never changes an authenticated session', async () => {
    respond = () => jsonResponse({ data: ADMIN });
    const { session, api } = createHarness();
    await session.ready();

    respond = () => jsonResponse({ error: { code: 'FORBIDDEN', message: 'Forbidden' } }, 403);
    await expect(api.getDocuments('posts')).rejects.toThrow();

    expect(session.status()).toBe('authenticated');
    expect(session.expired()).toBe(false);
  });

  it('a successful login clears a previous expired() flag', async () => {
    respond = () => jsonResponse({ data: ADMIN });
    const { session, api } = createHarness();
    await session.ready();

    respond = () => new Response(null, { status: 401 });
    await expect(api.getDocuments('posts')).rejects.toThrow();
    expect(session.expired()).toBe(true);

    respond = () => jsonResponse({ data: { token: 'tok', user: ADMIN } });
    await session.login('admin@forgecms.dev', 'forgecms-demo');

    expect(session.expired()).toBe(false);
  });
});
