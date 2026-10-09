/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Injector, runInInjectionContext } from '@angular/core';
import {
  CmsApiService,
  FORGE_CMS_CONFIG,
  ForgeApiError,
  fetchTransport,
  injectForgeClient,
  type ForgeDocument,
  type ForgeGlobalDocument,
  type ForgeLocalizedValue,
  type ForgeSchema,
  type ForgeTransport,
  type ForgeWriteReceipt
} from '@forge-cms/angular';
import type { ApiContext } from '@forge-cms/api';
import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { defineCollection, defineField, defineGlobal } from '@forge-cms/core';
import { InMemoryDatabaseAdapter, LibSqlDatabaseAdapter } from '@forge-cms/db';
import type { DatabaseAdapter } from '@forge-cms/db';
import {
  ForgeCmsRuntime,
  handleCreate,
  handleGlobalRead,
  handleGlobalUpdate,
  handleList,
  handleLogin,
  handleRead,
  handleUpdate
} from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { posts, users } from '../server/api/collections';

/**
 * Spec 076 (roadmap C02) acceptance: the values the HTTP API actually sends match the public Angular
 * wire types. Every request goes through real HTTP, Forge's public handlers and the public typed client
 * (`injectForgeClient`), on the in-memory adapter and on real libSQL. Each runtime assertion sits next
 * to the compile-time type of the same value, so the types are checked against observed JSON — not
 * against the schema's ideal shape.
 *
 * The model reuses the app's real `users` and `posts` (`post.author -> users`, drafts) and adds what the
 * wire types must describe: a date, single/many relations, an upload, a field hidden by read access, a
 * localized field, a write-only collection and a global.
 */

const isStaff = ({ user }: { user: { role?: string } | null }) =>
  user?.role === 'admin' || user?.role === 'editor';

const media = defineCollection({
  slug: 'media',
  upload: true,
  fields: { filename: defineField.text({ required: true }), alt: defineField.text() },
  access: { read: () => true, create: isStaff, update: isStaff }
});

const events = defineCollection({
  slug: 'events',
  drafts: true,
  locales: ['en', 'es'],
  fields: {
    title: defineField.text({ required: true, localized: true }),
    startsAt: defineField.date({ required: true, withTime: true }),
    speaker: defineField.relation({ collection: 'users' }),
    host: defineField.relation({ collection: 'users' }),
    poster: defineField.upload({ collection: 'media' }),
    related: defineField.relation({ collection: 'posts', many: true }),
    internalNote: defineField.textarea({ access: { read: ['admin'] } })
  },
  access: { read: () => true, create: isStaff, update: isStaff }
});

/** Anyone may write, only staff may read: a write answers with a receipt (spec 068). */
const feedback = defineCollection({
  slug: 'feedback',
  fields: { message: defineField.text({ required: true }) },
  access: { create: () => true, read: isStaff }
});

const site = defineGlobal({
  slug: 'site',
  fields: { name: defineField.text({ required: true }), launchAt: defineField.date() },
  access: { read: () => true, update: isStaff }
});

const collections = [users, posts, media, events, feedback];

/** What a browser module of this app would declare — from `import type`, in a real app. */
type WireSchema = ForgeSchema<typeof collections, [typeof site]>;
type User = ForgeDocument<WireSchema, 'users'>;
type Post = ForgeDocument<WireSchema, 'posts'>;
type Media = ForgeDocument<WireSchema, 'media'>;
type Event = ForgeDocument<WireSchema, 'events'>;

const ADMIN = { email: 'owner@wire.test', password: 'wire-password-123' };
const ISO = '2026-11-20T18:30:00.000Z';

