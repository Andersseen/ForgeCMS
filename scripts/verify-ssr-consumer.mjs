// Packed production SSR consumer (spec 078, roadmap 0.9 / S01). `pnpm release:ssr` after `pnpm build`.
//
// An external Analog app — `@analogjs/platform` with SSR and Nitro's `node-server` preset — installs Forge
// only from packed tarballs, with strict peers and no automatic peer installation (the C03 foundation).
// It is built for production, the built server is started with plain `node`, and real HTTP requests
// check: server-rendered HTML with real content, concurrent anonymous / A / B renders that only ever
// contain their own data, a Local API server route with an explicit identity, a fully linked server and
// browser build, and a browser bundle without server-only code or secrets.
//
// Usage: node scripts/verify-ssr-consumer.mjs
// FORGE_CMS_KEEP_SSR_TMP=1 keeps the temporary app for inspection.

import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { countUnlinkedDeclarations, findDuplicateStoreEntries } from './angular-compat.mjs';

/** The versions the first-party apps use (the C03 `current` combination plus the SSR pieces). */
export const VERSIONS = {
  angular: '21.2.10',
  analog: '2.5.2',
  typescript: '5.9.2',
  rxjs: '7.8.2',
  vite: '7.1.4',
  babel: '7.29.0',
  h3: '1.15.0',
  // Non-optional peers of `@analogjs/platform` itself (its content pipeline), not of Forge.
  marked: '15.0.12',
  markedGfmHeadingId: '4.1.4',
  markedMangle: '1.1.13'
};

const FORGE_PACKAGES = [
  '@forge-cms/core',
  '@forge-cms/db',
  '@forge-cms/auth',
  '@forge-cms/storage',
  '@forge-cms/api',
  '@forge-cms/runtime',
  '@forge-cms/angular'
];

const AUTH_SECRET = 'packed-ssr-consumer-secret-0123456789abcdef';
const USERS = {
  a: { email: 'a@ssr-consumer.test', password: 'a-password-1234' },
  b: { email: 'b@ssr-consumer.test', password: 'b-password-1234' }
};
const NOTES = { public: 'Public note', a: 'Note only A may read', b: 'Note only B may read' };
// Public content with awkward text: Angular's transfer serialization must round-trip it safely (spec 080).
const AWKWARD =
  'Café </script><script>window.__pwned=1</script> & "quoted" \'single\' > <b>bold</b>';
const SECOND_ARTICLE = 'Second article';

/** Strings that must never reach the browser bundle. */
export const BROWSER_FORBIDDEN = [
  'SERVER_ONLY_SECRET_MARKER', // a server-side hook constant
  AUTH_SECRET,
  'defineCollection', // @forge-cms/core schema DSL
  'ForgeCmsRuntime', // @forge-cms/runtime
  'defineEventHandler', // h3 / Nitro routes
  'invalid server origin', // @forge-cms/angular/server
  'forwardCookies'
];

const repoRoot = process.cwd();
const keep = process.env.FORGE_CMS_KEEP_SSR_TMP === '1';

function run(command, args, cwd) {
  console.log(`$ ${[command, ...args].join(' ')}`);
  execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, CI: 'true' } });
}

function fail(message) {
  throw new Error(message);
}

function write(dir, files) {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), content);
  }
}

function pack(dir) {
  mkdirSync(dir, { recursive: true });
  const tarballs = {};
  for (const name of FORGE_PACKAGES) {
    run('pnpm', ['--filter', name, 'pack', '--pack-destination', dir], repoRoot);
    const prefix = `${name.replace('@', '').replace('/', '-')}-`;
    const file = readdirSync(dir).find(
      (entry) => entry.startsWith(prefix) && entry.endsWith('.tgz')
    );
    if (!file) fail(`could not find the tarball of ${name}`);
    tarballs[name] = `file:${join(dir, file)}`;
  }
  return tarballs;
}

