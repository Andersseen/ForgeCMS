// Node production qualification of the BUILT consumer (dist/analog/server/index.mjs) on a durable libSQL
// file. Usage (after `pnpm build`): node --experimental-strip-types qualification/node-production.ts
//
// Every check is an assertion with an expected value; the run fails (exit 1) on the first mismatch list.
// Writes qualification/artifacts/node-production.json. Never retries a failed check.
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { CANARIES, EDITORS } from '../scripts/fixture.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const SECRET = CANARIES.authSecret;
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

function seed(databaseUrl: string): void {
  const run = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl, AUTH_SECRET: SECRET },
    stdio: 'inherit'
  });
  if (run.status !== 0) throw new Error('seed failed');
}

async function startServer(
  port: number,
  env: Record<string, string>
): Promise<{ child: ChildProcess; log: string[] }> {
  const log: string[] = [];
  const child = spawn(process.execPath, ['dist/analog/server/index.mjs'], {
    cwd: ROOT,
    env: {
      PATH: process.env['PATH'] ?? '',
      PORT: String(port),
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout?.on('data', (chunk: Buffer) => log.push(chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => log.push(chunk.toString()));
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/health`);
      return { child, log };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  child.kill('SIGKILL');
  throw new Error(`server on ${port} did not start`);
}

async function stopServer(child: ChildProcess): Promise<{ code: number | null; ms: number }> {
  const started = performance.now();
  const exited = new Promise<number | null>((resolve) =>
    child.once('exit', (code) => resolve(code))
  );
  child.kill('SIGTERM');
  const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 10_000));
  const code = await Promise.race([exited, timeout]);
  if (code === 'timeout') {
    child.kill('SIGKILL');
    return { code: null, ms: performance.now() - started };
  }
  return { code, ms: performance.now() - started };
}

async function login(base: string, who: keyof typeof EDITORS): Promise<string> {
  const editor = EDITORS[who];
  const response = await fetch(`${base}/api/account/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ email: editor.email, password: editor.password })
  });
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!response.ok || !cookie) throw new Error(`login ${who} failed: ${response.status}`);
  return cookie;
}

const get = (url: string, cookie?: string, extra: Record<string, string> = {}) =>
  fetch(url, { headers: { ...(cookie ? { cookie } : {}), ...extra }, redirect: 'manual' });

const post = (url: string, body: unknown, headers: Record<string, string>) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? NaN;
};

const work = mkdtempSync(join(tmpdir(), 'editorial-node-'));
const databaseUrl = `file:${join(work, 'editorial.db')}`;
const PORT = 4521;
const base = `http://127.0.0.1:${PORT}`;
const evidence: Record<string, unknown> = { startedAt: new Date().toISOString() };

