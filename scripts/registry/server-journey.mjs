// The compiled server-only consumer, driven over real HTTP and across a process restart (roadmap L02).
// `fixtures/server` is built with strict tsc against the registry packages; this runs `dist/server.js` and
// `dist/local-api.js` as plain Node and asserts the documented behaviour.
import { spawn, execFileSync } from 'node:child_process';
import { freePort } from '../ssr-consumer/shared.mjs';

const ADMIN = { email: 'admin@example.test', password: 'registry-consumer-passphrase' };
const VIEWER = { email: 'viewer@example.test', password: ADMIN.password };
const AUTH_SECRET = 'registry-consumer-secret-0123456789abcdef-0123';

const fail = (message) => {
  throw new Error(message);
};
const expect = (condition, message) => {
  if (!condition) fail(message);
};

async function start(dir, databaseUrl) {
  const port = await freePort();
  const logs = [];
  const child = spawn(process.execPath, ['dist/server.js'], {
    cwd: dir,
    env: {
      ...process.env,
      PORT: String(port),
      AUTH_SECRET,
      DATABASE_URL: databaseUrl,
      NODE_ENV: 'production'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr.on('data', (chunk) => logs.push(String(chunk)));
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      if ((await fetch(`${origin}/api/v1/posts`)).status === 200) return { child, origin, logs };
    } catch {
      // not listening yet
    }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill();
  fail(`the compiled server did not start:\n${logs.join('')}`);
}

async function stop(server) {
  server.child.kill('SIGTERM');
  await new Promise((resolve) => server.child.once('exit', resolve));
}

const cookieOf = (response) => (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

function client(origin) {
  const call = async (method, path, { cookie, body, sameOrigin = true, headers = {} } = {}) => {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        ...(body !== undefined && { 'content-type': 'application/json' }),
        ...(cookie && { cookie }),
        ...(cookie && sameOrigin && { origin }),
        ...headers
      },
      ...(body !== undefined && { body: JSON.stringify(body) })
    });
    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: response.status, json, headers: response.headers };
  };
  return call;
}

/** Every error body must be the documented `{ error: { code, message } }` envelope. */
function envelope(result, status, code, label) {
  expect(
    result.status === status,
    `${label}: expected ${status}, got ${result.status} ${JSON.stringify(result.json)}`
  );
  expect(
    result.json?.error &&
      typeof result.json.error.code === 'string' &&
      typeof result.json.error.message === 'string',
    `${label}: not an error envelope: ${JSON.stringify(result.json)}`
  );
  if (code)
    expect(
      result.json.error.code === code,
      `${label}: code ${result.json.error.code}, expected ${code}`
    );
}

