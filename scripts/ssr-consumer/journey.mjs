// The S03 production consumer journey (spec 081, roadmap 0.9). Run by `pnpm release:ssr`.
//
// The app is `apps/tiny-project`'s own source — public pages, the existing reusable `@forge-cms/admin`
// routes, collections, runtime, thin server routes — copied into a temporary app that installs Forge only
// from packed tarballs (strict peers). Only the manifest, `vite.config.ts` (the public `angularLinker` and a
// Nitro preset), `tsconfig`, `wrangler.toml` and a request observer are consumer-specific.
//
// It is built twice and each build is served by its **production** server, never a dev server. Both are COMPLETE
// durable profiles (spec 084, roadmap 0.10 / P03) — the app refuses to start in production without one:
//   - node:       Nitro `node-server`, an on-disk libSQL database and the real S3 StorageAdapter against Garage
//                 (supplied by `pnpm test:s3 profiles` as FORGE_S3_TEST_*), started with plain `node`;
//   - cloudflare: the Cloudflare Pages output under local workerd (`wrangler pages dev`) with local D1 + local R2
//                 bindings (local evidence — not a remote deployment).
// The same browser journey then walks bootstrap → draft → publish → SSR → hydrate → edit → fresh SSR → draft,
// with a server restart in the middle (same database file / D1 + R2 directory), and finally the durable-file
// journey of `files.mjs` (multipart upload → handleFile → restart → delete).

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { assertCleanConsumer } from '../certification/artifacts.mjs';
import { countUnlinkedDeclarations, findDuplicateStoreEntries } from '../angular-compat.mjs';
import {
  NPMRC,
  TSCONFIG,
  VERSIONS,
  buildTools,
  fail,
  forgeEntries,
  freePort,
  jsFiles,
  loadChromium,
  ng,
  repoRoot,
  run,
  sleep,
  transferState,
  write
} from './shared.mjs';
import { durableFileJourney } from './files.mjs';

const ADMIN = { email: 'admin@journey.test', password: 'journey-admin-password-123' };
const SECRET = randomBytes(48).toString('base64'); // ≥ 32 bytes; per run, localhost only
const POST = {
  title: 'Production journey post',
  slug: 'production-journey-post',
  body: 'First version of the body. Café & coffee.'
};
const EDITED = {
  title: 'Production journey post (edited)',
  body: 'Edited body, served after a fresh render.'
};
/** The bootstrapped admin's user id (read through the authenticated API once signed in); '' until then. */
let adminId = '';
const HTML_BODY = 'First version of the body. Café &amp; coffee.';

/** Strings that must never reach a browser bundle (server code, secrets, database drivers). */
const BROWSER_FORBIDDEN = [
  SECRET,
  'ForgeCmsRuntime',
  'defineEventHandler',
  'invalid server origin',
  'forwardCookies',
  'LibSqlDatabaseAdapter',
  'D1DatabaseAdapter',
  '@libsql',
  'DATABASE_URL',
  // Specs 083/084: durable-profile adapters and their configuration are server-side only.
  'S3StorageAdapter',
  'R2StorageAdapter',
  '@aws-sdk',
  'S3_SECRET_ACCESS_KEY',
  'S3_ACCESS_KEY_ID',
  'AUTH_SECRET',
  'resolveProfile',
  // Spec 088 (R01): password material and the session-revocation counter never belong in a browser.
  'passwordHash',
  '_sessionVersion',
  'UsersCollectionAuthAdapter'
];

/** The actual S3 credentials of the running Garage; set by `verifyJourneyConsumer`, checked in every bundle. */
let runtimeSecrets = [];

/** The tiny-project sources that make up the consumer app (everything but its tests and Strata plugin). */
const APP_SOURCES = [
  'index.html',
  'src/main.ts',
  'src/main.server.ts',
  'src/styles.css',
  'src/app',
  'src/server/api',
  'src/server/routes',
  'src/server/import-meta.d.ts'
];

const PROFILES = [
  {
    id: 'node',
    label: 'Node (node-server) + on-disk libSQL + S3 (Garage)',
    // Nitro's tracer cannot follow libSQL's per-platform native package, so a consumer that really opens a
    // `file:` database keeps its dependencies in node_modules instead of tracing them (spec 081).
    nitro: `{ preset: 'node-server', externals: { trace: false } }`
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare Pages output under local workerd + local D1 + local R2',
    nitro: `{ preset: 'cloudflare-pages' }`
  }
];

