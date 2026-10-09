import { beforeAll, describe, expect, it } from 'vitest';
import {
  createApp,
  createRouter,
  defineEventHandler,
  getRouterParam,
  toWebHandler,
  toWebRequest
} from 'h3';
import type { WebHandler } from 'h3';
import type { ApiContext } from '@forge-cms/api';
import type { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { handleList, handleRead } from '@forge-cms/runtime';
import strataPlugin from '../plugins/strata';
import { getServerRuntime, resetServerRuntimeForTests, type ServerEnv } from '../api/runtime';

/**
 * H3 ↔ Strata parity for the two read routes, with no duplicate live route.
 *
 * The former H3 file routes are reproduced here verbatim (the list route was deleted in 2026-09, the
 * single-document route by spec 071) and mounted on one h3 app; the real Strata plugin is mounted on
 * another. Both run on the app's own h3 1.15 through `toWebHandler`, with the same Cloudflare-style
 * event context and the same runtime. Every case sends the identical Web `Request` to both and
 * compares what a client observes: status, headers and body.
 */

const ENV: ServerEnv = { AUTH_SECRET: 'parity-test-secret-that-is-at-least-32-bytes' };
const CONTEXT = { cloudflare: { env: ENV } };
const ORIGIN = 'http://127.0.0.1:5175';

const legacyH3List = defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const context: ApiContext = {
    request: toWebRequest(event),
    params: { collection: getRouterParam(event, 'collection') ?? '' },
    env: event.context.cloudflare?.env
  };
  return handleList(context, { runtime });
});

const legacyH3Read = defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const context: ApiContext = {
    request: toWebRequest(event),
    params: {
      collection: getRouterParam(event, 'collection') ?? '',
      id: getRouterParam(event, 'id') ?? ''
    },
    env: event.context.cloudflare?.env
  };
  return handleRead(context, { runtime });
});

let h3: WebHandler;
let strata: WebHandler;
let publishedId: string;
let draftId: string;
let adminToken: string;

/** Headers a client can observe and that either transport could plausibly get wrong. */
const COMPARED_HEADERS = [
  'content-type',
  'cache-control',
  'set-cookie',
  'vary',
  'www-authenticate'
];

async function observe(handler: WebHandler, path: string, headers: HeadersInit = {}) {
  const response = await handler(new Request(`${ORIGIN}${path}`, { headers }), CONTEXT);
  const body = await response.text();
  return {
    status: response.status,
    headers: Object.fromEntries(COMPARED_HEADERS.map((name) => [name, response.headers.get(name)])),
    body: body === '' ? null : (JSON.parse(body) as unknown)
  };
}

async function expectParity(path: string, headers: HeadersInit = {}) {
  const [viaH3, viaStrata] = await Promise.all([
    observe(h3, path, headers),
    observe(strata, path, headers)
  ]);
  expect(viaStrata).toEqual(viaH3);
  return viaStrata;
}

beforeAll(async () => {
  const legacyRouter = createRouter()
    .get('/api/content/:collection', legacyH3List)
    .get('/api/content/:collection/:id', legacyH3Read);
  h3 = toWebHandler(createApp().use(legacyRouter));

  const strataRouter = createRouter();
  strataPlugin({ router: strataRouter });
  strata = toWebHandler(createApp().use(strataRouter));

  // This suite is deliberately in-memory: opt in to the development profile (spec 084).
  resetServerRuntimeForTests({ development: true });
  const runtime = await getServerRuntime(ENV);
  const auth = runtime.adapters.auth as UsersCollectionAuthAdapter;
  const admin = await auth.createUser({
    email: 'parity-admin@example.com',
    password: 'password123'
  });
  if (!admin.ok) throw new Error('could not create the parity admin');
  const login = await auth.login('parity-admin@example.com', 'password123');
  if (!login.ok) throw new Error('could not sign the parity admin in');
  adminToken = login.token;

  const published = await runtime.create({
    collection: 'posts',
    data: { title: 'Parity published', author: admin.user.id, _status: 'published' }
  });
  const draft = await runtime.create({
    collection: 'posts',
    data: { title: 'Parity draft', author: admin.user.id }
  });
  publishedId = String(published.id);
  draftId = String(draft.id);
});