async function firstRun(server) {
  const call = client(server.origin);

  // Anonymous: public read works, identity does not, nothing is writable.
  const list = await call('GET', '/api/v1/posts');
  expect(
    list.status === 200 && Array.isArray(list.json?.data) && list.json.meta,
    'anonymous list envelope'
  );
  envelope(await call('GET', '/api/auth/me'), 401, undefined, 'anonymous /me');
  envelope(
    await call('POST', '/api/v1/posts', { body: { title: 'x' } }),
    401,
    undefined,
    'anonymous create'
  );
  envelope(await call('GET', '/api/v1/nope'), 404, 'NOT_FOUND', 'unknown collection');

  // First-admin bootstrap, once.
  const boot = await fetch(`${server.origin}/api/bootstrap-admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ADMIN)
  });
  expect(boot.status === 201, `bootstrap: ${boot.status}`);
  expect(
    /HttpOnly/i.test(boot.headers.get('set-cookie') ?? ''),
    'the session cookie is not HttpOnly'
  );
  expect((await boot.json()).data.user.role === 'admin', 'the first user is not an admin');
  envelope(
    await call('POST', '/api/bootstrap-admin', { body: ADMIN }),
    409,
    undefined,
    'second bootstrap'
  );

  // Authentication.
  envelope(
    await call('POST', '/api/auth/login', { body: { ...ADMIN, password: 'wrong-password-123' } }),
    401,
    undefined,
    'bad login'
  );
  const login = await fetch(`${server.origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ADMIN)
  });
  expect(login.status === 200, `login: ${login.status}`);
  const cookie = cookieOf(login);
  const me = await call('GET', '/api/auth/me', { cookie });
  const admin = me.json?.data?.user ?? me.json?.data;
  expect(admin?.email === ADMIN.email && admin.role === 'admin', `/me: ${JSON.stringify(me.json)}`);
  expect(!JSON.stringify(me.json).includes('passwordHash'), '/me leaks the password hash');

  const viewerLogin = await fetch(`${server.origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(VIEWER)
  });
  expect(viewerLogin.status === 200, `viewer login: ${viewerLogin.status}`);
  const viewerCookie = cookieOf(viewerLogin);

  // CSRF: a cookie-authenticated write from another origin is refused.
  const cross = await call('POST', '/api/v1/categories', {
    cookie,
    body: { name: 'Evil' },
    sameOrigin: false,
    headers: { origin: 'https://evil.example' }
  });
  envelope(cross, 403, undefined, 'cross-origin write');

  // Access control: a viewer is authenticated but not allowed to write; an admin is.
  envelope(
    await call('POST', '/api/v1/categories', { cookie: viewerCookie, body: { name: 'Nope' } }),
    403,
    undefined,
    'viewer create'
  );
  const category = await call('POST', '/api/v1/categories', {
    cookie,
    body: { name: 'Release Notes' }
  });
  expect(
    category.status === 201 && category.json.data.slug === 'release-notes',
    `category: ${JSON.stringify(category.json)}`
  );

  // Validation and unknown fields are rejected with the envelope, nothing is stored.
  const invalid = await call('POST', '/api/v1/posts', { cookie, body: { author: admin.id } });
  envelope(invalid, 400, undefined, 'missing required title');
  const unknown = await call('POST', '/api/v1/posts', {
    cookie,
    body: { title: 'x', author: admin.id, bogus: 1 }
  });
  expect(
    unknown.status >= 400 && unknown.status < 500 && unknown.json?.error,
    `unknown field accepted: ${unknown.status}`
  );

  // Drafts: invisible to the public until published.
  const created = await call('POST', '/api/v1/posts', {
    cookie,
    body: {
      title: 'Hello Registry',
      body: 'first',
      views: 1,
      category: category.json.data.id,
      author: admin.id
    }
  });
  expect(created.status === 201, `create post: ${created.status} ${JSON.stringify(created.json)}`);
  const post = created.json.data;
  expect(post._status === 'draft', `a new post must be a draft, got ${post._status}`);
  expect(post.slug === 'hello-registry', `slug: ${post.slug}`);
  const publicDrafts = await call('GET', '/api/v1/posts');
  expect(publicDrafts.json.data.length === 0, 'a draft is visible to the public');
  expect(
    (await call('GET', `/api/v1/posts/${post.id}`)).status === 404,
    'a draft is readable by id anonymously'
  );
  const asAdmin = await call('GET', '/api/v1/posts?status=all', { cookie });
  expect(
    asAdmin.json?.data?.length === 1,
    `the admin cannot see the draft: ${JSON.stringify(asAdmin.json)}`
  );

  envelope(await call('DELETE', `/api/v1/posts/${post.id}`), 401, undefined, 'anonymous delete');
  envelope(
    await call('PUT', `/api/v1/posts/${post.id}`, {
      cookie: viewerCookie,
      body: { _status: 'published' }
    }),
    403,
    undefined,
    'viewer publish'
  );
  const published = await call('PUT', `/api/v1/posts/${post.id}`, {
    cookie,
    body: { _status: 'published', views: 2 }
  });
  expect(
    published.status === 200 && published.json.data._status === 'published',
    `publish: ${JSON.stringify(published.json)}`
  );
  const visible = await call('GET', '/api/v1/posts');
  expect(
    visible.json.data.length === 1 && visible.json.data[0].title === 'Hello Registry',
    'published post not public'
  );
  expect(visible.json.meta.totalDocs === 1, 'meta.totalDocs');

  // Relations: depth 1 populates the category; depth 0 leaves the id.
  const populated = await call('GET', `/api/v1/posts/${post.id}?depth=1`);
  expect(
    populated.json?.data?.category?.name === 'Release Notes',
    `relation not populated: ${JSON.stringify(populated.json)}`
  );
  expect(
    !JSON.stringify(populated.json).includes('passwordHash'),
    'a populated relation leaks credentials'
  );
  const filtered = await call('GET', '/api/v1/posts?title=Hello%20Registry&views[gte]=2');
  expect(filtered.json?.data?.length === 1, 'query filter');
  expect(
    (await call('GET', '/api/v1/posts?views[gte]=3')).json?.data?.length === 0,
    'query filter excludes'
  );
  envelope(await call('GET', '/api/v1/posts?views[bogus]=1'), 400, undefined, 'unknown operator');

  // 404 and unique-constraint envelopes.
  envelope(await call('GET', '/api/v1/posts/does-not-exist'), 404, 'NOT_FOUND', 'unknown id');
  const duplicate = await call('POST', '/api/v1/categories', {
    cookie,
    body: { name: 'Release Notes' }
  });
  expect(
    duplicate.status === 409 || duplicate.status === 400,
    `duplicate slug: ${duplicate.status}`
  );
  expect(duplicate.json?.error, 'duplicate slug without an envelope');

  // Globals.
  envelope(await call('GET', '/api/v1/globals/site_settings'), 404, 'NOT_FOUND', 'unset global');
  envelope(
    await call('PUT', '/api/v1/globals/site_settings', {
      cookie: viewerCookie,
      body: { siteName: 'x' }
    }),
    403,
    undefined,
    'viewer global write'
  );
  const global = await call('PUT', '/api/v1/globals/site_settings', {
    cookie,
    body: { siteName: 'Registry Site', tagline: 'rc.2' }
  });
  expect(
    global.status === 200 && global.json.data.siteName === 'Registry Site',
    `global update: ${JSON.stringify(global.json)}`
  );
  expect(
    (await call('GET', '/api/v1/globals/site_settings')).json.data.tagline === 'rc.2',
    'anonymous global read'
  );

  // Delete: viewer refused, admin 204, then 404.
  const extra = (await call('POST', '/api/v1/categories', { cookie, body: { name: 'Temporary' } }))
    .json.data;
  envelope(
    await call('DELETE', `/api/v1/categories/${extra.id}`, { cookie: viewerCookie }),
    403,
    undefined,
    'viewer delete'
  );
  expect(
    (await call('DELETE', `/api/v1/categories/${extra.id}`, { cookie })).status === 204,
    'admin delete is not 204'
  );
  envelope(
    await call('GET', `/api/v1/categories/${extra.id}`),
    404,
    'NOT_FOUND',
    'read after delete'
  );

  // Logout ends the session.
  const out = await call('POST', '/api/auth/logout', { cookie });
  expect(out.status === 200 || out.status === 204, `logout: ${out.status}`);
  return { cookie, postId: post.id };
}

async function secondRun(server, { cookie, postId }) {
  const call = client(server.origin);
  // Persistence across a process restart: the data, the users and the signing secret all survive.
  const list = await call('GET', '/api/v1/posts');
  expect(
    list.json.data.length === 1 && list.json.data[0].id === postId,
    'the published post did not survive a restart'
  );
  expect(
    (await call('GET', '/api/v1/globals/site_settings')).json?.data?.siteName === 'Registry Site',
    'the global did not survive'
  );
  envelope(
    await call('POST', '/api/bootstrap-admin', { body: ADMIN }),
    409,
    undefined,
    'bootstrap after restart'
  );
  const login = await fetch(`${server.origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ADMIN)
  });
  expect(login.status === 200, 'the admin cannot sign in after a restart');
  void cookie;
}