async function toWebRequest(origin: string, req: IncomingMessage): Promise<Request> {
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

/** The host's router: Forge's public handlers at the default mount, nothing re-implemented. */
function router(runtime: ForgeCmsRuntime) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const context = (params: Record<string, string> = {}): ApiContext => ({
      request,
      params,
      env: undefined
    });
    if (url.pathname === '/api/account/login' && request.method === 'POST') {
      return handleLogin(context(), { runtime, cookie: { secure: false } });
    }
    const [collection, id] = url.pathname
      .replace(/^\/api\/content\//, '')
      .split('/')
      .map((segment) => decodeURIComponent(segment));
    if (collection === 'globals' && id !== undefined) {
      if (request.method === 'GET') return handleGlobalRead(context({ global: id }), { runtime });
      if (request.method === 'PUT') return handleGlobalUpdate(context({ global: id }), { runtime });
    }
    if (collection !== undefined && id === undefined) {
      if (request.method === 'GET') return handleList(context({ collection }), { runtime });
      if (request.method === 'POST') return handleCreate(context({ collection }), { runtime });
    }
    if (collection !== undefined && id !== undefined) {
      if (request.method === 'GET') return handleRead(context({ collection, id }), { runtime });
      if (request.method === 'PUT') return handleUpdate(context({ collection, id }), { runtime });
    }
    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'No route' } }), {
      status: 404,
      headers: { 'content-type': 'application/json' }
    });
  };
}

/** One browser tab: a cookie jar over the public `fetchTransport`, sending the page's `Origin`. */
function browserTransport(origin: string): ForgeTransport {
  const cookies = new Map<string, string>();
  return async (request) => {
    const headers: Record<string, string> = { ...request.headers, origin };
    if (request.credentials === 'include' && cookies.size > 0) {
      headers['cookie'] = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    }
    const response = await fetchTransport({ ...request, headers });
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const [name, value = ''] = pair!.split('=');
      if (value === '') cookies.delete(name!.trim());
      else cookies.set(name!.trim(), value);
    }
    return response;
  };
}

function clients(origin: string) {
  const injector = Injector.create({
    providers: [
      {
        provide: FORGE_CMS_CONFIG,
        useValue: {
          baseUrl: `${origin}/api/content`,
          authBaseUrl: `${origin}/api/account`,
          trustedOrigins: [origin],
          transport: browserTransport(origin)
        }
      },
      { provide: CmsApiService, useClass: CmsApiService, deps: [] }
    ]
  });
  return runInInjectionContext(injector, () => ({
    typed: injectForgeClient<WireSchema>(),
    untyped: injector.get(CmsApiService)
  }));
}

const backends: [string, () => DatabaseAdapter][] = [
  ['in-memory', () => new InMemoryDatabaseAdapter()],
  ['libSQL', () => new LibSqlDatabaseAdapter(':memory:')]
];