function manifest(tarballs) {
  return {
    name: 'forge-journey-consumer',
    version: '0.0.0',
    private: true,
    type: 'module',
    dependencies: {
      ...tarballs,
      ...Object.fromEntries(
        [
          'common',
          'compiler',
          'core',
          'forms',
          'platform-browser',
          'platform-server',
          'router'
        ].map(ng)
      ),
      '@angular/cdk': VERSIONS.cdk, // not a Forge peer: VoltUI's own dependency
      '@voltui/components': VERSIONS.voltui,
      'lumen-icons': VERSIONS.lumenIcons,
      h3: VERSIONS.h3,
      rxjs: VERSIONS.rxjs,
      tslib: '^2.3.0',
      'zone.js': VERSIONS.zone
    },
    devDependencies: {
      ...buildTools(),
      '@types/node': '22.15.3',
      wrangler: VERSIONS.wrangler
    },
    // Forge's internal dependencies (admin → angular → core, runtime → db …) must resolve to the tarballs too.
    pnpm: { overrides: tarballs }
  };
}

const viteConfig = (nitro) => `import analog from '@analogjs/platform';
import { defineConfig } from 'vite';
import { angularLinker } from '@forge-cms/angular/vite';

// The documented setup: the public Angular linker (it also links Forge in the SSR build), Analog with SSR,
// no build-time prerender (the build database is empty), and one Nitro preset.
export default defineConfig({
  plugins: [angularLinker(), analog({ ssr: true, prerender: { routes: [] }, nitro: ${nitro} })],
  build: { target: 'es2022' }
});
`;

const WRANGLER = `name = "forge-journey-consumer"
compatibility_date = "2026-05-15"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = "dist/analog/public"

[[d1_databases]]
binding = "DB"
database_name = "forge-journey-consumer"
database_id = "00000000-0000-0000-0000-000000000081"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "forge-journey-consumer"
`;

/**
 * Reads. tiny-project serves `GET /api/content/*` through a Strata plugin (the maintainer's own library, not a Forge
 * package); a consumer of public Forge packages mounts the same `handleList`/`handleRead` as two thin h3 routes.
 */
const READ_ROUTES = {
  'src/server/routes/api/content/[collection].get.ts': `import { defineEventHandler, toWebRequest } from 'h3';
import type { ApiContext } from '@forge-cms/api';
import { handleList } from '@forge-cms/runtime';
import { getServerRuntime } from '../../../api/runtime';
import { routeParam } from '../../../api/route-param';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const context: ApiContext = {
    request: toWebRequest(event),
    params: { collection: routeParam(event, 'collection') },
    env: event.context.cloudflare?.env
  };
  return handleList(context, { runtime });
});
`,
  'src/server/routes/api/content/[collection]/[id].get.ts': `import { defineEventHandler, toWebRequest } from 'h3';
import type { ApiContext } from '@forge-cms/api';
import { handleRead } from '@forge-cms/runtime';
import { getServerRuntime } from '../../../../api/runtime';
import { routeParam } from '../../../../api/route-param';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const context: ApiContext = {
    request: toWebRequest(event),
    params: { collection: routeParam(event, 'collection'), id: routeParam(event, 'id') },
    env: event.context.cloudflare?.env
  };
  return handleRead(context, { runtime });
});
`
};

/**
 * Consumer-only request observer: records every `GET /api/content/posts` and whether a browser sent it (browsers send
 * `Sec-Fetch-Site`; the server's own fetch does not). It lets the gate count the SSR read and the browser reads
 * from the server side, independently of Playwright.
 */
const OBSERVER = {
  'src/server/middleware/read-log.ts': `import { defineEventHandler, getRequestHeader, getRequestURL } from 'h3';

export interface ObservedRead {
  url: string;
  source: 'browser' | 'server';
}
export const observedReads: ObservedRead[] = [];

export default defineEventHandler((event) => {
  const url = getRequestURL(event);
  if (event.method !== 'GET' || !url.pathname.startsWith('/api/content/posts')) return;
  const source = getRequestHeader(event, 'sec-fetch-site') === undefined ? 'server' : 'browser';
  observedReads.push({ url: url.pathname + url.search, source });
});
`,
  'src/server/routes/api/observed-reads.get.ts': `import { defineEventHandler } from 'h3';
import { observedReads } from '../../middleware/read-log';

export default defineEventHandler(() => ({ data: observedReads.map((read) => ({ ...read })) }));
`,
  'src/server/routes/api/observed-reads.delete.ts': `import { defineEventHandler } from 'h3';
import { observedReads } from '../../middleware/read-log';

export default defineEventHandler(() => {
  observedReads.length = 0;
  return { data: 'cleared' };
});
`
};