export async function runServerJourney({ dir, databaseUrl }) {
  const first = await start(dir, databaseUrl);
  let state;
  try {
    state = await firstRun(first);
  } finally {
    await stop(first);
  }
  const second = await start(dir, databaseUrl);
  try {
    await secondRun(second, state);
  } finally {
    await stop(second);
  }

  // Local API in a separate process, on the very database the server left behind.
  const output = execFileSync(process.execPath, ['dist/local-api.js'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, AUTH_SECRET, DATABASE_URL: databaseUrl, NODE_ENV: 'production' }
  });
  process.stdout.write(output.replace(/^/gm, '    '));
  for (const expected of [
    'local:published=1 all=1',
    'local:updated views=2 read=Local API post',
    'local:viewer-create=AccessDeniedError',
    'local:missing-title=ValidationFailedError',
    'local:deleted=NotFoundError'
  ]) {
    expect(output.includes(expected), `Local API output lacks "${expected}":\n${output}`);
  }
  const logs = [...first.logs, ...second.logs].join('');
  for (const problem of ['unhandled', 'Error:', 'ERR_']) {
    expect(!logs.includes(problem), `the server logged '${problem}':\n${logs}`);
  }
  console.log(
    '  ✓ server-only journey: HTTP + Local API + access + drafts + relations + globals + restart persistence'
  );
}
