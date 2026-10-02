/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Injector, runInInjectionContext } from '@angular/core';
import {
  ApiAuthActionError,
  ApiAuthError,
  CmsApiService,
  FORGE_CMS_CONFIG,
  ForgeApiError,
  ForgeAuthSession,
  fetchTransport,
  type ForgeCmsConfig,
  type ForgeTransport
} from '@forge-cms/angular';
import type { ApiContext } from '@forge-cms/api';
import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import {
  CsrfError,
  ForgeCmsRuntime,
  assertCsrfSafe,
  authFailureResponse,
  handleCreate,
  handleDelete,
  handleList,
  handleLogin,
  handleLogout,
  handleMe,
  handleRead,
  handleUpdate
} from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { collections } from '../server/api/collections';

/**
 * Spec 075 (roadmap C01) acceptance: `@forge-cms/angular` driven over **real HTTP** against a host that
 * mounts Forge away from `/api/v1` and `/api/auth`, at `/content-api` and `/account-api`. Everything
 * here — server and client — uses public package exports only.
 *
 * The client runs in Node, so its transport is the public `fetchTransport` plus a tiny cookie jar and
 * the `Origin` header a same-origin browser page would send: exactly the kind of wrapper the transport
 * boundary exists for (and what SSR will need later).
 */

const CONTENT = '/content-api';
const ACCOUNT = '/account-api';
const ADMIN = { email: 'owner@mount.test', password: 'mount-password-123' };

let server: Server;
let origin: string;
let runtime: ForgeCmsRuntime;

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
  }
  const method = req.method ?? 'GET';
  return new Request(`${origin}${req.url ?? '/'}`, {
    method,
    headers,
    ...(method !== 'GET' &&
      method !== 'HEAD' &&
      chunks.length > 0 && { body: Buffer.concat(chunks) })
  });
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function requireAdmin(request: Request): Promise<Response | UsersCollectionAuthAdapter> {
  const auth = runtime.adapters.auth as UsersCollectionAuthAdapter;
  try {
    assertCsrfSafe(request);
    await auth.requireRole(request, 'admin');
    return auth;
  } catch (err) {
    if (err instanceof CsrfError) {
      return json({ error: { code: 'CSRF', message: 'Cross-site request rejected' } }, 403);
    }
    const forbidden = err instanceof Error && err.message === 'Forbidden';
    return forbidden
      ? json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } }, 403)
      : json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }, 401);
  }
}

/** The host application's router: Forge's public handlers under custom prefixes. */
async function route(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const context = (params: Record<string, string> = {}): ApiContext => ({
    request,
    params,
    env: undefined
  });
  const segments = (prefix: string) =>
    url.pathname
      .slice(prefix.length + 1)
      .split('/')
      .filter((s) => s !== '')
      .map((s) => decodeURIComponent(s));

  if (url.pathname.startsWith(`${ACCOUNT}/`)) {
    const [action, id] = segments(ACCOUNT);
    const cookie = { secure: false };
    if (action === 'login' && request.method === 'POST') {
      return handleLogin(context(), { runtime, cookie });
    }
    if (action === 'logout' && request.method === 'POST') {
      return handleLogout(context(), { runtime, cookie });
    }
    if (action === 'me' && request.method === 'GET') return handleMe(context(), { runtime });
    if (action === 'users') {
      const auth = await requireAdmin(request);
      if (auth instanceof Response) return auth;
      if (id === undefined && request.method === 'GET')
        return json({ data: await auth.listUsers() });
      if (id === undefined && request.method === 'POST') {
        const body = (await request.json()) as { email: string; password: string; role?: 'editor' };
        const result = await auth.createUser(body);
        return result.ok ? json({ data: result.user }) : authFailureResponse(result.reason);
      }
      if (id !== undefined && request.method === 'PUT') {
        const updated = await auth.updateUser(id, (await request.json()) as { name?: string });
        return updated
          ? json({ data: updated })
          : json({ error: { code: 'NOT_FOUND', message: 'User not found' } }, 404);
      }
      if (id !== undefined && request.method === 'DELETE') {
        await auth.deleteUser(id);
        return new Response(null, { status: 204 });
      }
    }
  }

  if (url.pathname.startsWith(`${CONTENT}/`)) {
    const [collection, id] = segments(CONTENT);
    if (collection !== undefined && id === undefined) {
      if (request.method === 'GET') return handleList(context({ collection }), { runtime });
      if (request.method === 'POST') return handleCreate(context({ collection }), { runtime });
    }
    if (collection !== undefined && id !== undefined) {
      const params = { collection, id };
      if (request.method === 'GET') return handleRead(context(params), { runtime });
      if (request.method === 'PUT') return handleUpdate(context(params), { runtime });
      if (request.method === 'DELETE') return handleDelete(context(params), { runtime });
    }
  }

  return json({ error: { code: 'NOT_FOUND', message: 'No such route' } }, 404);
}

