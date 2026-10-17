// The Angular/Analog quickstart consumer (spec 091, roadmap 0.12 / R04). Run by `pnpm docs:verify:consumers`.
//
// `docs/examples/analog-quickstart` — the text the quickstart page embeds — is copied into a CLEAN external
// project that installs Forge ONLY from the packed tarballs, with strict peers and no automatic peer
// installation, exactly the peers the documentation lists, and the official `angularLinker`. It must pass
// strict TypeScript and Angular's strict templates, build for production with Analog (`node-server`), and the
// built server must answer the documented routes: first admin, session cookie + CSRF, a draft/publish
// journey, an upload served through `handleFile`, and the admin login page in a real browser.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { countUnlinkedDeclarations, findDuplicateStoreEntries } from '../angular-compat.mjs';
import { assertCleanConsumer } from '../certification/artifacts.mjs';
import {
  NPMRC,
  VERSIONS,
  buildTools,
  freePort,
  jsFiles,
  loadChromium,
  ng
} from '../ssr-consumer/shared.mjs';
import { copyExample, run } from './shared.mjs';

const QUICKSTART_PACKAGES = [
  '@forge-cms/core',
  '@forge-cms/db',
  '@forge-cms/auth',
  '@forge-cms/storage',
  '@forge-cms/api',
  '@forge-cms/runtime',
  '@forge-cms/angular',
  '@forge-cms/admin'
];

const AUTH_SECRET = 'docs-quickstart-secret-0123456789abcdef-0123';
const ADMIN = { email: 'admin@example.test', password: 'a-long-passphrase' };

function fail(message) {
  throw new Error(message);
}

/** The dependency block the quickstart documents — nothing beyond it is installed. */
function manifest(tarballs) {
  const forge = Object.fromEntries(QUICKSTART_PACKAGES.map((name) => [name, tarballs[name]]));
  return {
    name: 'forge-analog-quickstart',
    version: '0.0.0',
    private: true,
    type: 'module',
    dependencies: {
      ...forge,
      ...Object.fromEntries(
        ['common', 'compiler', 'core', 'forms', 'platform-browser', 'router'].map(ng)
      ),
      '@angular/cdk': VERSIONS.cdk,
      '@voltui/components': VERSIONS.voltui,
      'lumen-icons': VERSIONS.lumenIcons,
      h3: VERSIONS.h3,
      rxjs: VERSIONS.rxjs,
      tslib: '^2.3.0',
      'zone.js': VERSIONS.zone
    },
    devDependencies: { ...buildTools(), '@types/node': '22.15.3' },
    pnpm: { overrides: forge }
  };
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
      AUTH_SECRET
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr.on('data', (chunk) => logs.push(String(chunk)));
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`${origin}/api/v1/posts`);
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

