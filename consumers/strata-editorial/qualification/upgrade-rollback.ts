// Release A → release B → rollback to the RETAINED artifact A, on one durable libSQL database and one
// AUTH_SECRET, with a real Chromium session open across both switches.
// Usage: node --experimental-strip-types qualification/upgrade-rollback.ts   (builds both releases itself)
//
// Deployment model rehearsed: an immutable artifact per release and a distinct EDITORIAL_BUILD_ID per release.
// Previous browser assets are NOT retained by the Nitro server (finding R-1); the stale-document case is
// asserted to fail safe instead.
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from '@playwright/test';

import { CANARIES, EDITORS } from '../scripts/fixture.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 4710;
const BASE = `http://127.0.0.1:${PORT}`;
const work = mkdtempSync(join(tmpdir(), 'editorial-release-'));
const databaseFile = join(work, 'editorial.db');
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

function build(id: string): string {
  const out = spawnSync('pnpm', ['build'], {
    cwd: ROOT,
    env: { ...process.env, EDITORIAL_BUILD_ID: id },
    encoding: 'utf8'
  });
  if (out.status !== 0) throw new Error(`build ${id} failed:\n${out.stdout}\n${out.stderr}`);
  const target = join(work, id);
  cpSync(join(ROOT, 'dist/analog'), target, { recursive: true });
  return target;
}

const schema = () =>
  spawnSync('sqlite3', [databaseFile, '.schema'], { encoding: 'utf8' })
    .stdout.replace(/\s+/g, ' ')
    .trim();

async function start(release: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, [join(release, 'server/index.mjs')], {
    env: {
      PATH: process.env['PATH'] ?? '',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
      DATABASE_URL: `file:${databaseFile}`,
      AUTH_SECRET: CANARIES.authSecret
    },
    stdio: 'ignore'
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return child;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`release ${release} did not start`);
}

async function stop(child: ChildProcess): Promise<void> {
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await exited;
}

const committed = (id: string) => `() => (globalThis.__editorialHydration ?? []).some(
  (o) => o.outcome === 'committed' && !o.buildMismatch) && document.querySelector('[data-strata-build]')?.getAttribute('data-strata-build') === '${id}'`;

