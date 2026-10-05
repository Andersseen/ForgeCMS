/// <reference types="node" />
import '@angular/compiler';
import '@angular/platform-server/init';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  Component,
  REQUEST,
  inject,
  provideZonelessChangeDetection,
  type ApplicationConfig
} from '@angular/core';
import { bootstrapApplication, type BootstrapContext } from '@angular/platform-browser';
import {
  INITIAL_CONFIG,
  platformServer,
  provideServerRendering,
  renderApplication
} from '@angular/platform-server';
import {
  CmsApiService,
  ForgeAuthSession,
  collectionResource,
  provideForgeCms
} from '@forge-cms/angular';
import { provideForgeCmsServer, type ForgeServerConfig } from '@forge-cms/angular/server';
import type { ApiContext } from '@forge-cms/api';
import { UsersCollectionAuthAdapter, defineUsersCollection } from '@forge-cms/auth';
import { defineCollection, defineField } from '@forge-cms/core';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime, handleList, handleMe } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';

/**
 * Spec 078 (roadmap S01) acceptance: concurrent server renders with different identities stay isolated.
 *
 * A real `ForgeCmsRuntime` (one per "isolate", like `getServerRuntime()`) serves real Forge handlers over
 * real HTTP. A test-local `notes` collection makes a leak obvious: one public note, one only user A may
 * read, one only user B may read (row-level `access.read`). Each render is a real `renderApplication`
 * of a component using `collectionResource` + `ForgeAuthSession`, wired exactly like an app's
 * `main.server.ts` (Angular's `REQUEST` + `provideForgeCmsServer`). The server delays each identity's
 * responses by a scheduled amount, so every completion order is exercised deterministically.
 */

const users = defineUsersCollection();
const notes = defineCollection({
  slug: 'notes',
  fields: {
    title: defineField.text({ required: true }),
    owner: defineField.text(),
    visibility: defineField.select({ options: ['public', 'private'], required: true })
  },
  access: {
    read: ({ user }) =>
      user ? { or: [{ visibility: 'public' }, { owner: user.id }] } : { visibility: 'public' }
  }
});

const PUBLIC = 'Public note';
const A_ONLY = 'Note only A may read';
const B_ONLY = 'Note only B may read';
const C_ONLY = 'Note only C may read';

let runtime: ForgeCmsRuntime;
let server: Server;
let origin: string;
const tokens: Record<'a' | 'b' | 'c', string> = { a: '', b: '', c: '' };
const emails = { a: 'a@ssr.test', b: 'b@ssr.test', c: 'c@ssr.test' };

/** Per-token server behavior: a delay in ms, or `'fail'` (503). The anonymous key is `''`. */
let schedule: Record<string, number | 'fail'> = {};
let hits = 0;

function tokenOf(request: Request): string {
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length);
  const cookie = /(?:^|;\s*)forge_session=([^;]+)/.exec(request.headers.get('cookie') ?? '');
  return cookie?.[1] ?? '';
}

async function handle(request: Request): Promise<Response> {
  hits += 1;
  const behavior = schedule[tokenOf(request)] ?? 0;
  if (behavior === 'fail') {
    return new Response(JSON.stringify({ error: { code: 'DOWN', message: 'Backend down' } }), {
      status: 503,
      headers: { 'content-type': 'application/json' }
    });
  }
  if (behavior > 0) await new Promise((resolve) => setTimeout(resolve, behavior));
  const { pathname } = new URL(request.url);
  const context: ApiContext = { request, env: undefined };
  if (pathname === '/api/auth/me') return handleMe(context, { runtime });
  const list = /^\/api\/v1\/([^/]+)$/.exec(pathname);
  if (list?.[1]) return handleList({ ...context, params: { collection: list[1] } }, { runtime });
  return new Response(null, { status: 404 });
}

async function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
  }
  const response = await handle(new Request(`${origin}${req.url ?? '/'}`, { headers }));
  const out: Record<string, string> = {};
  response.headers.forEach((value, key) => (out[key] = value));
  res.writeHead(response.status, out);
  res.end(Buffer.from(await response.arrayBuffer()));
}