const cookieOf = (response) => (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

async function exercise(origin) {
  const same = { origin }; // cookie-authenticated writes need a same-origin Origin header (CSRF)
  const json = { 'content-type': 'application/json' };

  // Anonymous: public read works, identity does not exist, the metadata hides credential fields.
  const anonymous = await fetch(`${origin}/api/v1/posts`);
  if (anonymous.status !== 200) fail(`anonymous list: ${anonymous.status}`);
  if ((await fetch(`${origin}/api/auth/me`)).status !== 401) fail('anonymous /me must be 401');
  const metadata = await (await fetch(`${origin}/api/v1/collections`)).text();
  for (const secret of ['passwordHash', '_sessionVersion']) {
    if (metadata.includes(secret)) fail(`anonymous metadata lists ${secret}`);
  }

  // First admin.
  const bootstrap = await fetch(`${origin}/api/bootstrap-admin`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify(ADMIN)
  });
  if (bootstrap.status !== 201) fail(`bootstrap-admin: ${bootstrap.status}`);
  const setCookie = bootstrap.headers.get('set-cookie') ?? '';
  if (!/HttpOnly/i.test(setCookie) || !setCookie.startsWith('forge_session=')) {
    fail(`the session cookie is not HttpOnly forge_session: ${setCookie}`);
  }
  const bootstrapped = await bootstrap.json();
  if (bootstrapped.data.user.role !== 'admin') fail('the first user is not an admin');
  if (
    (
      await fetch(`${origin}/api/bootstrap-admin`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify(ADMIN)
      })
    ).status !== 409
  ) {
    fail('a second bootstrap must be refused');
  }

  // An oversized login body is refused with 413 and the Node server survives it.
  const oversized = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ email: ADMIN.email, password: 'x'.repeat(200_000) })
  }).catch((error) => fail(`the server dropped an oversized login body: ${error}`));
  if (oversized.status !== 413)
    fail(`an oversized login body must be 413, got ${oversized.status}`);

  // Sign in with the documented route.
  const loginResponse = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify(ADMIN)
  });
  if (loginResponse.status !== 200) fail(`login: ${loginResponse.status}`);
  const cookie = cookieOf(loginResponse);
  const me = await (await fetch(`${origin}/api/auth/me`, { headers: { cookie } })).json();
  const admin = me.data?.user ?? me.data;
  if (admin?.email !== ADMIN.email) fail(`/me does not return the admin: ${JSON.stringify(me)}`);

  // CSRF: a cookie-authenticated write from another origin is refused; the same origin is accepted.
  const post = { title: 'Hello Analog', author: admin.id, _status: 'draft' };
  const crossSite = await fetch(`${origin}/api/v1/posts`, {
    method: 'POST',
    headers: { ...json, cookie, origin: 'https://evil.example' },
    body: JSON.stringify(post)
  });
  if (crossSite.status !== 403) fail(`a cross-origin write must be 403, got ${crossSite.status}`);
  const created = await fetch(`${origin}/api/v1/posts`, {
    method: 'POST',
    headers: { ...json, cookie, ...same },
    body: JSON.stringify(post)
  });
  if (created.status !== 201) fail(`create: ${created.status} ${await created.text()}`);
  const draft = (await created.json()).data;

  // The draft is invisible to the public until it is published.
  const publicList = async () => (await (await fetch(`${origin}/api/v1/posts`)).json()).data;
  if ((await publicList()).length !== 0) fail('a draft is visible to the public');
  const published = await fetch(`${origin}/api/v1/posts/${draft.id}`, {
    method: 'PUT',
    headers: { ...json, cookie, ...same },
    body: JSON.stringify({ _status: 'published' })
  });
  if (published.status !== 200) fail(`publish: ${published.status} ${await published.text()}`);
  const visible = await publicList();
  if (visible.length !== 1 || visible[0].title !== 'Hello Analog')
    fail('the published post is not public');
  if (JSON.stringify(visible).includes('passwordHash'))
    fail('a public read leaked credential material');

  // Upload through the documented multipart route, served back through the media route.
  const form = new FormData();
  form.set('file', new Blob(['quickstart bytes'], { type: 'text/plain' }), 'hello.txt');
  const upload = await fetch(`${origin}/api/v1/media`, {
    method: 'POST',
    headers: { cookie, ...same },
    body: form
  });
  if (upload.status !== 201) fail(`upload: ${upload.status} ${await upload.text()}`);
  const media = (await upload.json()).data;
  if (typeof media.url !== 'string' || !media.url.startsWith('/api/media/')) {
    fail(`unexpected media url: ${media.url}`);
  }
  const file = await fetch(`${origin}${media.url}`);
  if (file.status !== 200 || (await file.text()) !== 'quickstart bytes')
    fail('the uploaded file did not round-trip');

  // Logout ends the session.
  const out = await fetch(`${origin}/api/auth/logout`, {
    method: 'POST',
    headers: { cookie, ...same }
  });
  if (out.status !== 200 && out.status !== 204) fail(`logout: ${out.status}`);
  console.log(
    '  ✓ documented routes: first admin · session cookie · CSRF · draft→publish · upload → /api/media · logout'
  );
}

