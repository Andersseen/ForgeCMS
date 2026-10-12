#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * R03 remote journey driver (spec 090). Repository tooling only; talks to a served staging origin over HTTPS.
 *
 *   journey.mjs write  --origin https://… [--state .staging/state.json]   first admin (from empty), CSRF, content, R2, K3
 *   journey.mjs read   --origin https://… [--state …]                     reads only: auth, content, relation, R2 bytes (post-redeploy / restore)
 *   journey.mjs post-write --origin https://… [--state …]                 one new write (restored environment)
 *
 * The disposable admin password is generated here and kept only in the gitignored state file. Cookies, tokens
 * and passwords are never printed.
 */
const args = process.argv.slice(2);
const cmd = args[0];
const flag = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const origin = (flag('origin') ?? '').replace(/\/$/, '');
const statePath = resolve(flag('state') ?? '.staging/state.json');
if (!/^https:\/\//.test(origin)) {
  console.error('--origin https://… required');
  process.exit(2);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const FIXTURE = Buffer.from('forge-r03-fixture-bytes\n'.repeat(40) + 'end', 'utf8');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
const save = () => {
  mkdirSync(resolve(statePath, '..'), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2));
};

let cookie = '';
async function api(
  path,
  { method = 'GET', body, headers = {}, auth = true, sameOrigin = true, raw } = {}
) {
  const h = { ...headers };
  if (auth && cookie) h.cookie = cookie;
  if (sameOrigin && method !== 'GET') h.origin = origin;
  if (body !== undefined && !(body instanceof FormData)) h['content-type'] = 'application/json';
  const res = await fetch(origin + path, {
    method,
    headers: h,
    ...(body !== undefined && { body: body instanceof FormData ? body : JSON.stringify(body) }),
    redirect: 'manual'
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let json;
  try {
    json = JSON.parse(buf.toString('utf8'));
  } catch {
    json = undefined;
  }
  const set = res.headers.get('set-cookie');
  return { status: res.status, json, buf, headers: res.headers, set, ...(raw && { res }) };
}
const takeCookie = (r) => {
  if (r.set) cookie = r.set.split(';')[0];
};

async function login() {
  const r = await api('/api/account/login', {
    method: 'POST',
    body: { email: state.email, password: state.password },
    auth: false
  });
  takeCookie(r);
  check('login → 200 + session cookie', r.status === 200 && !!r.set, `status ${r.status}`);
  check(
    'session cookie is Secure + HttpOnly',
    /;\s*secure/i.test(r.set ?? '') && /httponly/i.test(r.set ?? '')
  );
  return r;
}

async function authReads() {
  const me = await api('/api/account/me');
  check('me → 200 as the admin', me.status === 200 && me.json?.data?.email === state.email);
  if (state.adminId) check('admin id preserved', me.json?.data?.id === state.adminId);
  state.adminId = me.json?.data?.id;
  const bad = await api('/api/account/me', { auth: false });
  check('anonymous me → 401', bad.status === 401);
}

async function contentReads() {
  const anon = await api('/api/site/posts', { auth: false });
  const titles = (anon.json?.data ?? []).map((p) => p.title);
  check(
    'anonymous list shows the published post',
    titles.includes(state.postTitle),
    `${titles.length} post(s)`
  );
  check('anonymous list hides the draft', !titles.includes(state.draftTitle));
  const doc = await api(`/api/content/posts/${state.postId}`);
  check(
    'post persisted: id, edited title, relation',
    doc.status === 200 &&
      doc.json?.data?.title === state.postTitle &&
      String(doc.json?.data?.author?.id ?? doc.json?.data?.author) === state.adminId,
    `status ${doc.status}`
  );
  check('post is published', doc.json?.data?._status === 'published');
  const slug = doc.json?.data?.slug;
  const page = await fetch(`${origin}/posts/${slug}`);
  const html = await page.text();
  check(
    'SSR deep link renders the published title',
    page.status === 200 && html.includes(state.postTitle),
    `status ${page.status}`
  );
}

async function mediaReads() {
  const doc = await api(`/api/content/media/${state.mediaId}`);
  check(
    'media doc persisted',
    doc.status === 200 && doc.json?.data?.filename === 'r03-fixture.bin'
  );
  check('media _storageKey preserved', doc.json?.data?._storageKey === state.storageKey, '');
  const file = await api(`/api/media/${state.storageKey}`);
  check(
    '/api/media → exact bytes',
    file.status === 200 && sha(file.buf) === sha(FIXTURE),
    `status ${file.status}`
  );
  check(
    '/api/media content-type preserved',
    (file.headers.get('content-type') ?? '').startsWith('application/octet-stream') ||
      (file.headers.get('content-type') ?? '').startsWith(state.contentType ?? 'x'),
    file.headers.get('content-type') ?? ''
  );
}

async function write() {
  const status = await api('/api/account/me', { auth: false });
  check('starts anonymous', status.status === 401);
  if (!state.email) {
    const emptyProbe = await api('/api/bootstrap-admin', { method: 'POST', body: {}, auth: false });
    check(
      'bootstrap probe on empty D1 → 400 (not 409): zero users',
      emptyProbe.status === 400,
      `status ${emptyProbe.status}`
    );

    state.email = `r03-admin-${randomBytes(3).toString('hex')}@staging.invalid`;
    state.password = randomBytes(18).toString('base64url');
    save();
    const boot = await api('/api/bootstrap-admin', {
      method: 'POST',
      body: { email: state.email, password: state.password, name: 'R03 Admin' },
      auth: false
    });
    takeCookie(boot);
    check(
      'bootstrap first admin → 201 + cookie',
      boot.status === 201 && !!boot.set,
      `status ${boot.status}`
    );
    check(
      'bootstrap user is admin, no passwordHash/_sessionVersion in body',
      boot.json?.data?.user?.role === 'admin' &&
        !/passwordHash|_sessionVersion/.test(boot.buf.toString())
    );
    const again = await api('/api/bootstrap-admin', {
      method: 'POST',
      body: { email: 'x@y.invalid', password: 'zzzzzzzzzz' },
      auth: false
    });
    check('second bootstrap → 409', again.status === 409);
  }

  cookie = '';
  await login();
  await authReads();

  // CSRF
  const xo = await api('/api/content/posts', {
    method: 'POST',
    body: { title: 'csrf-probe', author: state.adminId },
    sameOrigin: false,
    headers: { origin: 'https://evil.example' }
  });
  check(
    'cross-origin cookie mutation rejected (403)',
    xo.status === 403,
    `status ${xo.status} code ${xo.json?.error?.code ?? '-'}`
  );
  const noOrigin = await api('/api/content/posts', {
    method: 'POST',
    body: { title: 'csrf-probe', author: state.adminId },
    sameOrigin: false
  });
  check(
    'cookie mutation with no Origin/Referer rejected (403)',
    noOrigin.status === 403,
    `status ${noOrigin.status}`
  );

  // content
  state.draftTitle = `R03 draft ${randomBytes(2).toString('hex')}`;
  const created = await api('/api/content/posts', {
    method: 'POST',
    body: { title: state.draftTitle, author: state.adminId }
  });
  check(
    'same-origin cookie mutation succeeds (create draft)',
    created.status === 201,
    `status ${created.status}`
  );
  state.postId = created.json?.data?.id;
  check('draft is a draft', created.json?.data?._status === 'draft');
  const hidden = await api('/api/site/posts', { auth: false });
  check(
    'anonymous read hides the draft',
    !(hidden.json?.data ?? []).some((p) => p.id === state.postId)
  );
  const pub = await api(`/api/content/posts/${state.postId}`, {
    method: 'PUT',
    body: { _status: 'published' }
  });
  check(
    'publish',
    pub.status === 200 && pub.json?.data?._status === 'published',
    `status ${pub.status}`
  );
  state.postTitle = `${state.draftTitle} (edited)`;
  const edit = await api(`/api/content/posts/${state.postId}`, {
    method: 'PUT',
    body: { title: state.postTitle }
  });
  check('edit', edit.status === 200, `status ${edit.status}`);
  save();
  await contentReads();

  // R2
  const form = new FormData();
  form.set('file', new Blob([FIXTURE], { type: 'application/octet-stream' }), 'r03-fixture.bin');
  form.set('alt', 'r03 fixture');
  form.set('visibility', 'public');
  const up = await api('/api/content/media', { method: 'POST', body: form });
  check('multipart upload → 201', up.status === 201, `status ${up.status}`);
  state.mediaId = up.json?.data?.id;
  state.storageKey = up.json?.data?._storageKey;
  state.contentType = 'application/octet-stream';
  check(
    'media doc has _storageKey',
    typeof state.storageKey === 'string' && state.storageKey.startsWith('media/')
  );
  save();
  await mediaReads();
  const anonFile = await api(`/api/media/${state.storageKey}`, { auth: false });
  check('public file readable anonymously', anonFile.status === 200);

  // private file semantics + delete
  const form2 = new FormData();
  form2.set('file', new Blob(['private'], { type: 'text/plain' }), 'r03-private.txt');
  form2.set('visibility', 'private');
  const up2 = await api('/api/content/media', { method: 'POST', body: form2 });
  const key2 = up2.json?.data?._storageKey;
  const anonPriv = await api(`/api/media/${key2}`, { auth: false });
  check(
    'private file hidden from anonymous',
    up2.status === 201 && anonPriv.status !== 200,
    `status ${anonPriv.status}`
  );
  const authPriv = await api(`/api/media/${key2}`);
  check(
    'private file readable by staff',
    authPriv.status === 200 && authPriv.buf.toString() === 'private'
  );
  const del = await api(`/api/content/media/${up2.json?.data?.id}`, { method: 'DELETE' });
  check('delete media → 204', del.status === 204, `status ${del.status}`);
  const gone = await api(`/api/media/${key2}`);
  check(
    'deleted file no longer served (R2 object gone)',
    gone.status === 404,
    `status ${gone.status}`
  );
  const gdoc = await api(`/api/content/media/${up2.json?.data?.id}`);
  check('deleted media document gone', gdoc.status === 404);

  await k3();

  // logout
  const out = await api('/api/account/logout', { method: 'POST' });
  check('logout → 2xx', out.status >= 200 && out.status < 300, `status ${out.status}`);
  const after = await api('/api/account/me', { auth: false });
  check('after logout anonymous → 401', after.status === 401);
  state.journeyAt = new Date().toISOString();
  save();
}

async function k3() {
  for (const n of [80, 99, 100, 120, 400]) {
    const values = Array.from({ length: n }, (_, i) => `k3-${n}-${i}`);
    values[0] = state.postTitle ?? values[0];
    const qs = values.map((v, i) => `title[in]=${encodeURIComponent(v)}`).join('&');
    const r = await api(`/api/site/posts?${qs}`, { auth: false });
    const text = r.buf.toString();
    check(
      `K3 title[in] × ${n} → 200`,
      r.status === 200 && !/D1_ERROR|SQLITE_|too many SQL variables/i.test(text),
      `status ${r.status}`
    );
  }
}

async function readOnly() {
  cookie = '';
  await login();
  await authReads();
  await contentReads();
  await mediaReads();
}

async function postWrite() {
  cookie = '';
  await login();
  const c = await api('/api/content/posts', {
    method: 'POST',
    body: {
      title: `R03 post-restore ${randomBytes(2).toString('hex')}`,
      author: state.adminId
    }
  });
  check('post-restore write succeeds', c.status === 201, `status ${c.status}`);
  const d = await api(`/api/content/posts/${c.json?.data?.id}`, { method: 'DELETE' });
  check('post-restore delete succeeds', d.status === 204, `status ${d.status}`);
}

try {
  if (cmd === 'write') await write();
  else if (cmd === 'read') await readOnly();
  else if (cmd === 'post-write') await postWrite();
  else {
    console.error('usage: journey.mjs <write|read|post-write> --origin https://…');
    process.exit(2);
  }
} catch (e) {
  check('journey completed without exception', false, String(e?.message ?? e));
}
const bad = results.filter((r) => !r.ok).length;
console.log(`${results.length - bad}/${results.length} checks passed`);
process.exit(bad ? 1 : 0);