let server: ChildProcess | undefined;
const browser = await chromium.launch();
try {
  console.log('building release A and release B …');
  const releaseA = build('rel-a');
  const releaseB = build('rel-b');
  check(
    'release A and B have distinct browser entry scripts',
    readdirSync(join(releaseA, 'public/assets')).find((f) => f.startsWith('index-')) !==
      readdirSync(join(releaseB, 'public/assets')).find((f) => f.startsWith('index-'))
  );

  const seeded = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: `file:${databaseFile}`, AUTH_SECRET: CANARIES.authSecret },
    stdio: 'inherit'
  });
  if (seeded.status !== 0) throw new Error('seed failed');

  // --- Release A in production; an editor is mid-task ----------------------------------------------
  server = await start(releaseA);
  const schemaA = schema();
  const context = await browser.newContext({ baseURL: BASE });
  const login = await context.request.post('/api/account/login', {
    data: { email: EDITORS.ana.email, password: EDITORS.ana.password },
    headers: { origin: BASE }
  });
  check('editor signs in on release A', login.status() === 200);
  const page = await context.newPage();
  await page.goto('/posts/ana-draft-investigation');
  await page.waitForFunction(committed('rel-a'));
  check('release A document hydrates with build identity rel-a', true);
  const documentA = await (await fetch(`${BASE}/posts/welcome-to-the-desk`)).text();

  // --- Upgrade to B while that tab is still open ---------------------------------------------------
  await stop(server);
  server = await start(releaseB);
  check('database schema unchanged by the upgrade (no migration)', schema() === schemaA);
  const posts: string[] = [];
  page.on('request', (request) => request.method() === 'POST' && posts.push(request.url()));
  await page.locator('[data-review-toggle]').click();
  await page
    .locator('[data-review-result]')
    .filter({ hasText: 'Published.' })
    .waitFor({ timeout: 10_000 });
  check(
    'unfinished action on an A document completes against release B (one request)',
    posts.length === 1
  );
  await page.reload();
  await page.waitForFunction(committed('rel-b'));
  check(
    'after reload: release B document + B scripts, same session, change persisted',
    (await page.locator('[data-review-status]').getAttribute('data-status')) === 'published'
  );

  // A second tab that still holds release A's DOCUMENT after the upgrade (restored from history, a slow
  // CDN edge). Finding R-1: Nitro node-server serves only the assets in its BUILD-TIME manifest, so A's hashed
  // scripts cannot be retained by copying files into B's public dir. Assert what actually happens and that it
  // is safe: the server HTML stays readable and nothing hydrates across builds.
  const staleTab = await context.newPage();
  await staleTab.route(`${BASE}/posts/welcome-to-the-desk`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: documentA })
  );
  const missingAssets: string[] = [];
  const pageErrors: string[] = [];
  staleTab.on(
    'response',
    (response) => response.status() === 404 && missingAssets.push(new URL(response.url()).pathname)
  );
  staleTab.on('pageerror', (error) => pageErrors.push(error.message));
  await staleTab.goto('/posts/welcome-to-the-desk');
  await staleTab.waitForLoadState('networkidle');
  check(
    'R-1 observed: release B does not serve release A’s hashed entry (copy-retention ineffective)',
    missingAssets.some((path) => path.startsWith('/assets/index-')),
    missingAssets.join(', ')
  );
  const observations = await staleTab.evaluate(
    () => (globalThis as { __editorialHydration?: unknown[] }).__editorialHydration ?? []
  );
  check(
    'stale A document fails safe: server HTML readable, no hydration across builds, no page error',
    (await staleTab.locator('#post h1').textContent()) === 'Welcome to the desk' &&
      observations.length === 0 &&
      pageErrors.length === 0,
    `observations=${observations.length} pageErrors=${pageErrors.length}`
  );
  // A real navigation recovers: the next document and its scripts both come from release B.
  await staleTab.unroute(`${BASE}/posts/welcome-to-the-desk`);
  await staleTab.reload();
  await staleTab.waitForFunction(committed('rel-b'));
  check('reloading the stale tab recovers on release B', true);
  await staleTab.close();

  // --- Rollback to the retained artifact A --------------------------------------------------------
  await stop(server);
  server = await start(releaseA);
  check('database schema unchanged by the rollback', schema() === schemaA);
  await page.reload();
  await page.waitForFunction(committed('rel-a'));
  check(
    'rollback: retained artifact A serves the same session and the data written under B',
    (await page.locator('[data-review-status]').getAttribute('data-status')) === 'published'
  );
  await page.locator('[data-review-toggle]').click();
  await page
    .locator('[data-review-result]')
    .filter({ hasText: 'Moved back to draft.' })
    .waitFor({ timeout: 10_000 });
  const anonymous = await fetch(`${BASE}/posts/ana-draft-investigation`);
  check(
    'after rollback the editor can still act; the post is private again',
    anonymous.status === 404
  );
  await context.close();
} finally {
  await browser.close();
  if (server) await stop(server);
  const failed = results.filter((r) => !r.ok);
  mkdirSync(join(ROOT, 'qualification/artifacts'), { recursive: true });
  writeFileSync(
    join(ROOT, 'qualification/artifacts/upgrade-rollback.json'),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        checks: results,
        verdict: failed.length || !results.length ? 'FAIL' : 'PASS'
      },
      null,
      2
    )
  );
  rmSync(work, { recursive: true, force: true });
  console.log(
    `\n${results.length - failed.length}/${results.length} passed → ${failed.length ? 'FAIL' : 'PASS'}`
  );
  if (failed.length) process.exitCode = 1;
}
