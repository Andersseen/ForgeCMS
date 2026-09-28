/**
 * Spec 069 (roadmap 0.6 H04): the HTTP auth surface — bounded bodies (413), the host throttle hook (429),
 * redacted logging, CSRF/credential-size interplay and public-signup escalation. Expensive work is
 * observed through spies, never through timing; the throttle is a deterministic in-test fake.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineCollection, defineField, setLogger, consoleLogger } from '@forge-cms/core';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import {
  ApiKeyAuthAdapter,
  CompositeAuthAdapter,
  UsersCollectionAuthAdapter,
  defineUsersCollection
} from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import type { ApiContext } from '@forge-cms/api';
import { ForgeCmsRuntime } from './runtime.js';
import type { AuthAttempt, AuthAttemptDecision, AuthAttemptThrottle } from './auth-handlers.js';
import { handleLogin, handleLogout, handleMe, handleSignup } from './auth-handlers.js';
import { handleCreate, handleList, handleUpdate } from './handlers.js';
import { DEFAULT_AUTH_MAX_BODY_BYTES, readBoundedJsonObject } from './body.js';

async function buildRuntime(auth = new UsersCollectionAuthAdapter({ devMode: true })) {
  const db = new InMemoryDatabaseAdapter();
  const runtime = new ForgeCmsRuntime({
    collections: [
      defineUsersCollection(),
      defineCollection({
        slug: 'notes',
        fields: { title: defineField.text({ required: true }) },
        access: {
          read: () => true,
          create: ({ user }) => user !== null,
          update: ({ user }) => user !== null
        }
      })
    ],
    adapters: { database: db, auth, storage: new InMemoryStorageAdapter() },
    env: { userDatabase: db, apiKeyDatabase: db }
  });
  runtime.init();
  await runtime.syncSchema();
  return { runtime, db };
}

async function withAdmin() {
  const built = await buildRuntime();
  const auth = built.runtime.adapters.auth as UsersCollectionAuthAdapter;
  await auth.signup({ email: 'admin@example.com', password: 'password123' });
  return { ...built, auth };
}

function ctx(request: Request, params?: Record<string, string>): ApiContext<unknown> {
  return { request, env: {}, ...(params !== undefined && { params }) };
}

function post(path: string, body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request(`https://forge.test${path}`, {
    method: 'POST',
    headers,
    body,
    ...(body instanceof ReadableStream && { duplex: 'half' })
  } as RequestInit);
}

function jsonPost(path: string, value: unknown, headers: Record<string, string> = {}): Request {
  return post(path, JSON.stringify(value), headers);
}

async function errorOf(response: Response): Promise<{ code: string; message: string }> {
  return ((await response.json()) as { error: { code: string; message: string } }).error;
}

/** A body whose bytes are produced lazily, counting how many the reader actually pulled. */
function countingStream(totalBytes: number, chunkBytes = 1024) {
  const state = { pulled: 0, cancelled: false };
  const chunk = new TextEncoder().encode(' '.repeat(chunkBytes));
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (state.pulled >= totalBytes) {
          controller.close();
          return;
        }
        state.pulled += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        state.cancelled = true;
      }
      // No eager pre-fill: only bytes a reader actually asks for are counted.
    },
    { highWaterMark: 0 }
  );
  return { stream, state };
}

/** JSON exactly `size` bytes long: a valid login body padded with trailing whitespace. */
function loginBodyOfSize(size: number): string {
  const base = JSON.stringify({ email: 'admin@example.com', password: 'password123' });
  return base + ' '.repeat(size - base.length);
}

/** A deterministic fake host limiter: a fixed budget per identifier, no clock. */
function fakeThrottle(budget: number, decision: Partial<AuthAttemptDecision> = {}) {
  const calls: AuthAttempt[] = [];
  const used = new Map<string, number>();
  const throttle: AuthAttemptThrottle = (attempt) => {
    calls.push(attempt);
    const count = (used.get(attempt.identifier) ?? 0) + 1;
    used.set(attempt.identifier, count);
    return count <= budget ? { allowed: true } : { allowed: false, ...decision };
  };
  return { throttle, calls };
}