describe.each(backends)('wire types match real HTTP responses (%s, spec 076)', (_name, makeDb) => {
  let server: Server;
  let origin: string;
  let runtime: ForgeCmsRuntime;
  let anonymous: ReturnType<typeof clients>['typed'];
  let admin: ReturnType<typeof clients>;
  let adminId: string;
  let publishedPostId: string;
  let draftPostId: string;

  beforeAll(async () => {
    const database = makeDb();
    const auth = new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: database });
    runtime = new ForgeCmsRuntime({
      collections,
      globals: [site],
      adapters: { database, auth, storage: new InMemoryStorageAdapter() }
    }) as unknown as ForgeCmsRuntime;
    runtime.init();
    await runtime.syncSchema();
    const created = await auth.createUser(ADMIN);
    if (!created.ok) throw new Error('could not seed the admin');
    adminId = created.user.id;
    publishedPostId = (
      await runtime.create({
        collection: 'posts',
        data: { title: 'Published post', author: adminId, _status: 'published' }
      })
    ).id as string;
    draftPostId = (
      await runtime.create({ collection: 'posts', data: { title: 'Draft post', author: adminId } })
    ).id as string;

    const route = router(runtime);
    server = createServer((req, res) => {
      void (async () => {
        const response = await route(await toWebRequest(origin, req));
        const headers: Record<string, string | string[]> = {};
        response.headers.forEach((value, key) => {
          if (key !== 'set-cookie') headers[key] = value;
        });
        const cookies = response.headers.getSetCookie();
        if (cookies.length > 0) headers['set-cookie'] = cookies;
        res.writeHead(response.status, headers);
        res.end(Buffer.from(await response.arrayBuffer()));
      })();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    anonymous = clients(origin).typed;
    admin = clients(origin);
    await admin.typed.login(ADMIN.email, ADMIN.password);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function createEvent(): Promise<{ eventId: string; posterId: string }> {
    const poster = await admin.typed.uploadFile(
      'media',
      new File(['png-bytes'], 'poster.png', { type: 'image/png' }),
      { filename: 'poster.png' }
    );
    expectTypeOf(poster).toEqualTypeOf<Media | ForgeWriteReceipt>();

    const created = await admin.typed.createDocument(
      'events',
      {
        title: 'Launch night',
        startsAt: new Date(ISO),
        speaker: adminId,
        poster: poster.id,
        related: [publishedPostId, draftPostId],
        internalNote: 'Staff only',
        _status: 'published'
      },
      { locale: 'en' }
    );
    await admin.typed.updateDocument(
      'events',
      created.id,
      { title: 'Noche de lanzamiento' },
      {
        locale: 'es'
      }
    );
    // A dangling reference can only come from data written below the runtime (a raw adapter write,
    // legacy rows): the runtime's own writes refuse a missing target (spec 064).
    await runtime.adapters.database.update('events', created.id, {
      host: 'user-that-does-not-exist'
    });
    return { eventId: created.id, posterId: poster.id };
  }

  it('depth 0: ISO date string, ids, hidden field omitted, localized map or string', async () => {
    const { eventId, posterId } = await createEvent();

    const doc = await anonymous.getDocument('events', eventId);
    expectTypeOf(doc).toEqualTypeOf<Event>();
    expectTypeOf(doc.startsAt).toEqualTypeOf<string>();
    expect(doc.startsAt).toBe(ISO);
    expectTypeOf(doc.speaker).toEqualTypeOf<string | null | undefined>();
    expect(doc.speaker).toBe(adminId);
    expect(doc.poster).toBe(posterId);
    expectTypeOf(doc.related).toEqualTypeOf<string[] | null | undefined>();
    expect(doc.related).toEqual([publishedPostId, draftPostId]);
    expectTypeOf(doc._status).toEqualTypeOf<'draft' | 'published'>();
    expect(doc._status).toBe('published');
    expect(typeof doc.created_at).toBe('string');

    // Read access: optional in the type, absent for an anonymous caller, present for an admin.
    expectTypeOf(doc.internalNote).toEqualTypeOf<string | null | undefined>();
    expect('internalNote' in doc).toBe(false);
    expect((await admin.typed.getDocument('events', eventId)).internalNote).toBe('Staff only');

    // Localized: a per-locale map without `locale`, one resolved string with it.
    expectTypeOf(doc.title).toEqualTypeOf<ForgeLocalizedValue>();
    expect(doc.title).toEqual({ en: 'Launch night', es: 'Noche de lanzamiento' });
    const spanish = await anonymous.getDocument('events', eventId, { locale: 'es' });
    expectTypeOf(spanish.title).toEqualTypeOf<string>();
    expect(spanish.title).toBe('Noche de lanzamiento');
    const fallback = await anonymous.getDocuments('events', {
      locale: 'fr',
      where: { id: eventId }
    });
    expect(fallback[0]!.title).toBe('Launch night');
  });

  it('depth 1: readable target, null for inaccessible or missing, many without hidden targets', async () => {
    const { eventId, posterId } = await createEvent();

    const doc = await anonymous.getDocument('events', eventId, { depth: 1 });
    expectTypeOf(doc.speaker).toEqualTypeOf<User | null | undefined>();
    // `users` is not readable anonymously: the target is null, exactly like a missing one.
    expect(doc.speaker).toBeNull();
    expect(doc.host).toBeNull();
    expectTypeOf(doc.poster).toEqualTypeOf<Media | null | undefined>();
    expect(doc.poster).toMatchObject({ id: posterId, filename: 'poster.png' });
    expectTypeOf(doc.related).toEqualTypeOf<Post[] | null | undefined>();
    // The draft post is invisible to an anonymous caller, so it is dropped from the array.
    expect(doc.related!.map((post) => post.id)).toEqual([publishedPostId]);
    // Targets are not populated further.
    expectTypeOf(doc.related![0]!.author).toEqualTypeOf<string>();
    expect(doc.related![0]!.author).toBe(adminId);

    const asAdmin = await admin.typed.getDocument('events', eventId, { depth: 1 });
    expect(asAdmin.speaker).toMatchObject({ id: adminId, email: ADMIN.email });
    // `access.read: []` fields are never sent, and are not in the type.
    expectTypeOf<User>().not.toHaveProperty('passwordHash');
    expect(asAdmin.speaker).not.toHaveProperty('passwordHash');
    expect(asAdmin.speaker).not.toHaveProperty('_sessionVersion');
    // Missing stays null for everyone; the admin also sees the draft target.
    expect(asAdmin.host).toBeNull();
    expect(asAdmin.related!.map((post) => post.id)).toEqual([publishedPostId, draftPostId]);
  });

  it('dates written as a date-only string or a number read back as the same ISO form', async () => {
    const dateOnly = await admin.typed.createDocument('events', {
      title: { en: 'Date only' },
      startsAt: '2026-11-20',
      _status: 'published'
    });
    // A numeric timestamp is accepted by validation but not by the typed input: the untyped client
    // is the escape hatch for it.
    const numeric = await admin.untyped.createDocument('events', {
      title: { en: 'Numeric' },
      startsAt: Date.parse(ISO),
      _status: 'published'
    });
    expect((await anonymous.getDocument('events', dateOnly.id)).startsAt).toBe(
      '2026-11-20T00:00:00.000Z'
    );
    expect((await anonymous.getDocument('events', numeric.id)).startsAt).toBe(ISO);
  });

  it('draft workflow: hidden until published, then readable', async () => {
    const draft = await admin.typed.createDocument('events', {
      title: { en: 'Soon' },
      startsAt: ISO
    });
    expect('created_at' in draft && draft._status).toBe('draft');
    const hidden = await anonymous.getDocument('events', draft.id).catch((err: unknown) => err);
    expect(hidden).toBeInstanceOf(ForgeApiError);
    expect((hidden as ForgeApiError).status).toBe(404);

    const published = await admin.typed.setDocumentStatus('events', draft.id, 'published');
    expect('created_at' in published && published._status).toBe('published');
    expect((await anonymous.getDocument('events', draft.id))._status).toBe('published');
  });

  it('a write the caller may not read back answers with a receipt', async () => {
    const receipt = await anonymous.createDocument('feedback', { message: 'Great event' });
    expectTypeOf(receipt).toEqualTypeOf<
      ForgeDocument<WireSchema, 'feedback'> | ForgeWriteReceipt
    >();
    expect(Object.keys(receipt)).toEqual(['id']);
    const full = await admin.typed.createDocument('feedback', { message: 'From staff' });
    expect('created_at' in full && full.message).toBe('From staff');
  });

  it('globals: null before the first write, then the typed document with an ISO date', async () => {
    expect(await anonymous.getGlobal('site')).toBeNull();

    const written = await admin.typed.updateGlobal('site', {
      name: 'Wire',
      launchAt: new Date(ISO)
    });
    expect('created_at' in written).toBe(true);

    const global = await anonymous.getGlobal('site');
    expectTypeOf(global).toEqualTypeOf<ForgeGlobalDocument<WireSchema, 'site'> | null>();
    expect(global).toMatchObject({ name: 'Wire', launchAt: ISO });
    expect(typeof global!.id).toBe('string');
    expect(typeof global!.created_at).toBe('string');
    expect(typeof global!.updated_at).toBe('string');
  });

  it('the untyped client stays available for dynamic use', async () => {
    const slug: string = 'posts';
    const docs = await admin.untyped.getDocuments(slug, { where: { title: 'Published post' } });
    expect(docs.map((doc) => doc['title'])).toEqual(['Published post']);
  });
});