function assembleApp(dir, tarballs) {
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest(tarballs), null, 2)}\n`);
  const tiny = join(repoRoot, 'apps', 'tiny-project');
  for (const relative of APP_SOURCES) {
    cpSync(join(tiny, relative), join(dir, relative), {
      recursive: true,
      filter: (source) => !/\.test\.ts$/.test(source)
    });
  }
  write(dir, {
    'tsconfig.json': `${JSON.stringify({ ...TSCONFIG, compilerOptions: { ...TSCONFIG.compilerOptions, types: ['node'] } }, null, 2)}\n`,
    'tsconfig.app.json': `${JSON.stringify({ extends: './tsconfig.json' }, null, 2)}\n`,
    'wrangler.toml': WRANGLER,
    '.npmrc': NPMRC,
    ...READ_ROUTES,
    ...OBSERVER
  });
}

// ---------------------------------------------------------------------------------------------------------
// Builds and bundle checks

function checkBundles(dir, outDir, profile) {
  const browser = jsFiles(join(dir, outDir, 'client'));
  if (browser.length === 0) fail(`${profile.id}: no browser bundle in ${outDir}/client`);
  const browserCode = browser.map((file) => readFileSync(file, 'utf8')).join('\n');
  for (const marker of BROWSER_FORBIDDEN) {
    if (browserCode.includes(marker))
      fail(`${profile.id}: the browser bundle contains '${marker}'`);
  }
  if (/packages\/[a-z-]+\/src/.test(browserCode)) {
    fail(`${profile.id}: the browser bundle references a repository packages/*/src path`);
  }
  if (runtimeSecrets.some((secret) => browserCode.includes(secret))) {
    fail(`${profile.id}: the browser bundle contains a live S3 credential`);
  }
  const unlinkedBrowser = countUnlinkedDeclarations(browserCode);
  if (unlinkedBrowser > 0)
    fail(`${profile.id}: ${unlinkedBrowser} unlinked declarations in the browser`);

  // The linked Vite SSR build; Nitro then bundles (Cloudflare) or references (Node) it.
  const serverDir = join(dir, outDir, 'ssr');
  const server = jsFiles(serverDir);
  if (server.length === 0) fail(`${profile.id}: no server bundle in ${serverDir}`);
  const serverCode = server.map((file) => readFileSync(file, 'utf8')).join('\n');
  const unlinkedServer = countUnlinkedDeclarations(serverCode);
  if (unlinkedServer > 0)
    fail(`${profile.id}: ${unlinkedServer} unlinked declarations in the server`);
  if (!serverCode.includes('invalid server origin')) {
    fail(`${profile.id}: the server bundle does not contain @forge-cms/angular/server`);
  }
  console.log(
    `  ✓ ${profile.id} bundles: browser + server fully linked; no server code, secret or database driver in the browser`
  );
}

function build(dir, profile) {
  // Built into `dist` and served from there: a `trace: false` Node build references `dist/ssr` by its
  // absolute path, so each profile is built, served and judged before the next one rebuilds `dist`.
  const outDir = 'dist';
  rmSync(join(dir, 'dist'), { recursive: true, force: true });
  rmSync(join(dir, '.analog'), { recursive: true, force: true });
  writeFileSync(join(dir, 'vite.config.ts'), viteConfig(profile.nitro));
  run('pnpm', ['exec', 'vite', 'build', '--logLevel', 'warn'], dir);
  checkBundles(dir, outDir, profile);
  return outDir;
}

// ---------------------------------------------------------------------------------------------------------
// Production servers

/** A started production server; `stop()` and `start()` again to restart on the same port and storage. */
async function launch(dir, profile, outDir, state, s3) {
  const port = state.port ?? (await freePort());
  state.port = port;
  const origin = `http://127.0.0.1:${port}`;
  const logs = [];
  let command;
  let args;
  let env;
  if (profile.id === 'node') {
    const entry = join(dir, outDir, 'analog', 'server', 'index.mjs');
    if (!existsSync(entry)) fail(`no built server at ${entry}`);
    command = process.execPath;
    args = [entry];
    env = {
      PORT: String(port),
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
      AUTH_SECRET: SECRET,
      FORGE_SSR_ORIGIN: origin,
      DATABASE_URL: `file:${join(state.storage, 'forge.db')}`,
      S3_BUCKET: s3.bucket,
      S3_REGION: s3.region,
      S3_ENDPOINT: s3.endpoint,
      S3_ACCESS_KEY_ID: s3.accessKeyId,
      S3_SECRET_ACCESS_KEY: s3.secretAccessKey,
      S3_FORCE_PATH_STYLE: 'true'
    };
  } else {
    command = join(dir, 'node_modules', '.bin', 'wrangler');
    args = [
      'pages',
      'dev',
      join(outDir, 'analog', 'public'),
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--persist-to',
      state.storage,
      '--binding',
      `AUTH_SECRET=${SECRET}`,
      '--binding',
      `FORGE_SSR_ORIGIN=${origin}`,
      '--show-interactive-dev-session=false'
    ];
    env = { WRANGLER_SEND_METRICS: 'false', CI: 'true' };
  }
  const child = spawn(command, args, {
    cwd: dir,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  });
  child.stdout.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr.on('data', (chunk) => logs.push(String(chunk)));
  const server = {
    origin,
    logs,
    async stop() {
      if (child.exitCode === null && child.pid !== undefined) {
        const exited = new Promise((resolve) => child.once('exit', resolve));
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          // already gone
        }
        await Promise.race([exited, sleep(10_000)]);
        if (child.exitCode === null) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            // already gone
          }
        }
      }
    }
  };
  for (let attempt = 0; attempt < 300; attempt++) {
    try {
      const response = await fetch(`${origin}/api/content/posts`);
      if (response.ok) return server;
    } catch {
      // not listening yet
    }
    if (child.exitCode !== null) break;
    await sleep(200);
  }
  await server.stop();
  fail(`${profile.id}: the production server did not start:\n${logs.join('')}`);
}