function manifest(tarballs) {
  const ng = (name) => [`@angular/${name}`, VERSIONS.angular];
  return {
    name: 'forge-ssr-consumer',
    version: '0.0.0',
    private: true,
    type: 'module',
    dependencies: {
      ...tarballs,
      ...Object.fromEntries(
        ['common', 'compiler', 'core', 'platform-browser', 'platform-server', 'router'].map(ng)
      ),
      h3: VERSIONS.h3,
      rxjs: VERSIONS.rxjs,
      tslib: '^2.3.0'
    },
    devDependencies: {
      '@analogjs/platform': VERSIONS.analog,
      '@analogjs/vite-plugin-angular': VERSIONS.analog,
      '@angular/build': VERSIONS.angular,
      '@angular/compiler-cli': VERSIONS.angular,
      '@babel/core': VERSIONS.babel,
      typescript: VERSIONS.typescript,
      vite: VERSIONS.vite,
      marked: VERSIONS.marked,
      'marked-gfm-heading-id': VERSIONS.markedGfmHeadingId,
      'marked-mangle': VERSIONS.markedMangle,
      // Not Forge peers: the WebAssembly fallback of @angular/build's bundler (see verify-angular-compat).
      '@emnapi/core': '^1.7.1',
      '@emnapi/runtime': '^1.7.1'
    },
    // Forge's internal dependencies (runtime → db/auth/…) must resolve to the tarballs too.
    pnpm: { overrides: tarballs }
  };
}

const TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'bundler',
    lib: ['ES2022', 'DOM'],
    strict: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    skipLibCheck: true,
    isolatedModules: true,
    types: []
  },
  angularCompilerOptions: { strictTemplates: true, strictInjectionParameters: true },
  include: ['src/**/*.ts']
};