afterEach(() => {
  vi.restoreAllMocks();
  setLogger(consoleLogger);
});

describe('bounded auth bodies (413 PAYLOAD_TOO_LARGE)', () => {
  it('the default bound is 8 KiB', () => {
    expect(DEFAULT_AUTH_MAX_BODY_BYTES).toBe(8192);
  });

  it('a body just below and exactly at the bound parses normally', async () => {
    const { runtime } = await withAdmin();
    for (const size of [DEFAULT_AUTH_MAX_BODY_BYTES - 1, DEFAULT_AUTH_MAX_BODY_BYTES]) {
      const response = await handleLogin(ctx(post('/api/auth/login', loginBodyOfSize(size))), {
        runtime
      });
      expect(response.status).toBe(200);
    }
  });

  it('one byte over the bound is 413 and never reaches the auth adapter or the throttle', async () => {
    const { runtime, auth } = await withAdmin();
    const login = vi.spyOn(auth, 'login');
    const { throttle, calls } = fakeThrottle(100);
    const response = await handleLogin(
      ctx(post('/api/auth/login', loginBodyOfSize(DEFAULT_AUTH_MAX_BODY_BYTES + 1))),
      { runtime, throttle }
    );
    expect(response.status).toBe(413);
    expect(await errorOf(response)).toEqual({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request body is too large'
    });
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(login).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('a declared Content-Length over the bound is refused before anything is read', async () => {
    const { runtime } = await withAdmin();
    const { stream, state } = countingStream(10 * 1024 * 1024);
    const response = await handleLogin(
      ctx(post('/api/auth/login', stream, { 'content-length': String(10 * 1024 * 1024) })),
      { runtime }
    );
    expect(response.status).toBe(413);
    expect(state.pulled).toBe(0);
  });

  it('a lying or missing Content-Length cannot get past the stream cap: reading stops and is cancelled', async () => {
    const { runtime } = await withAdmin();
    for (const headers of [{ 'content-length': '20' }, {}]) {
      const { stream, state } = countingStream(50 * 1024 * 1024);
      const response = await handleSignup(ctx(post('/api/auth/signup', stream, headers)), {
        runtime,
        enabled: true
      });
      expect(response.status).toBe(413);
      // At most the bound plus the chunk that crossed it — never the 50 MiB on offer.
      expect(state.pulled).toBeLessThanOrEqual(DEFAULT_AUTH_MAX_BODY_BYTES + 1024);
      expect(state.cancelled).toBe(true);
    }
  });

  it('maxBodyBytes is configurable and validated', async () => {
    const { runtime } = await withAdmin();
    const small = await handleLogin(ctx(post('/api/auth/login', loginBodyOfSize(200))), {
      runtime,
      maxBodyBytes: 100
    });
    expect(small.status).toBe(413);
    // A misconfigured bound is a thrown configuration error, not a (redacted) 500 per request.
    await expect(
      handleLogin(ctx(post('/api/auth/login', '{}')), { runtime, maxBodyBytes: -1 })
    ).rejects.toThrow('maxBodyBytes must be an integer');
    await expect(readBoundedJsonObject(post('/x', '{}'), { maxBytes: 0 })).rejects.toThrow(
      'maxBodyBytes'
    );
    await expect(
      readBoundedJsonObject(post('/x', '{}'), { maxBytes: 2 * 1024 * 1024 })
    ).rejects.toThrow('maxBodyBytes');
  });

  it('malformed input under the bound is a deterministic 400 INVALID_INPUT, never a 500', async () => {
    const { runtime } = await withAdmin();
    const setLog = vi.fn();
    setLogger({ error: setLog });
    const cases: [BodyInit | null, string][] = [
      ['{not json', 'Invalid JSON body'],
      ['', 'Invalid JSON body'],
      [new Uint8Array([0x7b, 0xff, 0x7d]), 'Invalid JSON body'], // invalid UTF-8
      ['null', 'JSON body must be an object'], // was a 500 before spec 069
      ['[1,2]', 'JSON body must be an object'],
      ['"a string"', 'JSON body must be an object'],
      [JSON.stringify({ email: 'a@b.co' }), 'Missing email or password'],
      [JSON.stringify({ email: 1, password: 2 }), 'Missing email or password']
    ];
    for (const [body, message] of cases) {
      const response = await handleLogin(ctx(post('/api/auth/login', body)), { runtime });
      expect(response.status, message).toBe(400);
      expect(await errorOf(response)).toEqual({ code: 'INVALID_INPUT', message });
    }
    expect(setLog).not.toHaveBeenCalled();
  });

  it('an oversized password inside a legal body never reaches PBKDF2 and stays a generic 401', async () => {
    const { runtime } = await withAdmin();
    const derive = vi.spyOn(crypto.subtle, 'deriveBits');
    const response = await handleLogin(
      ctx(jsonPost('/api/auth/login', { email: 'admin@example.com', password: 'x'.repeat(4000) })),
      { runtime }
    );
    expect(response.status).toBe(401);
    expect(await errorOf(response)).toEqual({
      code: 'UNAUTHORIZED',
      message: 'Invalid email or password'
    });
    expect(derive).not.toHaveBeenCalled();
  });
});

describe('login failure parity', () => {
  it('unknown email and wrong password give byte-identical responses with one verification each', async () => {
    const { runtime } = await withAdmin();
    const derive = vi.spyOn(crypto.subtle, 'deriveBits');
    const attempt = async (email: string) => {
      derive.mockClear();
      const response = await handleLogin(
        ctx(jsonPost('/api/auth/login', { email, password: 'wrong-password' })),
        { runtime }
      );
      return {
        status: response.status,
        body: await response.text(),
        cookie: response.headers.get('set-cookie'),
        derives: derive.mock.calls.length
      };
    };
    const unknown = await attempt('nobody@example.com');
    const wrong = await attempt('admin@example.com');
    expect(unknown).toEqual(wrong);
    expect(unknown).toEqual({
      status: 401,
      body: JSON.stringify({
        error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' }
      }),
      cookie: null,
      derives: 1
    });
  });
});

describe('host throttle hook (429 RATE_LIMITED)', () => {
  it('is optional: without it login behaves exactly as before', async () => {
    const { runtime } = await withAdmin();
    const response = await handleLogin(
      ctx(jsonPost('/api/auth/login', { email: 'admin@example.com', password: 'password123' })),
      { runtime }
    );
    expect(response.status).toBe(200);
  });

  it('is called once, before credential work, with the same arguments whether or not the account exists', async () => {
    const { runtime, auth, db } = await withAdmin();
    const { throttle, calls } = fakeThrottle(100);
    const order: string[] = [];
    const login = auth.login.bind(auth);
    vi.spyOn(auth, 'login').mockImplementation((email, password) => {
      order.push(`login:${calls.length}`);
      return login(email, password);
    });
    const findMany = vi.spyOn(db, 'findMany');

    const scenarios = [
      { email: ' Admin@Example.com ', password: 'password123', status: 200 }, // known, correct
      { email: 'admin@example.com', password: 'wrong-password', status: 401 }, // known, wrong
      { email: 'NOBODY@example.com', password: 'password123', status: 401 }, // unknown
      { email: 'nobody2@example.com', password: 'wrong-password', status: 401 } // unknown
    ];
    for (const [index, scenario] of scenarios.entries()) {
      const lookupsBefore = findMany.mock.calls.length;
      const response = await handleLogin(
        ctx(jsonPost('/api/auth/login', { email: scenario.email, password: scenario.password })),
        { runtime, throttle }
      );
      expect(response.status).toBe(scenario.status);
      expect(calls).toHaveLength(index + 1);
      // The throttle had already run when the adapter was entered.
      expect(order[index]).toBe(`login:${index + 1}`);
      expect(findMany.mock.calls.length).toBeGreaterThan(lookupsBefore);
    }
    expect(calls.map((c) => [c.action, c.identifier])).toEqual([
      ['login', 'admin@example.com'],
      ['login', 'admin@example.com'],
      ['login', 'nobody@example.com'],
      ['login', 'nobody2@example.com']
    ]);
    expect(calls.every((c) => c.request instanceof Request)).toBe(true);
  });

  it('a denial is 429 with a generic body, and no lookup, PBKDF2 or adapter call happens', async () => {
    const { runtime, auth, db } = await withAdmin();
    const { throttle } = fakeThrottle(0);
    const login = vi.spyOn(auth, 'login');
    const findMany = vi.spyOn(db, 'findMany');
    const derive = vi.spyOn(crypto.subtle, 'deriveBits');

    const bodies = new Set<string>();
    for (const email of ['admin@example.com', 'nobody@example.com']) {
      const response = await handleLogin(
        ctx(jsonPost('/api/auth/login', { email, password: 'password123' })),
        { runtime, throttle }
      );
      expect(response.status).toBe(429);
      expect(response.headers.get('retry-after')).toBeNull();
      expect(response.headers.get('set-cookie')).toBeNull();
      bodies.add(await response.text());
    }
    // Existing and unknown accounts are indistinguishable when throttled.
    expect([...bodies]).toEqual([
      JSON.stringify({
        error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts' }
      })
    ]);
    expect(login).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
    expect(derive).not.toHaveBeenCalled();
  });

  it('Retry-After is emitted only for a finite positive value, rounded up and clamped to one day', async () => {
    const { runtime } = await withAdmin();
    const cases: [unknown, string | null][] = [
      [30, '30'],
      [1.2, '2'],
      [10 * 24 * 60 * 60, '86400'],
      [0, null],
      [-5, null],
      [Number.NaN, null],
      [Number.POSITIVE_INFINITY, null],
      ['60', null],
      [undefined, null]
    ];
    for (const [retryAfterSeconds, expected] of cases) {
      const throttle = () => ({ allowed: false, retryAfterSeconds }) as AuthAttemptDecision;
      const response = await handleLogin(
        ctx(jsonPost('/api/auth/login', { email: 'a@example.com', password: 'password123' })),
        { runtime, throttle }
      );
      expect(response.status).toBe(429);
      expect(response.headers.get('retry-after'), String(retryAfterSeconds)).toBe(expected);
    }
  });

  it('fails closed: a throwing throttle or a malformed decision is a 500 with no auth work and a redacted log', async () => {
    const { runtime, auth } = await withAdmin();
    const login = vi.spyOn(auth, 'login');
    const logged: unknown[][] = [];
    setLogger({ error: (...args: unknown[]) => logged.push(args) });
    const throttles: AuthAttemptThrottle[] = [
      () => {
        throw new Error('limiter backend down; key=admin@example.com password=hunter2-SECRET');
      },
      () => undefined as unknown as AuthAttemptDecision,
      () => ({ allowed: 'yes' }) as unknown as AuthAttemptDecision
    ];
    for (const throttle of throttles) {
      const response = await handleLogin(
        ctx(
          jsonPost('/api/auth/login', { email: 'admin@example.com', password: 'hunter2-SECRET' })
        ),
        { runtime, throttle }
      );
      expect(response.status).toBe(500);
      expect((await errorOf(response)).code).toBe('INTERNAL_ERROR');
    }
    expect(login).not.toHaveBeenCalled();
    expect(JSON.stringify(logged)).not.toContain('hunter2-SECRET');
    expect(JSON.stringify(logged)).not.toContain('admin@example.com');
  });

  it('signup: throttled before hashing, and a disabled signup is 404 without reading the body or throttling', async () => {
    const { runtime, auth } = await withAdmin();
    const { throttle, calls } = fakeThrottle(1);
    const signup = vi.spyOn(auth, 'signup');
    const derive = vi.spyOn(crypto.subtle, 'deriveBits');

    const disabledStream = countingStream(1024 * 1024);
    const disabled = await handleSignup(ctx(post('/api/auth/signup', disabledStream.stream)), {
      runtime,
      enabled: false,
      throttle
    });
    expect(disabled.status).toBe(404);
    expect(disabledStream.state.pulled).toBe(0);
    expect(calls).toHaveLength(0);

    const first = await handleSignup(
      ctx(jsonPost('/api/auth/signup', { email: 'v1@example.com', password: 'password123' })),
      { runtime, enabled: true, throttle }
    );
    expect(first.status).toBe(201);
    derive.mockClear();
    signup.mockClear();

    const second = await handleSignup(
      ctx(jsonPost('/api/auth/signup', { email: 'V1@example.com', password: 'password123' })),
      { runtime, enabled: true, throttle }
    );
    expect(second.status).toBe(429);
    expect(calls.map((c) => [c.action, c.identifier])).toEqual([
      ['signup', 'v1@example.com'],
      ['signup', 'v1@example.com']
    ]);
    expect(signup).not.toHaveBeenCalled();
    expect(derive).not.toHaveBeenCalled();
  });

  it('is never consulted by logout, me or authenticated content requests (machine auth included)', async () => {
    const db = new InMemoryDatabaseAdapter();
    const users = new UsersCollectionAuthAdapter({ devMode: true });
    const keys = new ApiKeyAuthAdapter();
    const auth = new CompositeAuthAdapter([users, keys]);
    const runtime = new ForgeCmsRuntime({
      collections: [
        defineUsersCollection(),
        defineCollection({
          slug: 'notes',
          fields: { title: defineField.text({ required: true }) },
          access: { create: ({ user }) => user !== null }
        })
      ],
      adapters: { database: db, auth, storage: new InMemoryStorageAdapter() },
      env: { userDatabase: db, apiKeyDatabase: db }
    });
    runtime.init();
    await runtime.syncSchema();
    const { secret } = await keys.createApiKey({ name: 'ci', scopes: ['notes:write'] });
    const throttle = vi.fn(() => ({ allowed: false }) as const);

    for (let i = 0; i < 5; i++) {
      const created = await handleCreate(
        ctx(jsonPost('/api/v1/notes', { title: `n${i}` }, { authorization: `Bearer ${secret}` }), {
          collection: 'notes'
        }),
        { runtime }
      );
      expect(created.status).toBe(201);
    }
    const me = await handleMe(
      ctx(
        new Request('https://forge.test/api/auth/me', {
          headers: { authorization: `Bearer ${secret}` }
        })
      ),
      { runtime, throttle }
    );
    expect(me.status).toBe(200);
    const logout = await handleLogout(ctx(post('/api/auth/logout', null)), { runtime, throttle });
    expect(logout.status).toBe(204);
    expect(throttle).not.toHaveBeenCalled();
  });
});

describe('redacted auth logging', () => {
  const SECRETS = ['hunter2-SECRET', 'Bearer-SECRET-token', 'cookie-SECRET', 'forge_apikey-SECRET'];

  function captureLogs() {
    const logged: unknown[][] = [];
    setLogger({ error: (...args: unknown[]) => logged.push(args) });
    // Serialize Errors by every own property, so a leaked message/cause/stack would be caught.
    return () =>
      JSON.stringify(logged, (_key, value: unknown) =>
        value instanceof Error
          ? { name: value.name, message: value.message, stack: value.stack, cause: value.cause }
          : value
      );
  }

  it('expected failures (401/400/409/413/429/404/403) log nothing', async () => {
    const { runtime } = await withAdmin();
    const serialized = captureLogs();
    await handleLogin(
      ctx(jsonPost('/api/auth/login', { email: 'admin@example.com', password: 'nope-nope' })),
      { runtime }
    );
    await handleLogin(ctx(post('/api/auth/login', '{bad')), { runtime });
    await handleLogin(ctx(post('/api/auth/login', loginBodyOfSize(9000))), { runtime });
    await handleLogin(
      ctx(jsonPost('/api/auth/login', { email: 'a@b.co', password: 'password123' })),
      {
        runtime,
        throttle: () => ({ allowed: false })
      }
    );
    await handleSignup(
      ctx(jsonPost('/api/auth/signup', { email: 'admin@example.com', password: 'password123' })),
      { runtime, enabled: true }
    );
    await handleSignup(
      ctx(jsonPost('/api/auth/signup', { email: 'w@example.com', password: 'short' })),
      { runtime, enabled: true }
    );
    await handleSignup(ctx(post('/api/auth/signup', '{}')), { runtime, enabled: false });
    await handleMe(
      ctx(
        new Request('https://forge.test/api/auth/me', {
          headers: { authorization: 'Bearer expired.token' }
        })
      ),
      { runtime }
    );
    await handleLogout(
      ctx(
        post('/api/auth/logout', null, { cookie: 'forge_session=x', origin: 'https://evil.test' })
      ),
      { runtime }
    );
    expect(serialized()).toBe('[]');
  });

  it('an unexpected login/signup/me failure logs only the operation and error class, never credentials', async () => {
    const { runtime, auth } = await withAdmin();
    const serialized = captureLogs();
    const leaky = () =>
      Object.assign(new TypeError(`driver: ${SECRETS.join(' ')}`), { cause: SECRETS.join(' ') });
    vi.spyOn(auth, 'login').mockRejectedValue(leaky());
    vi.spyOn(auth, 'signup').mockRejectedValue(leaky());
    vi.spyOn(auth, 'requireAuth').mockRejectedValue(leaky());

    const login = await handleLogin(
      ctx(jsonPost('/api/auth/login', { email: 'admin@example.com', password: 'hunter2-SECRET' })),
      { runtime }
    );
    const signup = await handleSignup(
      ctx(jsonPost('/api/auth/signup', { email: 'x@example.com', password: 'hunter2-SECRET' })),
      { runtime, enabled: true }
    );
    const me = await handleMe(
      ctx(
        new Request('https://forge.test/api/auth/me', {
          headers: {
            authorization: 'Bearer Bearer-SECRET-token',
            cookie: 'forge_session=cookie-SECRET'
          }
        })
      ),
      { runtime }
    );
    for (const response of [login, signup, me]) {
      expect(response.status).toBe(500);
      expect(await response.text()).not.toMatch(/SECRET/);
    }
    const text = serialized();
    for (const secret of SECRETS) expect(text).not.toContain(secret);
    expect(JSON.parse(text)).toEqual([
      ['Unexpected error in auth handler', { operation: 'login', error: 'TypeError' }],
      ['Unexpected error in auth handler', { operation: 'signup', error: 'TypeError' }],
      ['Unexpected error in auth handler', { operation: 'me', error: 'TypeError' }]
    ]);
  });

  it('an unexpected auth-adapter failure behind a content route is a 500 whose log carries no credential', async () => {
    const { runtime, auth } = await withAdmin();
    const serialized = captureLogs();
    vi.spyOn(auth, 'requireAuth').mockRejectedValue(new Error(`lookup failed for ${SECRETS[3]}`));
    const response = await handleList(
      ctx(
        new Request('https://forge.test/api/v1/notes', {
          headers: { authorization: `Bearer ${SECRETS[3]}` }
        }),
        { collection: 'notes' }
      ),
      { runtime, requireAuth: true }
    );
    expect(response.status).toBe(500);
    const text = serialized();
    expect(text).not.toContain(SECRETS[3]);
    expect(text).toContain('AuthResolutionError');
  });
});

describe('CSRF certification with credential-size cases (spec 053 semantics unchanged)', () => {
  async function viewerSession() {
    const { runtime } = await withAdmin();
    const signup = await handleSignup(
      ctx(jsonPost('/api/auth/signup', { email: 'viewer@example.com', password: 'password123' })),
      { runtime, enabled: true }
    );
    const token = /forge_session=([^;]+)/.exec(signup.headers.get('set-cookie') ?? '')?.[1] ?? '';
    const note = await runtime.create({ collection: 'notes', data: { title: 'A note' } });
    return { runtime, token, noteId: note.id as string };
  }

  function patchNote(runtime: ForgeCmsRuntime, noteId: string, headers: Record<string, string>) {
    return handleUpdate(
      ctx(
        new Request(`https://forge.test/api/v1/notes/${noteId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ title: 'changed' })
        }),
        { collection: 'notes', id: noteId }
      ),
      { runtime }
    );
  }

  it('a malformed Authorization header does not hide the cookie credential from CSRF', async () => {
    const { runtime, token, noteId } = await viewerSession();
    for (const authorization of ['Basic abc', 'Bearer', 'Bearer    ', 'token abc']) {
      const response = await patchNote(runtime, noteId, {
        authorization,
        cookie: `forge_session=${token}`,
        origin: 'https://evil.test'
      });
      expect(response.status, authorization).toBe(403);
      expect((await errorOf(response)).code).toBe('FORBIDDEN');
    }
    expect(await runtime.findByID({ collection: 'notes', id: noteId })).toMatchObject({
      title: 'A note'
    });
  });

  it('an oversized Bearer keeps precedence over the cookie: no CSRF gate, and the cookie is not used (401)', async () => {
    const { runtime, token, noteId } = await viewerSession();
    const response = await patchNote(runtime, noteId, {
      authorization: `Bearer ${'a'.repeat(9000)}.b`,
      cookie: `forge_session=${token}`,
      origin: 'https://evil.test'
    });
    expect(response.status).toBe(401);
    expect(await runtime.findByID({ collection: 'notes', id: noteId })).toMatchObject({
      title: 'A note'
    });
  });

  it('cookie + same-origin still mutates; cookie + cross-site logout is 403', async () => {
    const { runtime, token, noteId } = await viewerSession();
    const same = await patchNote(runtime, noteId, {
      cookie: `forge_session=${token}`,
      origin: 'https://forge.test'
    });
    expect(same.status).toBe(200);
    const logout = await handleLogout(
      ctx(
        post('/api/auth/logout', null, {
          cookie: `forge_session=${token}`,
          referer: 'https://evil.test/page'
        })
      ),
      { runtime }
    );
    expect(logout.status).toBe(403);
  });
});

describe('public signup cannot set privileged or internal fields', () => {
  it('with an admin present, a signup smuggling role/roles/_sessionVersion/passwordHash/id becomes a plain viewer', async () => {
    const { runtime, db } = await withAdmin();
    const response = await handleSignup(
      ctx(
        jsonPost('/api/auth/signup', {
          email: 'attacker@example.com',
          password: 'attacker-password',
          name: 'Mallory',
          role: 'admin',
          roles: ['admin'],
          _sessionVersion: 999,
          passwordHash: 'If6Zrfe0K5ZTX4epnsGKhynqsYCtSnGguaNkxiFer_SRG6SLXF5NOPToEpHbPR5J',
          id: 'chosen-id',
          scopes: ['*']
        })
      ),
      { runtime, enabled: true }
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      data: { user: Record<string, unknown>; token: string };
    };
    expect(body.data.user.role).toBe('viewer');
    expect(body.data.user).not.toHaveProperty('roles');
    expect(body.data.user).not.toHaveProperty('scopes');
    expect(body.data.user).not.toHaveProperty('passwordHash');
    expect(body.data.user.id).not.toBe('chosen-id');

    const [row] = await db.findMany({
      collection: 'users',
      where: { email: 'attacker@example.com' }
    });
    expect(row?.role).toBe('viewer');
    expect(row?._sessionVersion ?? 0).toBe(0);
    expect(row?.roles).toBeUndefined();
    expect(row?.passwordHash).not.toBe(
      'If6Zrfe0K5ZTX4epnsGKhynqsYCtSnGguaNkxiFer_SRG6SLXF5NOPToEpHbPR5J'
    );
    // The account's password is the submitted one, and its token is live.
    const auth = runtime.adapters.auth as UsersCollectionAuthAdapter;
    expect((await auth.login('attacker@example.com', 'attacker-password')).ok).toBe(true);
    expect((await auth.validateSession(body.data.token))?.user.role).toBe('viewer');
  });
});