beforeAll(async () => {
  const database = new InMemoryDatabaseAdapter();
  const auth = new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: database });
  runtime = new ForgeCmsRuntime({
    collections: [users, notes],
    adapters: { database, auth, storage: new InMemoryStorageAdapter() }
  });
  runtime.init();
  await runtime.syncSchema();

  const ids: Record<string, string> = {};
  for (const key of ['a', 'b', 'c'] as const) {
    const created = await auth.createUser({
      email: emails[key],
      password: `${key}-password-123`,
      role: 'viewer'
    });
    if (!created.ok) throw new Error(`could not create ${key}`);
    ids[key] = created.user.id;
    const login = await auth.login(emails[key], `${key}-password-123`);
    if (!login.ok) throw new Error(`could not log in ${key}`);
    tokens[key] = login.token;
  }
  await runtime.create({ collection: 'notes', data: { title: PUBLIC, visibility: 'public' } });
  await runtime.create({
    collection: 'notes',
    data: { title: A_ONLY, owner: ids['a'], visibility: 'private' }
  });
  await runtime.create({
    collection: 'notes',
    data: { title: B_ONLY, owner: ids['b'], visibility: 'private' }
  });
  await runtime.create({
    collection: 'notes',
    data: { title: C_ONLY, owner: ids['c'], visibility: 'private' }
  });

  server = createServer((req, res) => void serve(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  schedule = {};
  hits = 0;
});

/** Every service instance a render used, to prove nothing is shared between renders. */
const seen: { api: CmsApiService; session: ForgeAuthSession }[] = [];

@Component({
  selector: 'app-root',
  template: `
    <p id="user">{{ session.user()?.email ?? 'anonymous' }} / {{ session.status() }}</p>
    @if (notes.error(); as error) {
      <p id="error">{{ error.message }}</p>
    }
    <ul>
      @for (note of notes.value()?.docs ?? []; track note.id) {
        <li>{{ note['title'] }}</li>
      }
    </ul>
  `
})
class NotesPage {
  protected readonly session = inject(ForgeAuthSession);
  protected readonly notes = collectionResource(() => ({ collection: 'notes', sort: 'title' }));

  constructor() {
    seen.push({ api: inject(CmsApiService), session: this.session });
  }
}

const appConfig: ApplicationConfig = {
  providers: [provideZonelessChangeDetection(), provideServerRendering(), provideForgeCms()]
};

function bootstrap(context: BootstrapContext) {
  return bootstrapApplication(NotesPage, appConfig, context);
}

type Identity = 'anonymous' | 'a' | 'b' | 'c';

function incoming(identity: Identity, via: 'cookie' | 'bearer'): Request {
  const headers = new Headers({ host: 'evil.example', 'x-forwarded-host': 'evil.example' });
  if (identity !== 'anonymous') {
    if (via === 'cookie') headers.set('cookie', `theme=dark; forge_session=${tokens[identity]}`);
    else headers.set('authorization', `Bearer ${tokens[identity]}`);
  }
  return new Request('http://ignored.invalid/', { headers });
}

function serverConfig(via: 'cookie' | 'bearer'): ForgeServerConfig {
  return via === 'cookie'
    ? { origin, forwardCookies: ['forge_session'] }
    : { origin, forwardAuthorization: true };
}

/** One SSR request, exactly as `main.server.ts` renders it. */
function render(identity: Identity, via: 'cookie' | 'bearer' = 'cookie'): Promise<string> {
  return renderApplication(bootstrap, {
    document: '<app-root></app-root>',
    url: '/',
    platformProviders: [
      { provide: REQUEST, useValue: incoming(identity, via) },
      provideForgeCmsServer(serverConfig(via))
    ]
  });
}

function expectOnly(html: string, identity: Identity): void {
  const own: string[] = { anonymous: [], a: [A_ONLY], b: [B_ONLY], c: [C_ONLY] }[identity];
  expect(html, identity).toContain(`<li>${PUBLIC}</li>`);
  for (const title of [A_ONLY, B_ONLY, C_ONLY]) {
    if (own.includes(title)) expect(html, identity).toContain(`<li>${title}</li>`);
    else expect(html, identity).not.toContain(title);
  }
  const who =
    identity === 'anonymous' ? 'anonymous / anonymous' : `${emails[identity]} / authenticated`;
  expect(html, identity).toContain(who);
  for (const other of ['a', 'b', 'c'] as const) {
    if (other !== identity) expect(html, identity).not.toContain(emails[other]);
  }
  expect(html).not.toContain('Loading');
  expect(html).not.toContain('id="error"');
}