const APP = {
  'index.html': `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Forge SSR consumer</title><base href="/" /></head>
  <body><app-root></app-root><script type="module" src="/src/main.ts"></script></body>
</html>
`,
  'tsconfig.json': `${JSON.stringify(TSCONFIG, null, 2)}\n`,
  'tsconfig.app.json': `${JSON.stringify({ extends: './tsconfig.json' }, null, 2)}\n`,
  // The documented wiring: the linker from `@forge-cms/angular/vite` (it also links Forge in the SSR
  // build — no `ssr.noExternal` here on purpose), Analog SSR, no build-time prerender.
  'vite.config.ts': `import { createRequire } from 'node:module';
import analog from '@analogjs/platform';
import { defineConfig } from 'vite';
import { angularLinker } from '@forge-cms/angular/vite';

const fromForgeDb = createRequire(createRequire(import.meta.url).resolve('@forge-cms/db'));

export default defineConfig({
  plugins: [
    angularLinker(),
    analog({
      ssr: true,
      prerender: { routes: [] },
      nitro: {
        preset: 'node-server',
        // Not SSR-specific (spec 078 finding): @forge-cms/db's entry statically imports @libsql/client,
        // whose Node build loads a native binary Nitro's tracer cannot follow. This app only uses
        // InMemoryDatabaseAdapter, so the fetch-based build (aliased inside the inlined package) is never called.
        externals: { inline: ['@forge-cms/', 'drizzle-orm'] },
        alias: { '@libsql/client': fromForgeDb.resolve('@libsql/client/web') }
      }
    })
  ],
  build: { target: 'es2022' }
});
`,
  'src/server/content.ts': `import { defineUsersCollection } from '@forge-cms/auth';
import { defineCollection, defineField } from '@forge-cms/core';

const SECRET = 'SERVER_ONLY_SECRET_MARKER';

export const users = defineUsersCollection();

export const notes = defineCollection({
  slug: 'notes',
  fields: {
    title: defineField.text({ required: true }),
    owner: defineField.text(),
    visibility: defineField.select({ options: ['public', 'private'], required: true })
  },
  access: {
    read: ({ user }) =>
      user ? { or: [{ visibility: 'public' }, { owner: user.id }] } : { visibility: 'public' }
  },
  hooks: { beforeChange: [({ data }) => ({ ...data, signature: SECRET })] }
});

// Public content (spec 080): anonymous reads, transferable to the browser.
export const articles = defineCollection({
  slug: 'articles',
  fields: { title: defineField.text({ required: true }) },
  access: { read: () => true }
});

export const collections = [users, notes, articles];
`,
  // Isolate-level, lazily built: schema and adapters only — identity is passed per operation.
  'src/server/runtime.ts': `import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { collections } from './content';

let runtime: Promise<ForgeCmsRuntime> | undefined;

export function getRuntime(): Promise<ForgeCmsRuntime> {
  runtime ??= build();
  return runtime;
}

async function build(): Promise<ForgeCmsRuntime> {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const secret = env?.['AUTH_SECRET'];
  const serverEnv = secret !== undefined ? { AUTH_SECRET: secret } : {};
  const database = new InMemoryDatabaseAdapter();
  const auth = new UsersCollectionAuthAdapter().init({ ...serverEnv, userDatabase: database });
  // init() re-initializes every adapter with this env, so it carries the secret too.
  const cms = new ForgeCmsRuntime({
    collections,
    adapters: { database, auth, storage: new InMemoryStorageAdapter() },
    env: serverEnv
  });
  cms.init();
  await cms.syncSchema();
  const seed: [string, string][] = ${JSON.stringify(Object.values(USERS).map((u) => [u.email, u.password]))};
  const owners: string[] = [];
  for (const [email, password] of seed) {
    const created = await auth.createUser({ email, password, role: 'viewer' });
    if (!created.ok) throw new Error('seed failed');
    owners.push(created.user.id);
  }
  const [ownerA = '', ownerB = ''] = owners;
  await cms.create({ collection: 'notes', data: { title: ${JSON.stringify(NOTES.public)}, visibility: 'public' } });
  await cms.create({ collection: 'notes', data: { title: ${JSON.stringify(NOTES.a)}, owner: ownerA, visibility: 'private' } });
  await cms.create({ collection: 'notes', data: { title: ${JSON.stringify(NOTES.b)}, owner: ownerB, visibility: 'private' } });
  await cms.create({ collection: 'articles', data: { title: ${JSON.stringify(AWKWARD)} } });
  await cms.create({ collection: 'articles', data: { title: ${JSON.stringify(SECOND_ARTICLE)} } });
  return cms;
}
`,
  // Test hooks (spec 080): make the next N article reads fail, and retitle the first article.
  'src/server/failure.ts': `export const failures = { articles: 0 };
`,
  'src/server/routes/api/test/fail-articles.post.ts': `import { defineEventHandler, getQuery } from 'h3';
import { failures } from '../../../failure';

export default defineEventHandler((event) => {
  failures.articles = Number(getQuery(event)['count'] ?? 0);
  return { data: failures.articles };
});
`,
  'src/server/routes/api/test/retitle.post.ts': `import { defineEventHandler, getQuery } from 'h3';
import { getRuntime } from '../../../runtime';

export default defineEventHandler(async (event) => {
  const runtime = await getRuntime();
  const first = (await runtime.find({ collection: 'articles', sort: 'title', limit: 1 })).docs[0];
  if (!first) throw new Error('no article');
  await runtime.update({ collection: 'articles', id: first.id, data: { title: String(getQuery(event)['title']) } });
  return { data: 'ok' };
});
`,
  'src/server/routes/api/auth/login.post.ts': `import { defineEventHandler, toWebRequest } from 'h3';
import { handleLogin } from '@forge-cms/runtime';
import { getRuntime } from '../../../runtime';

export default defineEventHandler(async (event) =>
  handleLogin({ request: toWebRequest(event), env: undefined }, { runtime: await getRuntime() })
);
`,
  'src/server/routes/api/auth/me.get.ts': `import { defineEventHandler, toWebRequest } from 'h3';
import { handleMe } from '@forge-cms/runtime';
import { getRuntime } from '../../../runtime';

export default defineEventHandler(async (event) =>
  handleMe({ request: toWebRequest(event), env: undefined }, { runtime: await getRuntime() })
);
`,
  'src/server/routes/api/v1/[collection].get.ts': `import { defineEventHandler, getRouterParam, toWebRequest } from 'h3';
import { handleList } from '@forge-cms/runtime';
import { failures } from '../../../failure';
import { getRuntime } from '../../../runtime';

export default defineEventHandler(async (event) => {
  const collection = getRouterParam(event, 'collection') ?? '';
  if (collection === 'articles' && failures.articles > 0) {
    failures.articles -= 1;
    return new Response(JSON.stringify({ error: { code: 'INJECTED', message: 'INJECTED_DIAGNOSTIC_DETAIL' } }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
  return handleList(
    { request: toWebRequest(event), params: { collection }, env: undefined },
    { runtime: await getRuntime() }
  );
});
`,
  // The Local API path: server code that owns the runtime states the identity — no internal HTTP hop.
  'src/server/routes/api/site/my-notes.get.ts': `import { defineEventHandler, toWebRequest } from 'h3';
import { getRuntime } from '../../../runtime';

export default defineEventHandler(async (event) => {
  const runtime = await getRuntime();
  const user = await runtime.adapters.auth.requireAuth(toWebRequest(event)).catch(() => null);
  const result = await runtime.find({ collection: 'notes', overrideAccess: false, user, sort: 'title' });
  return { data: result.docs.map((doc) => doc['title']) };
});
`,
  'src/app/notes.component.ts': `import { Component, inject } from '@angular/core';
import { ForgeAuthSession, collectionResource, type ForgeSchema } from '@forge-cms/angular';
import type { collections } from '../server/content';

type Schema = ForgeSchema<typeof collections>;

@Component({
  selector: 'app-notes',
  template: \`
    <p id="who">{{ session.user()?.email ?? 'anonymous' }}</p>
    @if (notes.error(); as error) {
      <p role="alert">{{ error.message }}</p>
    }
    <ul>
      @for (note of notes.value()?.docs ?? []; track note.id) {
        <li>{{ note.title }}</li>
      }
    </ul>
  \`
})
export class NotesComponent {
  protected readonly session = inject(ForgeAuthSession);
  protected readonly notes = collectionResource<Schema, 'notes'>(() => ({
    collection: 'notes',
    sort: 'title'
  }));
}
`,
  // Spec 080: an anonymous public client (component-level) whose list opts into transfer, next to an
  // identical default read (the control: not transferred, so the browser repeats it).
  'src/app/public.component.ts': `import { Component, signal } from '@angular/core';
import { CmsApiService, collectionResource, provideForgeCms, type ForgeSchema } from '@forge-cms/angular';
import type { collections } from '../server/content';

type Schema = ForgeSchema<typeof collections>;

@Component({
  selector: 'app-public',
  providers: [provideForgeCms({ credentials: 'omit' }), CmsApiService],
  template: \`
    <ul id="articles">
      @for (article of articles.value()?.docs ?? []; track article.id) {
        <li>{{ article.title }}</li>
      }
    </ul>
    @if (articles.error(); as error) {
      <p id="articles-error" role="alert">{{ error.message }}</p>
    }
    <ul id="control">
      @for (article of control.value()?.docs ?? []; track article.id) {
        <li>{{ article.title }}</li>
      }
    </ul>
    <button id="next" (click)="page.set(page() + 1)">Next</button>
    <button id="reload" (click)="articles.reload()">Reload</button>
  \`
})
export class PublicComponent {
  protected readonly page = signal(1);
  protected readonly articles = collectionResource<Schema, 'articles'>(
    () => ({ collection: 'articles', sort: 'title', limit: 1, page: this.page() }),
    { transfer: 'public' }
  );
  protected readonly control = collectionResource<Schema, 'articles'>(() => ({
    collection: 'articles',
    sort: 'title',
    limit: 2
  }));
}
`,
  'src/app/app.component.ts': `import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({ selector: 'app-root', imports: [RouterOutlet], template: '<router-outlet />' })
export class AppComponent {}
`,
  'src/app/app.config.ts': `import { provideZonelessChangeDetection, type ApplicationConfig } from '@angular/core';
import { provideClientHydration, withNoHttpTransferCache } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideForgeCms } from '@forge-cms/angular';
import { NotesComponent } from './notes.component';
import { PublicComponent } from './public.component';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter([
      { path: '', pathMatch: 'full', component: NotesComponent },
      { path: 'public', component: PublicComponent }
    ]),
    provideClientHydration(withNoHttpTransferCache()),
    provideForgeCms()
  ]
};
`,
  'src/app/app.config.server.ts': `import { mergeApplicationConfig } from '@angular/core';
import { provideServerRendering } from '@angular/platform-server';
import { appConfig } from './app.config';

export const serverConfig = mergeApplicationConfig(appConfig, {
  providers: [provideServerRendering()]
});
`,
  'src/main.ts': `import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

bootstrapApplication(AppComponent, appConfig).catch((error: unknown) => console.error(error));
`,
  'src/main.server.ts': `import '@angular/platform-server/init';
import { REQUEST } from '@angular/core';
import { bootstrapApplication, type BootstrapContext } from '@angular/platform-browser';
import { renderApplication } from '@angular/platform-server';
import { provideForgeCmsServer } from '@forge-cms/angular/server';
import { AppComponent } from './app/app.component';
import { serverConfig } from './app/app.config.server';

type IncomingHeaders = Record<string, string | string[] | undefined>;

function toWebRequest(url: string, headers: IncomingHeaders): Request {
  const copy = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') copy.set(name, value);
    else if (Array.isArray(value)) copy.set(name, value.join(', '));
  }
  return new Request(new URL(url, 'http://ssr.invalid'), { headers: copy });
}

function serverOrigin(): string {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const origin = env?.['FORGE_SSR_ORIGIN'];
  if (!origin) throw new Error('FORGE_SSR_ORIGIN must be set for server rendering');
  return origin;
}

function bootstrap(context: BootstrapContext) {
  return bootstrapApplication(AppComponent, serverConfig, context);
}

export default async function render(
  url: string,
  document: string,
  { req }: { req: { headers: IncomingHeaders } }
): Promise<string> {
  return renderApplication(bootstrap, {
    document,
    url,
    platformProviders: [
      { provide: REQUEST, useValue: toWebRequest(url, req.headers) },
      provideForgeCmsServer({ origin: serverOrigin(), forwardCookies: ['forge_session'] })
    ]
  });
}
`,
  '.npmrc': 'strict-peer-dependencies=true\nauto-install-peers=false\n'
};

function jsFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((file) => /\.m?js$/.test(file))
    .map((file) => join(dir, file));
}

function checkBundles(dir) {
  const browser = jsFiles(join(dir, 'dist', 'client'));
  if (browser.length === 0) fail('no browser bundle in dist/client');
  const browserCode = browser.map((file) => readFileSync(file, 'utf8')).join('\n');
  for (const marker of BROWSER_FORBIDDEN) {
    if (browserCode.includes(marker)) fail(`the browser bundle contains '${marker}'`);
  }
  const browserUnlinked = countUnlinkedDeclarations(browserCode);
  if (browserUnlinked > 0) fail(`${browserUnlinked} unlinked declarations in the browser bundle`);

  const ssr = jsFiles(join(dir, 'dist', 'ssr'));
  if (ssr.length === 0) fail('no server bundle in dist/ssr');
  const ssrCode = ssr.map((file) => readFileSync(file, 'utf8')).join('\n');
  const ssrUnlinked = countUnlinkedDeclarations(ssrCode);
  if (ssrUnlinked > 0) fail(`${ssrUnlinked} unlinked declarations in the server bundle`);
  if (!ssrCode.includes('invalid server origin')) {
    fail('the server bundle does not contain @forge-cms/angular/server');
  }
  console.log(
    '  ✓ bundles: browser + server fully linked; no server-only code or secret in the browser'
  );
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function startServer(dir) {
  const entry = join(dir, 'dist', 'analog', 'server', 'index.mjs');
  if (!existsSync(entry)) fail(`no built server at ${entry}`);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const logs = [];
  const child = spawn(process.execPath, [entry], {
    cwd: dir,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
      AUTH_SECRET,
      FORGE_SSR_ORIGIN: origin
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr.on('data', (chunk) => logs.push(String(chunk)));
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`${origin}/api/v1/notes`);
      if (response.ok) return { child, origin, logs };
    } catch {
      // not listening yet
    }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill();
  fail(`the built server did not start:\n${logs.join('')}`);
}

async function login(origin, { email, password }) {
  const response = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ email, password })
  });
  if (!response.ok) fail(`login ${email} → ${response.status}`);
  const cookie = /forge_session=[^;]+/.exec(response.headers.get('set-cookie') ?? '')?.[0];
  if (!cookie) fail(`login ${email} set no forge_session cookie`);
  return cookie;
}