async function browser(origin) {
  const chromium = await loadChromium();
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext()).newPage();
    const problems = [];
    page.on('console', (message) => {
      // The anonymous `GET /api/auth/me` is an expected 401: the browser logs it as a failed resource load.
      if (/status of 401/.test(message.text())) return;
      if (message.type() === 'error' || /NG0\d+|JIT compiler/.test(message.text())) {
        problems.push(message.text());
      }
    });
    page.on('pageerror', (error) => problems.push(error.message));

    await page.goto(`${origin}/`);
    await page.getByText('Hello Analog').waitFor();
    // The guard sends an anonymous visitor to the sign-in page, remembering where they were going.
    await page.goto(`${origin}/admin/collections`);
    await page.waitForURL(/\/admin\/login\?returnUrl=/);
    await page.locator('#forge-signin-email').fill(ADMIN.email);
    await page.locator('#forge-signin-password').fill(ADMIN.password);
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await page.waitForURL(`${origin}/admin/collections`);
    await page.getByText(/posts/i).first().waitFor();
    if (problems.length > 0) fail(`browser problems:\n${problems.join('\n')}`);
  } finally {
    await browser.close();
  }
  console.log(
    '  ✓ browser: public page · admin guard → /admin/login → sign in → /admin/collections (no console errors)'
  );
}

/**
 * `tarballs` maps each Forge package to its `file:` tarball (packed mode, the default) or to an exact registry version
 * (`scripts/registry/registry-consumers.mjs`). `install` swaps the `.npmrc`, the `pnpm install` arguments and adds an
 * `afterInstall(dir)` hook for the registry mode; the default is unchanged.
 */
export async function verifyAngularQuickstart({
  workDir,
  tarballs,
  install = { npmrc: NPMRC, args: ['--prefer-offline'] }
}) {
  const dir = join(workDir, 'angular');
  mkdirSync(dir, { recursive: true });
  copyExample('analog-quickstart', dir);
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest(tarballs), null, 2)}\n`);
  writeFileSync(join(dir, '.npmrc'), install.npmrc);

  assertCleanConsumer(dir, 'Angular/Analog quickstart', {
    ...(install.registryVersion !== undefined && { registryVersion: install.registryVersion })
  });
  run('pnpm', ['install', ...install.args], dir);
  install.afterInstall?.(dir);
  const duplicates = findDuplicateStoreEntries(readdirSync(join(dir, 'node_modules', '.pnpm')));
  if (duplicates.length > 0) fail(`more than one Angular copy: ${JSON.stringify(duplicates)}`);

  run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json', '--noEmit'], dir);
  run('pnpm', ['exec', 'ngc', '-p', 'tsconfig.app.json', '--noEmit'], dir);
  run('pnpm', ['exec', 'vite', 'build', '--logLevel', 'warn'], dir);

  const client = jsFiles(join(dir, 'dist', 'analog', 'public'));
  if (client.length === 0) fail('no client bundle');
  const code = client.map((file) => readFileSync(file, 'utf8')).join('\n');
  const unlinked = countUnlinkedDeclarations(code);
  if (unlinked > 0) fail(`${unlinked} unlinked partial-Ivy declarations in the browser bundle`);
  for (const forbidden of ['ForgeCmsRuntime', 'defineEventHandler', AUTH_SECRET]) {
    if (code.includes(forbidden)) fail(`the browser bundle contains '${forbidden}'`);
  }
  console.log(
    '  ✓ production build: strict TS + strict templates; browser bundle fully linked, no server code'
  );

  const server = await startServer(dir);
  try {
    await exercise(server.origin);
    await browser(server.origin);
    await install.browserChecks?.(server.origin);
    const output = server.logs.join('');
    for (const problem of ['JIT compiler unavailable', 'NG0', 'ERROR', 'Unhandled']) {
      if (output.includes(problem)) fail(`the server logged '${problem}':\n${output}`);
    }
  } finally {
    server.child.kill();
  }
  console.log(
    `\nAngular/Analog quickstart passed (Angular ${VERSIONS.angular}, Analog ${VERSIONS.analog}, Vite ${VERSIONS.vite}, TypeScript ${VERSIONS.typescript}).`
  );
}