const PERMUTATIONS: [number, number, number][] = [
  [0, 15, 30],
  [0, 30, 15],
  [15, 0, 30],
  [15, 30, 0],
  [30, 0, 15],
  [30, 15, 0]
];

describe('concurrent SSR identity isolation', () => {
  for (const via of ['cookie', 'bearer'] as const) {
    it(`anonymous / A / B by ${via}: every completion order, repeated, returns only each identity's data`, async () => {
      for (let round = 0; round < 3; round++) {
        for (const [anon, a, b] of PERMUTATIONS) {
          schedule = { '': anon, [tokens.a]: a, [tokens.b]: b };
          const [htmlAnon, htmlA, htmlB, htmlA2] = await Promise.all([
            render('anonymous', via),
            render('a', via),
            render('b', via),
            render('a', via)
          ]);
          expectOnly(htmlAnon, 'anonymous');
          expectOnly(htmlA, 'a');
          expectOnly(htmlB, 'b');
          expectOnly(htmlA2, 'a');
        }
      }
    });
  }

  it('renders do not share CmsApiService or ForgeAuthSession instances', async () => {
    seen.length = 0;
    await Promise.all([render('anonymous'), render('a'), render('b')]);
    expect(seen).toHaveLength(3);
    expect(new Set(seen.map((entry) => entry.api)).size).toBe(3);
    expect(new Set(seen.map((entry) => entry.session)).size).toBe(3);
  });

  it('a failing request does not poison the renders around it', async () => {
    schedule = { [tokens.c]: 'fail', [tokens.a]: 20, [tokens.b]: 5 };
    const [htmlA, htmlC, htmlB] = await Promise.all([render('a'), render('c'), render('b')]);
    expectOnly(htmlA, 'a');
    expectOnly(htmlB, 'b');
    // The failing render shows the documented error states: resource error() and session 'error'.
    expect(htmlC).toContain('id="error"');
    expect(htmlC).toContain('Backend down');
    expect(htmlC).toContain('anonymous / error');
    for (const title of [PUBLIC, A_ONLY, B_ONLY, C_ONLY]) expect(htmlC).not.toContain(title);

    schedule = {};
    expectOnly(await render('c'), 'c');
  });

  it('tearing down one render mid-request aborts its requests and leaves the others intact', async () => {
    schedule = { [tokens.b]: 60, [tokens.a]: 30 };
    const platform = platformServer([
      { provide: INITIAL_CONFIG, useValue: { document: '<app-root></app-root>', url: '/' } },
      { provide: REQUEST, useValue: incoming('b', 'cookie') },
      provideForgeCmsServer(serverConfig('cookie'))
    ]);
    const doomed = await bootstrap({ platformRef: platform });
    const session = doomed.injector.get(ForgeAuthSession);
    const survivor = render('a');
    await new Promise((resolve) => setTimeout(resolve, 10));
    platform.destroy();
    await session.ready();
    expect(session.status()).toBe('error');
    expect(session.user()).toBeNull();
    expectOnly(await survivor, 'a');
  });

  it('the same isolate-level runtime serves concurrent identities without per-request rebuilds', async () => {
    const before = runtime;
    await Promise.all([render('a'), render('b'), render('anonymous')]);
    expect(runtime).toBe(before);
  });
});

describe('Local API path (no internal HTTP hop)', () => {
  /** A server loader: it owns the runtime, resolves the identity itself and states it explicitly. */
  async function loadNotes(request: Request): Promise<string[]> {
    const user = await runtime.adapters.auth.requireAuth(request).catch(() => null);
    const result = await runtime.find({
      collection: 'notes',
      overrideAccess: false,
      user,
      sort: 'title'
    });
    return result.docs.map((doc) => String(doc['title']));
  }

  it('concurrent anonymous / A / B loaders return their own data with zero HTTP requests', async () => {
    const [anon, a, b] = await Promise.all([
      loadNotes(incoming('anonymous', 'cookie')),
      loadNotes(incoming('a', 'cookie')),
      loadNotes(incoming('b', 'bearer'))
    ]);
    expect(anon).toEqual([PUBLIC]);
    expect(a.sort()).toEqual([A_ONLY, PUBLIC].sort());
    expect(b.sort()).toEqual([B_ONLY, PUBLIC].sort());
    expect(hits).toBe(0);
  });
});