function expectHtml(html, identity) {
  const own = { anonymous: [], a: [NOTES.a], b: [NOTES.b] }[identity];
  const who = identity === 'anonymous' ? 'anonymous' : USERS[identity].email;
  const problems = [];
  if (!html.includes('ng-server-context')) problems.push('not server rendered');
  if (!html.includes(`<li>${NOTES.public}</li>`)) problems.push('public note missing');
  for (const title of [NOTES.a, NOTES.b]) {
    if (own.includes(title) !== html.includes(title))
      problems.push(`wrong visibility of "${title}"`);
  }
  if (!html.includes(`<p id="who">${who}</p>`)) problems.push(`user is not ${who}`);
  for (const other of ['a', 'b']) {
    if (other !== identity && html.includes(USERS[other].email)) problems.push(`${other} leaked`);
  }
  if (html.includes('role="alert"')) problems.push('error state rendered');
  if (problems.length > 0) fail(`${identity}: ${problems.join(', ')}`);
}

async function exercise(origin) {
  const cookies = {
    anonymous: undefined,
    a: await login(origin, USERS.a),
    b: await login(origin, USERS.b)
  };
  const get = async (path, identity) => {
    const response = await fetch(`${origin}${path}`, {
      headers: {
        accept: 'text/html',
        // A forged Host must never become the server's Forge origin.
        'x-forwarded-host': 'evil.example',
        ...(cookies[identity] && { cookie: `theme=dark; ${cookies[identity]}` })
      }
    });
    if (!response.ok) fail(`${identity} ${path} → ${response.status}`);
    return response.text();
  };

  const order = ['anonymous', 'a', 'b', 'b', 'anonymous', 'a', 'a', 'b', 'anonymous'];
  for (let round = 0; round < 5; round++) {
    const identities = round % 2 === 0 ? order : [...order].reverse();
    const pages = await Promise.all(identities.map((identity) => get('/', identity)));
    identities.forEach((identity, index) => expectHtml(pages[index], identity));
  }
  console.log(`  ✓ ${5 * order.length} concurrent SSR renders (anonymous / A / B) isolated`);

  // Spec 080: the public transfer state of concurrent renders is the same anonymous result for everyone —
  // a signed-in visitor's cookie never reaches the anonymous client, so nothing personal can be serialized.
  const publicPages = await Promise.all(
    order.map((identity) => get('/public', identity).then((html) => [identity, html]))
  );
  for (const [identity, html] of publicPages) {
    expectNoSecrets(html, `/public as ${identity}`);
    const entries = forgeEntries(transferState(html, `/public as ${identity}`));
    if (entries.length !== 1 || entries[0][1].docs[0]?.title !== AWKWARD) {
      fail(`/public as ${identity}: unexpected transfer state ${JSON.stringify(entries)}`);
    }
  }
  console.log(
    `  ✓ ${order.length} concurrent /public renders: one identical anonymous transfer entry each`
  );

  const local = await Promise.all(
    ['anonymous', 'a', 'b'].map(async (identity) =>
      JSON.parse(await get('/api/site/my-notes', identity)).data.sort()
    )
  );
  const expected = [[NOTES.public], [NOTES.a, NOTES.public].sort(), [NOTES.b, NOTES.public].sort()];
  if (JSON.stringify(local) !== JSON.stringify(expected)) {
    fail(`Local API route returned ${JSON.stringify(local)}`);
  }
  console.log('  ✓ Local API server route: per-identity results with an explicit user');
}