describe('GET /api/content/:collection/:id — Strata matches H3', () => {
  it('a published document, anonymously', async () => {
    const result = await expectParity(`/api/content/posts/${publishedId}`);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ data: { id: publishedId, title: 'Parity published' } });
  });

  it("with relation depth: population follows the caller's access to the target", async () => {
    // `users` is not publicly readable, so an anonymous caller gets `author: null`, not the user.
    const anonymous = await expectParity(`/api/content/posts/${publishedId}?depth=1`);
    expect(anonymous.body).toMatchObject({ data: { author: null } });

    const admin = await expectParity(`/api/content/posts/${publishedId}?depth=1`, {
      authorization: `Bearer ${adminToken}`
    });
    expect(admin.body).toMatchObject({ data: { author: { email: 'parity-admin@example.com' } } });
    // Field-level access: the populated user never carries its password hash.
    expect(JSON.stringify(admin.body)).not.toContain('passwordHash');
  });

  it('a draft is a 404 for an anonymous caller', async () => {
    const result = await expectParity(`/api/content/posts/${draftId}`);
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: expect.objectContaining({ code: 'NOT_FOUND' }) });
  });

  it('a draft is readable with a Bearer token and with the session cookie', async () => {
    const bearer = await expectParity(`/api/content/posts/${draftId}?status=all`, {
      authorization: `Bearer ${adminToken}`
    });
    const cookie = await expectParity(`/api/content/posts/${draftId}?status=all`, {
      cookie: `forge_session=${adminToken}`
    });
    expect(bearer.status).toBe(200);
    expect(cookie).toEqual(bearer);
  });

  it('an unverifiable token is treated the same way: as anonymous, never as the admin', async () => {
    const published = await expectParity(`/api/content/posts/${publishedId}`, {
      authorization: 'Bearer not-a-real-token'
    });
    expect(published.status).toBe(200);
    const draft = await expectParity(`/api/content/posts/${draftId}?status=all`, {
      authorization: 'Bearer not-a-real-token'
    });
    expect(draft.status).not.toBe(200);
  });

  it('a missing id and an unknown collection', async () => {
    expect((await expectParity('/api/content/posts/does-not-exist')).status).toBe(404);
    const unknown = await expectParity(`/api/content/nope/${publishedId}`);
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({
      error: { code: 'NOT_FOUND', message: "Collection 'nope' not found" }
    });
  });

  it('an auth-only collection: denied anonymously, allowed for the admin', async () => {
    const runtime = await getServerRuntime(ENV);
    const users = await runtime.find({ collection: 'users', limit: 1 });
    const userId = String(users.docs[0]?.id);

    const anonymous = await expectParity(`/api/content/users/${userId}`);
    expect(anonymous.status).not.toBe(200);
    const admin = await expectParity(`/api/content/users/${userId}`, {
      authorization: `Bearer ${adminToken}`
    });
    expect(admin.status).toBe(200);
    expect(JSON.stringify(admin.body)).not.toContain('passwordHash');
  });
});

describe('GET /api/content/:collection — Strata still matches H3', () => {
  it('query string, filters, sort, pagination and the envelope', async () => {
    const result = await expectParity(
      '/api/content/posts?status=all&sort=title&order=asc&limit=1&offset=0',
      { authorization: `Bearer ${adminToken}` }
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ meta: { collection: 'posts', limit: 1 } });
  });

  it('drafts stay hidden from an anonymous list; bad queries are the same 400', async () => {
    const anonymous = await expectParity('/api/content/posts?title=Parity%20draft');
    expect(anonymous.body).toMatchObject({ data: [] });
    const invalid = await expectParity('/api/content/posts?limit=abc');
    expect(invalid.status).toBe(400);
  });
});