// ---------------------------------------------------------------------------------------------------------
// The journey

const text = (response) => response.text();

/** What a client without JavaScript or cookies receives for `path`. */
async function noJs(origin, path) {
  const response = await fetch(`${origin}${path}`, {
    headers: { accept: 'text/html', 'x-forwarded-host': 'evil.example' }
  });
  if (response.status !== 200) fail(`GET ${path} → ${response.status}`);
  return text(response);
}

/** Everything that must never appear in a public page: private data, diagnostics, unresolved states. */
function expectCleanPublicHtml(html, label) {
  for (const marker of [
    ADMIN.email,
    'passwordHash',
    '_sessionVersion',
    'forge_session',
    SECRET,
    'evil.example',
    'Loading…',
    'SERVER_ORIGIN_REQUIRED',
    'JIT compiler unavailable',
    'ForgeApiError',
    'role="alert"',
    'Bearer ',
    'hydration mismatch',
    'libsql',
    'Cannot find module'
  ]) {
    if (html.includes(marker)) fail(`${label}: the HTML contains '${marker}'`);
  }
  const markup = html.replace(/<script[^>]*id="ng-state"[^>]*>[\s\S]*?<\/script>/, '');
  if (adminId !== '' && markup.includes(adminId))
    fail(`${label}: the markup renders the admin's id`);
  if (!html.includes('ng-server-context')) fail(`${label}: not server rendered`);
  if (/\bNG0\d+/.test(html)) fail(`${label}: the HTML carries an Angular diagnostic`);
}

/** The single public transfer entry of a page, or `undefined` when the render transferred nothing. */
function publicEntry(html, label) {
  const entries = forgeEntries(transferState(html, label));
  if (entries.length > 1) fail(`${label}: ${entries.length} public transfer entries`);
  const [entry] = entries;
  if (entry === undefined) return undefined;
  if (/https?:|127\.0\.0\.1/.test(entry[0])) fail(`${label}: the transfer key embeds an origin`);
  const serialized = JSON.stringify(entry[1]);
  for (const marker of [
    ADMIN.email,
    'passwordHash',
    '_sessionVersion',
    'role',
    'forge_session',
    'Bearer ',
    SECRET,
    '"users"'
  ]) {
    if (serialized.includes(marker)) fail(`${label}: the transfer entry contains '${marker}'`);
  }
  // The restricted `author -> users` relation is redacted for an anonymous reader: `null`, not an id and
  // not a populated record. The admin's id must not appear anywhere in the transfer.
  for (const doc of entry[1]?.docs ?? []) {
    if (doc.author !== null && doc.author !== undefined) {
      fail(`${label}: the transfer entry exposes the author: ${JSON.stringify(doc.author)}`);
    }
  }
  if (adminId !== '' && serialized.includes(adminId))
    fail(`${label}: the transfer carries the admin's id`);
  return entry[1];
}

function expectPublished(html, { title, bodyHtml }, label) {
  expectCleanPublicHtml(html, label);
  if (!html.includes(`<h1>${title}</h1>`)) fail(`${label}: <h1> with '${title}' is missing`);
  if (!html.includes(bodyHtml)) fail(`${label}: the body is missing`);
  const entry = publicEntry(html, label);
  if (entry?.docs?.[0]?.title !== title) fail(`${label}: the transfer entry is not the post`);
}

function expectAbsent(html, titles, label) {
  expectCleanPublicHtml(html, label);
  for (const title of titles) {
    if (html.includes(title)) fail(`${label}: '${title}' is visible`);
  }
  const entry = publicEntry(html, label);
  if (entry !== undefined && JSON.stringify(entry).includes('journey')) {
    fail(`${label}: the transfer state carries hidden content`);
  }
}

async function observed(origin) {
  const response = await fetch(`${origin}/api/observed-reads`);
  return (await response.json()).data;
}
const clearObserved = (origin) => fetch(`${origin}/api/observed-reads`, { method: 'DELETE' });