/** Playwright from a first-party app that already pins it (the packed consumer deliberately has none). */
async function loadChromium() {
  const require = createRequire(join(repoRoot, 'apps', 'tiny-project', 'package.json'));
  return require('@playwright/test').chromium;
}

/** Everything that must never appear in a public page's HTML or transfer state. */
function expectNoSecrets(html, label) {
  for (const marker of [
    AUTH_SECRET,
    'SERVER_ONLY_SECRET_MARKER',
    'forge_session',
    'theme=dark',
    'evil.example',
    'Bearer',
    'authorization',
    'passwordHash',
    '_sessionVersion',
    USERS.a.email,
    USERS.b.email,
    NOTES.a,
    NOTES.b,
    'ForgeApiError'
  ]) {
    if (html.toLowerCase().includes(marker.toLowerCase())) {
      fail(`${label}: the HTML contains '${marker}'`);
    }
  }
}

/** The parsed `ng-state` JSON of a server-rendered page (Angular's own serialization). */
function transferState(html, label) {
  const match = /<script id="ng-state" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!match) return {};
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    fail(`${label}: ng-state is not valid JSON (${error})`);
  }
}

const forgeEntries = (state) =>
  Object.entries(state).filter(([key]) => key.startsWith('forge:public:'));

async function hydration(origin) {
  const chromium = await loadChromium();
  const browser = await chromium.launch();
  try {
    const open = async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const log = { requests: [], problems: [] };
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.pathname.startsWith('/api/v1/articles'))
          log.requests.push(`${url.pathname}${url.search}`);
      });
      page.on('console', (message) => {
        if (
          message.type() === 'error' ||
          message.type() === 'warning' ||
          /NG0\d+/.test(message.text())
        ) {
          log.problems.push(message.text());
        }
      });
      page.on('pageerror', (error) => log.problems.push(error.message));
      // Hydration reuses the server-rendered nodes: if the list items are ever removed, the DOM was replaced.
      await page.addInitScript(() => {
        window.__removed = 0;
        new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.removedNodes) {
              // Only the transferred list: the default control list re-renders from empty (nothing transferred).
              if (
                node.nodeType === 1 &&
                (record.target.id === 'articles' || node.id === 'articles')
              )
                window.__removed++;
            }
          }
        }).observe(document, { childList: true, subtree: true });
      });
      return { page, log, context };
    };
    const hydrated = (page) => page.waitForFunction(() => document.querySelector('[ngh]') === null);
    const reads = (log, query) => log.requests.filter((url) => url.includes(query));
    const items = (page, list) => page.locator(`#${list} li`).allTextContents();

    // --- 1. initial HTML (what a client without JavaScript receives) -----------------------------------
    const html = await (
      await fetch(`${origin}/public`, { headers: { accept: 'text/html' } })
    ).text();
    if (!html.includes('ng-server-context')) fail('/public is not server rendered');
    if (!html.includes('&lt;/script&gt;')) fail('the public article is not in the HTML, escaped');
    expectNoSecrets(html, '/public');
    const entries = forgeEntries(transferState(html, '/public'));
    if (entries.length !== 1)
      fail(`expected exactly one public transfer entry, got ${entries.length}`);
    const [[entryKey, entryValue]] = entries;
    if (entryValue.docs[0]?.title !== AWKWARD) fail('the transferred article did not round-trip');
    if (entryKey.includes('127.0.0.1') || entryKey.includes('http'))
      fail(`transfer key embeds an origin: ${entryKey}`);
    if ((html.match(/<\/script>/g) ?? []).length !== (html.match(/<script/g) ?? []).length) {
      fail('the awkward article broke out of a script element');
    }
    console.log(
      '  ✓ HTML: real content, one public transfer entry, awkward text round-trips, no secrets'
    );

    // --- 2. hydration: zero duplicate reads for the transferred resource ---------------------------------
    const { page, log, context } = await open();
    await page.goto(`${origin}/public`);
    await hydrated(page);
    await page.waitForTimeout(300);
    const first = await items(page, 'articles');
    if (first.join('|') !== AWKWARD) fail(`hydrated list is ${JSON.stringify(first)}`);
    const transferred = reads(log, 'limit=1');
    const control = reads(log, 'limit=2');
    if (transferred.length !== 0)
      fail(`the transferred resource repeated its read: ${transferred}`);
    if (control.length !== 1)
      fail(`the control (default) resource should read once in the browser, got ${control.length}`);
    if ((await page.evaluate(() => window.__pwned)) !== undefined)
      fail('script injection executed');
    if ((await page.evaluate(() => window.__removed)) !== 0)
      fail('hydration replaced the server-rendered list');
    if (log.problems.length > 0) fail(`browser problems: ${log.problems.join('\n')}`);
    console.log(
      `  ✓ hydration: transferred resource 0 browser reads; the default (pre-S02) control reads ${control.length}; no console problem; DOM reused`
    );

    // --- 3. after hydration everything is a normal read -----------------------------------------------
    await page.click('#next');
    await page.waitForFunction(
      (name) => document.querySelector('#articles li')?.textContent === name,
      SECOND_ARTICLE
    );
    const next = reads(log, 'limit=1');
    if (next.length !== 1 || !next[0].includes('offset=1')) fail(`page change reads: ${next}`);
    await page.click('#reload');
    await page.waitForFunction(() => true);
    await page.waitForTimeout(300);
    if (reads(log, 'limit=1').length !== 2) fail('reload() did not perform a real read');
    console.log('  ✓ page change and reload() perform real reads');

    // --- 4. a full document load receives fresh server data ---------------------------------------------
    const retitled = 'Retitled before reload';
    await fetch(`${origin}/api/test/retitle?title=${encodeURIComponent(retitled)}`, {
      method: 'POST'
    });
    log.requests.length = 0;
    await page.goto(`${origin}/public`);
    await hydrated(page);
    await page.waitForTimeout(300);
    if ((await items(page, 'articles')).join('|') !== retitled)
      fail('a full load did not render fresh SSR data');
    if (reads(log, 'limit=1').length !== 0) fail('a full load repeated the transferred read');
    await context.close();
    console.log('  ✓ full document reload: fresh SSR data, still zero duplicate reads');

    // --- 5. an SSR failure is never transferred or cached ---------------------------------------------
    await fetch(`${origin}/api/test/fail-articles?count=2`, { method: 'POST' });
    const failed = await (
      await fetch(`${origin}/public`, { headers: { accept: 'text/html' } })
    ).text();
    if (!failed.includes('INJECTED_DIAGNOSTIC_DETAIL'))
      fail('the failing render did not show its error state');
    if (forgeEntries(transferState(failed, 'failed /public')).length !== 0)
      fail('a failed read was transferred');
    const state = JSON.stringify(transferState(failed, 'failed /public'));
    for (const marker of ['INJECTED', 'ForgeApiError', 'DIAGNOSTIC']) {
      if (state.includes(marker)) fail(`the transfer state carries '${marker}'`);
    }
    await fetch(`${origin}/api/test/fail-articles?count=2`, { method: 'POST' });
    const retry = await open();
    await retry.page.goto(`${origin}/public`);
    await retry.page.waitForFunction(() => document.querySelector('#articles li') !== null);
    if ((await items(retry.page, 'articles')).join('|') !== retitled)
      fail('the browser did not recover after a failed SSR read');
    if (reads(retry.log, 'limit=1').length !== 1)
      fail('the browser should retry exactly once after a failed SSR read');
    await retry.context.close();
    console.log(
      '  ✓ SSR failure: not serialized, not cached; the browser retried once and recovered'
    );
  } finally {
    await browser.close();
  }
}