async function listener(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const response = await route(await toWebRequest(req));
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie') headers[key] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) headers['set-cookie'] = cookies;
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

/** One browser tab: a cookie jar over the public `fetchTransport`, sending the page's `Origin`. */
function browserTransport(): ForgeTransport & { cookies: Map<string, string> } {
  const cookies = new Map<string, string>();
  const transport = async (request: Parameters<ForgeTransport>[0]) => {
    const headers: Record<string, string> = { ...request.headers, origin };
    if (request.credentials === 'include' && cookies.size > 0) {
      headers['cookie'] = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    }
    const response = await fetchTransport({ ...request, headers });
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(';');
      const [name, value = ''] = pair!.split('=');
      const expired = attributes.some((a) => /max-age=0/i.test(a.trim()));
      if (expired || value === '') cookies.delete(name!.trim());
      else cookies.set(name!.trim(), value);
    }
    return response;
  };
  return Object.assign(transport, { cookies });
}

function client(config: ForgeCmsConfig) {
  const injector = Injector.create({
    providers: [
      { provide: FORGE_CMS_CONFIG, useValue: config },
      { provide: CmsApiService, useClass: CmsApiService, deps: [] },
      { provide: ForgeAuthSession, useClass: ForgeAuthSession, deps: [] }
    ]
  });
  const api = runInInjectionContext(injector, () => injector.get(CmsApiService));
  const session = runInInjectionContext(injector, () => injector.get(ForgeAuthSession));
  return { api, session };
}