try {
  seed(databaseUrl);
  const { child, log } = await startServer(PORT, {
    DATABASE_URL: databaseUrl,
    AUTH_SECRET: SECRET
  });

  // --- Identity and isolation -------------------------------------------------------------------
  const ana = await login(base, 'ana');
  const ben = await login(base, 'ben');
  const ada = await login(base, 'ada');
  const vic = await login(base, 'vic');

  const doc = async (path: string, cookie?: string) => {
    const response = await get(`${base}${path}`, cookie);
    return {
      status: response.status,
      cc: response.headers.get('cache-control') ?? '',
      html: await response.text()
    };
  };

  const pub = await doc('/posts/welcome-to-the-desk');
  check(
    'anonymous reads a published post (200, public cache)',
    pub.status === 200 && pub.cc.includes('public'),
    `${pub.status} ${pub.cc}`
  );
  check('anonymous document has no review island', !pub.html.includes('review-status-island'));

  for (const [name, cookie, path, status, canary] of [
    ['anonymous → Ana draft', undefined, '/posts/ana-draft-investigation', 404, CANARIES.anaDraft],
    ['viewer → Ana draft', vic, '/posts/ana-draft-investigation', 404, CANARIES.anaDraft],
    ['Ben → Ana draft (cross-user)', ben, '/posts/ana-draft-investigation', 404, CANARIES.anaDraft],
    ['Ana → Ben draft (cross-user)', ana, '/posts/ben-draft-column', 404, CANARIES.benDraft],
    ['Ana → own draft', ana, '/posts/ana-draft-investigation', 200, null],
    ['admin → Ben draft', ada, '/posts/ben-draft-column', 200, null]
  ] as const) {
    const result = await doc(path, cookie);
    const leaked = canary !== null && result.html.includes(canary);
    check(
      `SSR ${name}`,
      result.status === status && !leaked && result.cc.includes('private'),
      `${result.status} ${result.cc}${leaked ? ' LEAK' : ''}`
    );
  }
  const forbiddenNotFound = await doc('/posts/ana-draft-investigation', ben);
  const trueNotFound = await doc('/posts/does-not-exist', ben);
  check(
    'a hidden draft is indistinguishable from a missing post',
    forbiddenNotFound.status === trueNotFound.status &&
      forbiddenNotFound.html.replace(/ng-[\w-]+="[^"]*"/g, '').length > 0 &&
      trueNotFound.html.includes('Post not found') &&
      forbiddenNotFound.html.includes('Post not found')
  );

  const own = await doc('/posts/ana-draft-investigation', ana);
  const anaPostId = /postId&quot;:&quot;([^&]+)&quot;/.exec(own.html)?.[1] ?? '';
  check(
    'owner sees the draft canary and the review island',
    own.html.includes(CANARIES.anaDraft) && anaPostId !== ''
  );
  check(
    'island props carry only id + status',
    /data-strata-props="\{&quot;postId&quot;:&quot;[^&]+&quot;,&quot;initialStatus&quot;:&quot;draft&quot;\}"/.test(
      own.html
    )
  );
  check(
    'no email or session token in any document',
    ![pub.html, own.html].some(
      (html) => html.includes('@editorial.test') || html.includes('forge_session')
    )
  );

  // --- Controller API ---------------------------------------------------------------------------
  const apiList = await get(`${base}/api/editorial/posts`);
  const list = (await apiList.json()) as { data: { slug: string }[]; meta: unknown };
  check(
    'list envelope { data, meta }, published only',
    apiList.status === 200 &&
      Array.isArray(list.data) &&
      list.meta !== undefined &&
      list.data.every((p) => !p.slug.includes('draft'))
  );
  for (const [name, cookie, headers, status] of [
    ['anonymous', undefined, {}, 404],
    ['Ben (cross-user)', ben, {}, 404],
    [
      'forged bearer + identity headers',
      undefined,
      { authorization: 'Bearer forged.token.value', 'x-user-id': 'ana', 'x-forwarded-user': 'ana' },
      404
    ],
    ['owner', ana, {}, 200]
  ] as const) {
    const response = await get(
      `${base}/api/editorial/posts/${anaPostId}?user=ana&author=ana`,
      cookie,
      headers
    );
    const body = await response.text();
    check(
      `API read Ana draft: ${name}`,
      response.status === status && (status === 200 || !body.includes(CANARIES.anaDraft)),
      String(response.status)
    );
    if (status === 200)
      check(
        'API private response is not shared-cacheable',
        (response.headers.get('cache-control') ?? '').includes('no-store')
      );
  }
  const unknownApi = await get(`${base}/api/editorial/nope`);
  check(
    'unknown /api/editorial path → JSON 404 (owned boundary)',
    unknownApi.status === 404 && (unknownApi.headers.get('content-type') ?? '').includes('json')
  );

  // --- Mutations: CSRF, authorization, validation -----------------------------------------------
  const statusUrl = `${base}/api/editorial/posts/${anaPostId}/status`;
  const crossSite = await post(
    statusUrl,
    { status: 'published' },
    { cookie: ana, origin: 'https://evil.example' }
  );
  check('cross-site mutation with the session cookie → 403', crossSite.status === 403);
  const noOrigin = await post(statusUrl, { status: 'published' }, { cookie: ana });
  check('cookie mutation without Origin/Referer → 403', noOrigin.status === 403);
  const anon = await post(statusUrl, { status: 'published' }, { origin: base });
  check('anonymous mutation → 401', anon.status === 401);
  const benWrite = await post(statusUrl, { status: 'published' }, { cookie: ben, origin: base });
  check('Ben cannot publish Ana’s draft (404, nothing revealed)', benWrite.status === 404);
  const vicWrite = await post(statusUrl, { status: 'published' }, { cookie: vic, origin: base });
  check('viewer cannot publish (404)', vicWrite.status === 404);
  const invalid = await post(statusUrl, { status: 'archived' }, { cookie: ana, origin: base });
  check('invalid status → 400', invalid.status === 400);
  const stillDraft = await doc('/posts/ana-draft-investigation');
  check('after refused writes the draft is still private', stillDraft.status === 404);

  const publish = await post(statusUrl, { status: 'published' }, { cookie: ana, origin: base });
  const published = (await publish.json()) as { data?: { status?: string } };
  check(
    'owner publishes (200, { data })',
    publish.status === 200 && published.data?.status === 'published'
  );
  const nowPublic = await doc('/posts/ana-draft-investigation');
  check(
    'published post is now public',
    nowPublic.status === 200 && nowPublic.html.includes(CANARIES.anaDraft)
  );
  const unpublish = await post(statusUrl, { status: 'draft' }, { cookie: ana, origin: base });
  check('owner unpublishes', unpublish.status === 200);
  check(
    'unpublished post is private again',
    (await doc('/posts/ana-draft-investigation')).status === 404
  );

  // --- Native routes coexist --------------------------------------------------------------------
  const me = await get(`${base}/api/account/me`, ben);
  check('native H3 /api/account/me (ForgeCMS handleMe) still served', me.status === 200);
  check('native H3 /api/health still served', (await get(`${base}/api/health`)).status === 200);
  check('unknown document → 404', (await get(`${base}/no/such/page`)).status === 404);

  // --- Concurrency: identities never cross ------------------------------------------------------
  const identities = [
    {
      cookie: ana,
      path: '/posts/ana-draft-investigation',
      status: 200,
      mustNot: CANARIES.benDraft
    },
    {
      cookie: ben,
      path: '/posts/ana-draft-investigation',
      status: 404,
      mustNot: CANARIES.anaDraft
    },
    { cookie: ben, path: '/posts/ben-draft-column', status: 200, mustNot: CANARIES.anaDraft },
    { cookie: undefined, path: '/posts/ben-draft-column', status: 404, mustNot: CANARIES.benDraft },
    {
      cookie: ana,
      path: `/api/editorial/posts/${anaPostId}`,
      status: 200,
      mustNot: CANARIES.benDraft
    },
    {
      cookie: ben,
      path: `/api/editorial/posts/${anaPostId}`,
      status: 404,
      mustNot: CANARIES.anaDraft
    }
  ];
  const rssBefore = process.memoryUsage().rss;
  const latencies: number[] = [];
  let crossed = 0;
  const ROUNDS = 50;
  for (let round = 0; round < ROUNDS; round++) {
    await Promise.all(
      identities.map(async (probe) => {
        const started = performance.now();
        const response = await get(`${base}${probe.path}`, probe.cookie);
        const body = await response.text();
        latencies.push(performance.now() - started);
        if (response.status !== probe.status || body.includes(probe.mustNot)) crossed++;
      })
    );
  }
  check(
    `concurrency: ${ROUNDS * identities.length} interleaved requests, zero identity crossings`,
    crossed === 0,
    `crossings=${crossed}`
  );
  evidence['latencyMs'] = {
    requests: latencies.length,
    p50: Number(percentile(latencies, 50).toFixed(1)),
    p95: Number(percentile(latencies, 95).toFixed(1)),
    max: Number(Math.max(...latencies).toFixed(1))
  };
  evidence['harnessRssDeltaBytes'] = process.memoryUsage().rss - rssBefore;

  // --- Server memory: steady state after a burst (observation, not a budget) ----------------------
  const serverRss = async () => {
    const ps = spawn('ps', ['-o', 'rss=', '-p', String(child.pid)]);
    let out = '';
    ps.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    await new Promise((resolve) => ps.on('exit', resolve));
    return Number(out.trim()) * 1024;
  };
  const rssA = await serverRss();
  for (let i = 0; i < 300; i++) await get(`${base}/posts/welcome-to-the-desk`);
  const rssB = await serverRss();
  for (let i = 0; i < 300; i++) await get(`${base}/posts/welcome-to-the-desk`);
  const rssC = await serverRss();
  evidence['serverRssBytes'] = { afterQualification: rssA, after300More: rssB, after600More: rssC };
  check(
    'server RSS does not keep growing across two equal bursts',
    rssC - rssB <= Math.max(rssB - rssA, 0) + 16 * 1024 * 1024,
    `${Math.round(rssA / 1e6)}→${Math.round(rssB / 1e6)}→${Math.round(rssC / 1e6)} MB`
  );

  // --- Logs never carry secrets or content ------------------------------------------------------
  const logText = log.join('');
  check(
    'server log contains no secret, email, canary or database path',
    ![SECRET, '@editorial.test', CANARIES.anaDraft, CANARIES.benDraft, work].some((s) =>
      logText.includes(s)
    )
  );

  const stop = await stopServer(child);
  check(
    'graceful shutdown on SIGTERM',
    stop.code !== null,
    `${Math.round(stop.ms)} ms, code ${stop.code}`
  );
  evidence['shutdownMs'] = Math.round(stop.ms);

  // --- Unexpected failure and recovery ----------------------------------------------------------
  const missingDir = join(work, 'not-yet');
  const broken = await startServer(PORT + 1, {
    DATABASE_URL: `file:${join(missingDir, 'editorial.db')}`,
    AUTH_SECRET: SECRET
  });
  const brokenBase = `http://127.0.0.1:${PORT + 1}`;
  const health = await get(`${brokenBase}/api/health`);
  check('database unavailable: health 503', health.status === 503);
  const ssrFail = await get(`${brokenBase}/posts/welcome-to-the-desk`);
  const ssrBody = await ssrFail.text();
  check(
    'database unavailable: SSR → generic HTTP 500, no-store (Strata /ssr contract)',
    ssrFail.status === 500 &&
      (ssrFail.headers.get('cache-control') ?? '').includes('no-store') &&
      !/libsql|SQLITE|editorial\.db|stack|at \w+ \(/i.test(ssrBody),
    `${ssrFail.status}`
  );
  const apiFail = await get(`${brokenBase}/api/editorial/posts`);
  const apiFailBody = await apiFail.text();
  check(
    'database unavailable: API → { error } 500 without details',
    apiFail.status === 500 && apiFailBody === '{"error":"Internal server error"}',
    apiFailBody
  );
  const brokenLog = broken.log.join('');
  check(
    'failure log names the error class only (no path, no secret)',
    !brokenLog.includes(missingDir) && !brokenLog.includes(SECRET)
  );
  mkdirSync(missingDir, { recursive: true });
  seed(`file:${join(missingDir, 'editorial.db')}`);
  const recovered = await get(`${brokenBase}/posts/welcome-to-the-desk`);
  check('recovers without restart once the database is reachable', recovered.status === 200);
  await stopServer(broken.child);

  // --- Production refuses in-memory persistence ------------------------------------------------
  const noProfile = await startServer(PORT + 2, { AUTH_SECRET: SECRET });
  const noProfileHealth = await get(`http://127.0.0.1:${PORT + 2}/api/health`);
  const noProfileApi = await get(`http://127.0.0.1:${PORT + 2}/api/editorial/posts`);
  check(
    'no durable profile configured → refuses to serve (503/500), never in-memory',
    noProfileHealth.status === 503 && noProfileApi.status === 500
  );
  await stopServer(noProfile.child);
} finally {
  const failed = results.filter((r) => !r.ok);
  evidence['finishedAt'] = new Date().toISOString();
  evidence['checks'] = results;
  evidence['verdict'] = failed.length === 0 && results.length > 0 ? 'PASS' : 'FAIL';
  mkdirSync(join(ROOT, 'qualification/artifacts'), { recursive: true });
  writeFileSync(
    join(ROOT, 'qualification/artifacts/node-production.json'),
    JSON.stringify(evidence, null, 2)
  );
  rmSync(work, { recursive: true, force: true });
  console.log(
    `\n${results.length - failed.length}/${results.length} passed → ${String(evidence['verdict'])}`
  );
  if (failed.length > 0) process.exitCode = 1;
}