const workDir = mkdtempSync(join(tmpdir(), 'forge-cms-ssr-'));
let server;
try {
  const tarballs = pack(join(workDir, 'packs'));
  const dir = join(workDir, 'app');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest(tarballs), null, 2)}\n`);
  write(dir, APP);

  run('pnpm', ['install', '--prefer-offline'], dir);
  const duplicates = findDuplicateStoreEntries(readdirSync(join(dir, 'node_modules', '.pnpm')));
  if (duplicates.length > 0) fail(`more than one Angular copy: ${JSON.stringify(duplicates)}`);
  run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json', '--noEmit'], dir);
  run('pnpm', ['exec', 'vite', 'build', '--logLevel', 'warn'], dir);
  checkBundles(dir);

  server = await startServer(dir);
  await exercise(server.origin);
  await hydration(server.origin);
  const output = server.logs.join('');
  for (const problem of ['JIT compiler unavailable', 'NG0', 'ERROR']) {
    if (output.includes(problem)) fail(`the server logged '${problem}':\n${output}`);
  }
  console.log(
    `\nPacked SSR consumer passed (Angular ${VERSIONS.angular}, Analog ${VERSIONS.analog}, Vite ${VERSIONS.vite}, Nitro node-server).`
  );
} finally {
  server?.child.kill();
  if (keep) console.log(`Keeping ${workDir}`);
  else rmSync(workDir, { recursive: true, force: true });
}