beforeAll(async () => {
  const database = new InMemoryDatabaseAdapter();
  const auth = new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: database });
  runtime = new ForgeCmsRuntime({
    collections,
    adapters: { database, auth, storage: new InMemoryStorageAdapter() }
  });
  runtime.init();
  await runtime.syncSchema();
  const admin = await auth.createUser(ADMIN);
  if (!admin.ok) throw new Error('could not seed the admin');
  await runtime.create({
    collection: 'posts',
    data: { title: 'Mounted hello', author: admin.user.id, _status: 'published' }
  });

  server = createServer((req, res) => {
    listener(req, res).catch((err: unknown) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'FIXTURE', message: String(err) } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('custom-mounted Forge over real HTTP (spec 075)', () => {
  it('a cookie session journey under /content-api and /account-api', async () => {
    const transport = browserTransport();
    const { api, session } = client({
      baseUrl: `${origin}${CONTENT}/`,
      authBaseUrl: `${origin}${ACCOUNT}`,
      trustedOrigins: [origin],
      transport
    });

    // Anonymous: /me is a real 401 → anonymous, not an error.
    await session.ready();
    expect(session.status()).toBe('anonymous');
    expect(session.error()).toBeNull();

    // Public content reads.
    const posts = await api.getDocuments<{ id: string; title: string }>('posts');
    expect(posts.map((p) => p.title)).toEqual(['Mounted hello']);
    expect((await api.getDocument<{ title: string }>('posts', posts[0]!.id)).title).toBe(
      'Mounted hello'
    );

    // A wrong password: curated 401, never session expiry.
    await session.login(ADMIN.email, 'wrong-password-123');
    expect(session.status()).toBe('anonymous');
    expect(session.error()).toBeInstanceOf(ApiAuthActionError);

    // Login sets the cookie; /me confirms the cookie session.
    await session.login(ADMIN.email, ADMIN.password);
    expect(session.status()).toBe('authenticated');
    expect(transport.cookies.size).toBe(1);
    expect((await api.getCurrentUser())?.email).toBe(ADMIN.email);

    // Authorized writes through the custom content base.
    const created = await api.createDocument<{ id: string; slug: string }>('posts', {
      title: 'Written through a custom mount',
      author: session.user()!.id
    });
    const updated = await api.updateDocument<{ title: string }>('posts', created.id, {
      title: 'Renamed through a custom mount'
    });
    expect(updated.title).toBe('Renamed through a custom mount');

    // A unique-constraint conflict keeps its status and Forge code.
    const conflict = await api
      .createDocument('posts', {
        title: 'Duplicate',
        slug: created.slug,
        author: session.user()!.id
      })
      .catch((err: unknown) => err);
    expect(conflict).toBeInstanceOf(ForgeApiError);
    expect((conflict as ForgeApiError).status).toBe(409);
    expect((conflict as ForgeApiError).code).toBeTypeOf('string');

    // User management under /account-api/users.
    const editor = await api.createUser({
      email: 'editor@mount.test',
      password: 'editor-password-123',
      role: 'editor'
    });
    expect((await api.getUsers()).map((u) => u.email)).toContain('editor@mount.test');
    expect((await api.updateUser(editor.id, { name: 'Ed' })).name).toBe('Ed');
    await api.deleteUser(editor.id);
    expect((await api.getUsers()).map((u) => u.email)).not.toContain('editor@mount.test');

    await api.deleteDocument('posts', created.id);

    // Logout clears the cookie on the server and in the jar; later writes are a real 401.
    await session.logout();
    expect(session.status()).toBe('anonymous');
    expect(session.error()).toBeNull();
    expect(transport.cookies.size).toBe(0);
    expect(await api.getCurrentUser()).toBeNull();
    await expect(api.getUsers()).rejects.toBeInstanceOf(ApiAuthError);
  });

  it('an encoded id reaches the handler as one segment and round-trips', async () => {
    const { api } = client({
      baseUrl: `${origin}${CONTENT}`,
      authBaseUrl: `${origin}${ACCOUNT}`,
      trustedOrigins: [origin],
      transport: browserTransport()
    });
    const error = await api.getDocument('posts', 'no such/id?#%+é').catch((err: unknown) => err);
    // `/` in the id did not select another route: the documents route answered a real 404.
    expect(error).toBeInstanceOf(ForgeApiError);
    expect((error as ForgeApiError).status).toBe(404);
    expect((error as ForgeApiError).code).not.toBe('HTTP_ERROR');
  });

  it('does not send cookies to an untrusted absolute origin', async () => {
    const transport = browserTransport();
    const trusted = client({
      baseUrl: `${origin}${CONTENT}`,
      authBaseUrl: `${origin}${ACCOUNT}`,
      trustedOrigins: [origin],
      transport
    });
    await trusted.session.login(ADMIN.email, ADMIN.password);
    expect(transport.cookies.size).toBe(1);

    // Same jar, but this client does not trust the origin: the session cookie is not attached.
    const untrusted = client({
      baseUrl: `${origin}${CONTENT}`,
      authBaseUrl: `${origin}${ACCOUNT}`,
      transport
    });
    expect(await untrusted.api.getCurrentUser()).toBeNull();
    await trusted.session.logout();
  });

  it('a /me outage is an error, not a sign-out', async () => {
    const { session } = client({
      baseUrl: `${origin}${CONTENT}`,
      authBaseUrl: 'http://127.0.0.1:9/account-api',
      trustedOrigins: [origin]
    });
    await session.ready();
    expect(session.status()).toBe('error');
    expect((session.error() as ForgeApiError).kind).toBe('network');
  });
});