/** Opens a page whose console/page errors are collected (`strict`: every error/warning; else only framework ones). */
async function open(context, { strict }) {
  const page = await context.newPage();
  const log = { requests: [], problems: [] };
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/content/posts')) log.requests.push(url.pathname + url.search);
  });
  page.on('console', (message) => {
    const framework = /NG0\d+|JIT|linker/i.test(message.text());
    if (framework || (strict && (message.type() === 'error' || message.type() === 'warning'))) {
      log.problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => log.problems.push(`pageerror: ${error.message}`));
  return { page, log };
}

/** Angular removes the `ngh` annotation from a server-rendered element once it has hydrated it. */
const hydrated = (page) => page.waitForFunction(() => document.querySelector('[ngh]') === null);

/** Counts removed nodes inside the post page: hydration reuses the server DOM, so none may be removed. */
const watchDomReuse = (page) =>
  page.addInitScript(() => {
    window.__removed = 0;
    new MutationObserver((records) => {
      for (const record of records) {
        const inPost = record.target.closest?.('tiny-post-detail-page') !== null;
        if (inPost && record.target.nodeType === 1) window.__removed += record.removedNodes.length;
      }
    }).observe(document, { childList: true, subtree: true });
  });

async function signIn(page, origin) {
  await page.goto(`${origin}/studio/login`);
  await hydrated(page);
  await page.locator('input#forge-signin-email').fill(ADMIN.email);
  await page.locator('input#forge-signin-password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/studio/collections**');
}

async function expectPublicPage(page, origin, path, expectation, log, label) {
  log.requests.length = 0;
  await clearObserved(origin);
  await page.goto(`${origin}${path}`);
  await hydrated(page);
  await page.waitForTimeout(600);
  const reads = await observed(origin);
  const serverReads = reads.filter((read) => read.source === 'server');
  const browserReads = reads.filter((read) => read.source === 'browser');
  if (serverReads.length !== 1) fail(`${label}: expected 1 SSR read, got ${JSON.stringify(reads)}`);
  if (browserReads.length !== 0 || log.requests.length !== 0) {
    fail(
      `${label}: duplicate initial browser read ${JSON.stringify([browserReads, log.requests])}`
    );
  }
  await expectation(page);
  // The hydrated DOM must not have gained private data either (it is what a user's browser actually holds).
  const dom = await page.content();
  for (const marker of [
    ADMIN.email,
    '_sessionVersion',
    'passwordHash',
    SECRET,
    'Bearer ',
    'SERVER_ORIGIN_REQUIRED'
  ]) {
    if (dom.includes(marker)) fail(`${label}: the hydrated DOM contains '${marker}'`);
  }
  if (adminId !== '' && dom.includes(adminId))
    fail(`${label}: the hydrated DOM contains the admin's id`);
  if (/\bNG0\d+/.test(dom)) fail(`${label}: the hydrated DOM carries an Angular diagnostic`);
  if (log.problems.length > 0) fail(`${label}: browser problems:\n${log.problems.join('\n')}`);
  console.log(`  ✓ ${label}: 1 SSR read, 0 browser reads, hydrated, no console problem`);
}

async function journey({ profile, dir, outDir, s3 }) {
  const chromium = await loadChromium();
  const state = { storage: join(dir, `state-${profile.id}`) };
  mkdirSync(state.storage, { recursive: true });
  let server = await launch(dir, profile, outDir, state, s3);
  const browser = await chromium.launch();
  const origin = () => server.origin;
  try {
    // --- 1. fresh consumer: no admin, no posts ---------------------------------------------------------
    let html = await noJs(origin(), '/');
    expectCleanPublicHtml(html, 'fresh /');
    if (!html.includes('No published posts yet.')) fail('fresh /: expected the empty state');
    html = await noJs(origin(), `/posts/${POST.slug}`);
    if (!html.includes('Not found')) fail('fresh post page: expected Not found');
    console.log(
      '  ✓ fresh consumer: SSR renders the empty state and Not found (no admin, no posts)'
    );

    // --- 2. first admin through the setup page, then sign out and in through the admin UI ----------------
    const context = await browser.newContext();
    const { page: adminPage, log: adminLog } = await open(context, { strict: false });
    await adminPage.goto(`${origin()}/setup`);
    await hydrated(adminPage);
    await adminPage.locator('input[name="email"]').fill(ADMIN.email);
    await adminPage.locator('input[name="password"]').fill(ADMIN.password);
    await adminPage.getByRole('button', { name: 'Create admin' }).click();
    await adminPage.waitForURL('**/studio/collections**');
    const second = await fetch(`${origin()}/api/bootstrap-admin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'again@journey.test', password: 'another-password-123' })
    });
    if (second.status !== 409) fail(`a second bootstrap answered ${second.status}`);
    await adminPage.getByRole('button', { name: /log out/i }).click();
    await adminPage.waitForURL('**/studio/login**');
    await signIn(adminPage, origin());
    // Read through the signed-in page itself (same-origin fetch with its session cookie).
    const usersBody = await adminPage.evaluate(async () => {
      const response = await fetch('/api/content/users', { credentials: 'same-origin' });
      return `${response.status} ${await response.text()}`;
    });
    adminId =
      (JSON.parse(usersBody.slice(4)).data ?? []).find((user) => user.email === ADMIN.email)?.id ??
      '';
    if (adminId === '') fail(`could not read the admin user id: ${usersBody}`);
    console.log(
      '  ✓ first admin bootstrapped (second attempt 409); signed in through the admin UI'
    );

    // --- 2b. spec 087: the packed admin is certified at a non-default mount and non-default APIs -------------
    // tiny-project mounts the reusable admin at /studio with its APIs at /api/content and /api/account.
    // A packed admin that still assumed /admin, /api/v1 or /api/auth would redirect, 404 or call them here.
    const literalApis = [];
    adminPage.on('request', (request) => {
      const { pathname } = new URL(request.url());
      if (/^\/(admin|api\/v1|api\/auth)(\/|$)/.test(pathname)) literalApis.push(pathname);
    });
    for (const path of ['/studio/collections', '/studio/collections/posts', '/studio/users']) {
      await adminPage.goto(`${origin()}${path}`);
      await adminPage.reload();
      await hydrated(adminPage);
      if (new URL(adminPage.url()).pathname !== path) {
        fail(`refresh of ${path} ended at ${adminPage.url()}`);
      }
    }
    const mountHrefs = await adminPage.$$eval('a[href]', (anchors) =>
      anchors
        .map((a) => new URL(a.href))
        .filter((u) => u.origin === location.origin)
        .map((u) => u.pathname)
    );
    for (const expected of ['/studio', '/studio/collections', '/studio/users']) {
      if (!mountHrefs.includes(expected)) fail(`the mounted admin has no link to ${expected}`);
    }
    if (mountHrefs.some((href) => href.startsWith('/admin')))
      fail('the mounted admin links to /admin');
    await adminPage.getByRole('button', { name: /log out/i }).click();
    await adminPage.waitForURL('**/studio/login**');
    await adminPage.goto(`${origin()}/studio/collections/posts`);
    await adminPage.waitForURL('**/studio/login?returnUrl=*');
    if (literalApis.length > 0)
      fail(`the admin called default API/admin paths: ${literalApis.join(', ')}`);
    await signIn(adminPage, origin());
    console.log(
      '  ✓ spec 087: admin at /studio, APIs at /api/content + /api/account — refresh of nested routes, in-mount links and redirects, no /admin or /api/v1 or /api/auth'
    );

    // --- 3. admin creates a post: draft ---------------------------------------------------------------
    await adminPage.goto(`${origin()}/studio/collections/posts`);
    await adminPage.getByRole('button', { name: 'New' }).click();
    await adminPage.waitForURL('**/studio/collections/posts/new');
    await adminPage.locator('input#title').fill(POST.title);
    await adminPage.locator('input#slug').fill(POST.slug);
    await adminPage.locator('input#author').fill(ADMIN.email);
    await adminPage
      .getByRole('button', { name: new RegExp(ADMIN.email.replace('.', '\\.')) })
      .click();
    await adminPage.getByRole('button', { name: 'Add block' }).click();
    await adminPage.locator('volt-textarea textarea').first().fill(POST.body);
    await adminPage.getByRole('button', { name: 'Create' }).click();
    await adminPage.waitForURL(/\/studio\/collections\/posts$/);
    const row = () => adminPage.locator('volt-table-row', { hasText: POST.title });
    await row().getByText('Draft', { exact: true }).waitFor();
    console.log('  ✓ the existing admin created the post; it starts as Draft');

    // --- 4. anonymous SSR cannot see the draft; neither can the signed-in browser's public page --------
    for (const path of ['/', `/posts/${POST.slug}`]) {
      expectAbsent(await noJs(origin(), path), [POST.title, POST.body], `draft ${path}`);
    }
    const { page: publicPage, log: publicLog } = await open(context, { strict: true });
    await watchDomReuse(publicPage);
    await expectPublicPage(
      publicPage,
      origin(),
      `/posts/${POST.slug}`,
      async (page) => {
        if (!(await page.getByText('Not found').isVisible())) fail('draft: Not found is not shown');
        if (await page.getByText(POST.title).count())
          fail('draft: the title is visible after hydration');
      },
      publicLog,
      'draft, public page in the admin-signed-in browser'
    );

    // --- 5. publish; no-JS HTML --------------------------------------------------------------------------
    await row().getByRole('button', { name: 'Publish' }).click();
    await row().getByText('Published', { exact: true }).waitFor();
    html = await noJs(origin(), `/posts/${POST.slug}`);
    expectPublished(html, { title: POST.title, bodyHtml: HTML_BODY }, 'published (no JS)');
    html = await noJs(origin(), '/');
    if (!html.includes(`>${POST.title}</a>`)) fail('published /: the post is not listed');
    expectCleanPublicHtml(html, 'published /');
    console.log(
      '  ✓ published: the built server renders title + body by slug before JavaScript; no private data'
    );

    // --- 6. hydration: one SSR read, zero browser reads -------------------------------------------------
    await expectPublicPage(
      publicPage,
      origin(),
      `/posts/${POST.slug}`,
      async (page) => {
        if (!(await page.getByRole('heading', { name: POST.title }).isVisible())) fail('no <h1>');
        if (!(await page.getByText(POST.body).isVisible())) fail('the body is not visible');
        if (await page.getByText(ADMIN.email).count()) fail('the restricted author is visible');
        if ((await page.evaluate(() => window.__removed)) !== 0)
          fail('hydration replaced the server DOM');
      },
      publicLog,
      'published page hydrates from the transferred result'
    );

    // --- 7. an edit elsewhere is not pushed into the loaded page -------------------------------------------
    const stale = await noJs(origin(), `/posts/${POST.slug}`);
    await adminPage.goto(`${origin()}/studio/collections/posts`);
    await adminPage
      .locator('volt-table-row', { hasText: POST.title })
      .getByRole('button', { name: 'Edit' })
      .click();
    await adminPage.locator('input#title').fill(EDITED.title);
    await adminPage.locator('volt-textarea textarea').first().fill(EDITED.body);
    await adminPage.getByRole('button', { name: 'Save' }).click();
    await adminPage.locator('volt-table-row', { hasText: EDITED.title }).waitFor();
    await clearObserved(origin());
    publicLog.requests.length = 0;
    await publicPage.waitForTimeout(1500);
    if (!(await publicPage.getByRole('heading', { name: POST.title, exact: true }).isVisible())) {
      fail('the loaded page changed without any navigation');
    }
    if ((await observed(origin())).length !== 0 || publicLog.requests.length !== 0) {
      fail('the loaded page polled or refetched content on its own');
    }
    if (!stale.includes(`<h1>${POST.title}</h1>`)) fail('previously generated HTML was mutated');
    console.log(
      '  ✓ edit in the admin: the loaded page and old HTML are unchanged; no push, no polling'
    );

    // --- 8. SPA navigation reads normally; a full reload renders fresh SSR ----------------------------------
    publicLog.requests.length = 0;
    await publicPage.getByRole('link', { name: 'Home' }).click();
    await publicPage.getByRole('link', { name: EDITED.title }).waitFor();
    await publicPage.getByRole('link', { name: EDITED.title }).click();
    await publicPage.getByRole('heading', { name: EDITED.title }).waitFor();
    await publicPage.getByText(EDITED.body).waitFor();
    if (publicLog.requests.length < 2) {
      fail(`SPA navigation should read normally, saw ${JSON.stringify(publicLog.requests)}`);
    }
    console.log(
      `  ✓ SPA navigation: ${publicLog.requests.length} normal browser reads, fresh content`
    );

    html = await noJs(origin(), `/posts/${POST.slug}`);
    expectPublished(html, { title: EDITED.title, bodyHtml: EDITED.body }, 'after the edit (no JS)');
    await expectPublicPage(
      publicPage,
      origin(),
      `/posts/${POST.slug}`,
      async (page) => {
        if (!(await page.getByRole('heading', { name: EDITED.title }).isVisible()))
          fail('stale <h1>');
        if (!(await page.getByText(EDITED.body).isVisible())) fail('stale body');
      },
      publicLog,
      'full reload: fresh SSR with the edit, hydrates with zero duplicate reads'
    );

    // --- 9. restart the production server (same database / D1 directory) -------------------------------------
    await clearObserved(origin());
    await server.stop();
    server = await launch(dir, profile, outDir, state, s3);
    html = await noJs(origin(), `/posts/${POST.slug}`);
    expectPublished(html, { title: EDITED.title, bodyHtml: EDITED.body }, 'after restart (no JS)');
    await expectPublicPage(
      publicPage,
      origin(),
      `/posts/${POST.slug}`,
      async (page) => {
        if (!(await page.getByRole('heading', { name: EDITED.title }).isVisible())) fail('no <h1>');
      },
      publicLog,
      'after a server restart: content persisted, SSR + hydration still correct'
    );

    // --- 10. back to draft: hidden again everywhere -----------------------------------------------------------
    await adminPage.goto(`${origin()}/studio/collections/posts`);
    const editedRow = adminPage.locator('volt-table-row', { hasText: EDITED.title });
    await editedRow.getByRole('button', { name: 'Unpublish' }).click();
    await editedRow.getByText('Draft', { exact: true }).waitFor();
    for (const path of ['/', `/posts/${POST.slug}`]) {
      expectAbsent(await noJs(origin(), path), [EDITED.title, EDITED.body], `unpublished ${path}`);
    }
    await expectPublicPage(
      publicPage,
      origin(),
      `/posts/${POST.slug}`,
      async (page) => {
        if (!(await page.getByText('Not found').isVisible()))
          fail('unpublished: Not found missing');
        if (await page.getByText(EDITED.title).count()) fail('unpublished: the title is visible');
      },
      publicLog,
      'unpublished: direct reload hides it'
    );
    await publicPage.getByRole('link', { name: 'Home' }).click();
    await publicPage.getByText('No published posts yet.').waitFor();
    console.log(
      '  ✓ unpublished: no-JS HTML, transfer state, reload and SPA navigation all hide it'
    );

    // --- 11. durable files: multipart upload → handleFile → restart → delete (spec 084) -----------------------
    await adminPage.goto(`${origin()}/studio/collections/posts`);
    await durableFileJourney({
      profile,
      browser,
      adminPage,
      origin,
      state,
      s3,
      restart: async () => {
        await server.stop();
        server = await launch(dir, profile, outDir, state, s3);
      }
    });

    if (adminLog.problems.length > 0)
      fail(`admin browser problems:\n${adminLog.problems.join('\n')}`);
    await context.close();

    const output = server.logs.join('');
    if (profile.id === 'node' && output.includes(s3.secretAccessKey)) {
      fail('node: the production server logged the S3 secret');
    }
    for (const problem of [
      'JIT compiler unavailable',
      'NG0',
      'SERVER_ORIGIN_REQUIRED',
      '[ERROR]'
    ]) {
      if (output.includes(problem))
        fail(`${profile.id}: the server logged '${problem}':\n${output}`);
    }
  } finally {
    await browser.close();
    await server.stop();
  }
}

/**
 * Spec 084: the BUILT production server refuses an incomplete durable profile instead of falling back to
 * memory. A libSQL database with no S3 storage (and a bare process) must answer 500, name what is missing, and
 * never print a secret value.
 */
async function expectProductionFailsClosed(dir, outDir, s3) {
  const entry = join(dir, outDir, 'analog', 'server', 'index.mjs');
  const cases = [
    {
      label: 'no durable profile at all',
      env: {},
      expect: /No durable deployment profile/
    },
    {
      label: 'libSQL without S3 storage',
      env: { DATABASE_URL: `file:${join(dir, 'never-created.db')}` },
      expect: /Incomplete portable profile: missing S3_BUCKET and S3_REGION/
    },
    {
      label: 'libSQL with a partial S3 configuration (secret only)',
      env: {
        DATABASE_URL: `file:${join(dir, 'never-created.db')}`,
        S3_SECRET_ACCESS_KEY: s3.secretAccessKey
      },
      expect: /S3_BUCKET and S3_REGION/
    },
    {
      label: 'S3 storage without a durable database',
      env: {
        S3_BUCKET: s3.bucket,
        S3_REGION: s3.region,
        S3_ACCESS_KEY_ID: s3.accessKeyId,
        S3_SECRET_ACCESS_KEY: s3.secretAccessKey
      },
      expect: /Incomplete portable profile: missing DATABASE_URL/
    }
  ];
  for (const testCase of cases) {
    const port = await freePort();
    const logs = [];
    const child = spawn(process.execPath, [entry], {
      cwd: dir,
      env: {
        PATH: process.env.PATH,
        PORT: String(port),
        HOST: '127.0.0.1',
        NODE_ENV: 'production',
        AUTH_SECRET: SECRET,
        FORGE_SSR_ORIGIN: `http://127.0.0.1:${port}`,
        ...testCase.env
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', (chunk) => logs.push(String(chunk)));
    child.stderr.on('data', (chunk) => logs.push(String(chunk)));
    try {
      let status = 0;
      let body = '';
      for (let attempt = 0; attempt < 100 && status === 0; attempt++) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/content/posts`);
          status = response.status;
          body = await response.text();
        } catch {
          await sleep(200);
        }
      }
      const output = logs.join('') + body;
      if (status !== 500) fail(`fail-closed (${testCase.label}): answered ${status}, expected 500`);
      if (!testCase.expect.test(output)) {
        fail(`fail-closed (${testCase.label}): the error does not name the problem:\n${output}`);
      }
      if (output.includes(s3.secretAccessKey) || output.includes(SECRET)) {
        fail(`fail-closed (${testCase.label}): a secret value reached the output`);
      }
    } finally {
      child.kill('SIGKILL');
    }
  }
  console.log(
    '  ✓ fail closed: the production server refuses no profile / libSQL without S3 / S3 without a database (500, names the missing variables, no secret)'
  );
}

/** Installs the journey consumer once, then builds and walks each profile. */
export async function verifyJourneyConsumer({ workDir, tarballs, s3 }) {
  runtimeSecrets = [s3.secretAccessKey, s3.accessKeyId].filter(Boolean);
  const dir = join(workDir, 'journey-app');
  mkdirSync(dir, { recursive: true });
  assembleApp(dir, tarballs);
  assertCleanConsumer(dir, 'journey SSR consumer');
  run('pnpm', ['install', '--prefer-offline'], dir);
  const duplicates = findDuplicateStoreEntries(readdirSync(join(dir, 'node_modules', '.pnpm')));
  if (duplicates.length > 0) fail(`more than one Angular copy: ${JSON.stringify(duplicates)}`);
  run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json', '--noEmit'], dir);

  for (const profile of PROFILES) {
    console.log(`\nJourney — ${profile.label}`);
    const outDir = build(dir, profile);
    await journey({ profile, dir, outDir, s3 });
    if (profile.id === 'node') await expectProductionFailsClosed(dir, outDir, s3);
  }
  console.log(
    `\nProduction SSR + durable-file journey passed on Node + libSQL + S3 (Garage) and on Cloudflare Pages output under local workerd + local D1 + local R2 (Angular ${VERSIONS.angular}, Analog ${VERSIONS.analog}).`
  );
}
