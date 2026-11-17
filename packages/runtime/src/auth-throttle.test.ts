/**
 * Spec 106 (V2-01): the certified login/signup throttles. `DatabaseAuthThrottle` is exercised on every
 * database adapter in this package (InMemory, libSQL; D1 in `@forge-cms/cloudflare`'s workers suite), the
 * binding adapter against a fake binding. Windows are moved with fake system time, never real sleeps.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UsersCollectionAuthAdapter, defineUsersCollection } from '@forge-cms/auth';
import type { ApiContext } from '@forge-cms/api';
import { InMemoryDatabaseAdapter, LibSqlDatabaseAdapter } from '@forge-cms/db';
import type { DatabaseAdapter } from '@forge-cms/db';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { handleLogin, handleSignup } from './auth-handlers.js';
import type { AuthAttempt } from './auth-handlers.js';
import { DatabaseAuthThrottle, rateLimitBindingAuthThrottle } from './auth-throttle.js';
import type { RateLimitBinding } from './auth-throttle.js';
import { ForgeCmsRuntime } from './runtime.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const databases: [string, () => DatabaseAdapter][] = [
  ['InMemory', () => new InMemoryDatabaseAdapter()],
  ['libSQL', () => new LibSqlDatabaseAdapter(':memory:').init()]
];

function attempt(
  action: AuthAttempt['action'],
  identifier: string,
  client = '203.0.113.7'
): AuthAttempt {
  return {
    action,
    identifier,
    request: new Request('https://forge.test/api/auth/login', {
      method: 'POST',
      headers: { 'x-client': client }
    })
  };
}

const clientKey = (request: Request) => request.headers.get('x-client') ?? 'unknown';

async function limiter(
  database: DatabaseAdapter,
  limits: ConstructorParameters<typeof DatabaseAuthThrottle>[0]['limits'] = {}
) {
  const throttle = new DatabaseAuthThrottle({ database, clientKey, limits });
  await throttle.syncSchema();
  return throttle;
}

describe('configuration', () => {
  it('requires a client key and valid budgets', () => {
    const database = new InMemoryDatabaseAdapter();
    expect(
      () =>
        new DatabaseAuthThrottle({
          database,
          clientKey: 'cf-connecting-ip' as unknown as (r: Request) => string
        })
    ).toThrow(/clientKey/);
    for (const bad of [0, 1.5, -1]) {
      expect(
        () =>
          new DatabaseAuthThrottle({
            database,
            clientKey,
            limits: { loginClient: { limit: bad, windowSeconds: 60 } }
          })
      ).toThrow(/loginClient\.limit/);
    }
    expect(
      () =>
        new DatabaseAuthThrottle({
          database,
          clientKey,
          limits: { signupClient: { limit: 5, windowSeconds: 0 } }
        })
    ).toThrow(/signupClient\.windowSeconds/);
  });
});

describe.each(databases)('DatabaseAuthThrottle on %s', (_name, createDb) => {
  it('allows the per-client login budget, then refuses with a Retry-After inside the window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-17T10:00:05Z'));
    const t = await limiter(createDb(), { loginClient: { limit: 3, windowSeconds: 60 } });

    for (let i = 0; i < 3; i += 1) {
      expect(await t.throttle(attempt('login', `user${i}@example.com`))).toEqual({ allowed: true });
    }
    expect(await t.throttle(attempt('login', 'user9@example.com'))).toEqual({
      allowed: false,
      retryAfterSeconds: 55
    });
    // Another client is unaffected.
    expect(await t.throttle(attempt('login', 'user9@example.com', '198.51.100.1'))).toEqual({
      allowed: true
    });
  });

  it('a new window starts a new budget', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-17T10:00:00Z'));
    const t = await limiter(createDb(), { loginClient: { limit: 1, windowSeconds: 60 } });
    expect((await t.throttle(attempt('login', 'a@example.com'))).allowed).toBe(true);
    expect((await t.throttle(attempt('login', 'a@example.com'))).allowed).toBe(false);
    vi.setSystemTime(new Date('2026-11-17T10:01:00Z'));
    expect((await t.throttle(attempt('login', 'a@example.com'))).allowed).toBe(true);
  });

  it('login is also limited per account, across clients; signup only per client', async () => {
    const t = await limiter(createDb(), {
      loginClient: { limit: 100, windowSeconds: 60 },
      loginAccount: { limit: 2, windowSeconds: 60 },
      signupClient: { limit: 2, windowSeconds: 60 }
    });
    expect((await t.throttle(attempt('login', 'victim@example.com', '10.0.0.1'))).allowed).toBe(
      true
    );
    expect((await t.throttle(attempt('login', 'victim@example.com', '10.0.0.2'))).allowed).toBe(
      true
    );
    expect((await t.throttle(attempt('login', 'victim@example.com', '10.0.0.3'))).allowed).toBe(
      false
    );
    expect((await t.throttle(attempt('login', 'other@example.com', '10.0.0.3'))).allowed).toBe(
      true
    );

    // Signup keys are separate from login keys and ignore the email.
    expect((await t.throttle(attempt('signup', 'x1@example.com', '10.0.0.9'))).allowed).toBe(true);
    expect((await t.throttle(attempt('signup', 'x2@example.com', '10.0.0.9'))).allowed).toBe(true);
    expect((await t.throttle(attempt('signup', 'x3@example.com', '10.0.0.9'))).allowed).toBe(false);
  });

  it('concurrent attempts never exceed the budget (compare-and-set increments)', async () => {
    const t = await limiter(createDb(), { signupClient: { limit: 5, windowSeconds: 60 } });
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => t.throttle(attempt('signup', `c${i}@example.com`)))
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });

  it('stores no email or client address, only digests', async () => {
    const db = createDb();
    const t = await limiter(db);
    await t.throttle(attempt('login', 'secret.person@example.com', '192.0.2.44'));
    const rows = await db.findMany({ collection: '_forge_auth_throttle' });
    expect(rows).toHaveLength(2);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain('secret.person');
    expect(dump).not.toContain('192.0.2.44');
    for (const row of rows) expect(String(row.id)).toMatch(/^t1_[0-9a-f]{64}$/);
  });

  it('prune deletes only expired windows', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-17T10:00:00Z'));
    const db = createDb();
    const t = await limiter(db, { signupClient: { limit: 5, windowSeconds: 60 } });
    await t.throttle(attempt('signup', 'a@example.com', '10.0.0.1'));
    vi.setSystemTime(new Date('2026-11-17T10:05:00Z'));
    await t.throttle(attempt('signup', 'a@example.com', '10.0.0.2'));
    expect(await t.prune()).toBe(1);
    expect(await db.findMany({ collection: '_forge_auth_throttle' })).toHaveLength(1);
  });

  it('syncSchema is idempotent and planSchema reports no drift afterwards', async () => {
    const db = createDb();
    const t = await limiter(db);
    await t.syncSchema();
    const plan = await t.planSchema();
    expect(plan.blocking).toBe(false);
    expect(plan.changes).toEqual([]);
  });
});

describe('forClient: the route supplies the client address', () => {
  it('keys by the given client, and the plain throttle fails closed without a clientKey', async () => {
    const database = new InMemoryDatabaseAdapter();
    const t = new DatabaseAuthThrottle({
      database,
      limits: { loginClient: { limit: 1, windowSeconds: 60 } }
    });
    await t.syncSchema();
    expect((await t.forClient('10.1.1.1')(attempt('login', 'a@example.com'))).allowed).toBe(true);
    expect((await t.forClient('10.1.1.1')(attempt('login', 'b@example.com'))).allowed).toBe(false);
    expect((await t.forClient('10.1.1.2')(attempt('login', 'b@example.com'))).allowed).toBe(true);
    expect(() => t.throttle(attempt('login', 'a@example.com'))).toThrow(/forClient/);
  });
});

describe('wired into handleLogin / handleSignup', () => {
  async function runtimeWith(db: DatabaseAdapter) {
    const runtime = new ForgeCmsRuntime({
      collections: [defineUsersCollection()],
      adapters: {
        database: db,
        auth: new UsersCollectionAuthAdapter({ devMode: true }),
        storage: new InMemoryStorageAdapter()
      },
      env: { userDatabase: db }
    });
    runtime.init();
    await runtime.syncSchema();
    return runtime;
  }
  const ctx = (body: unknown): ApiContext<unknown> => ({
    request: new Request('https://forge.test/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-client': '203.0.113.9' },
      body: JSON.stringify(body)
    }),
    env: {}
  });

  it('refuses with 429 RATE_LIMITED + Retry-After before any password work, on InMemory', async () => {
    const db = new InMemoryDatabaseAdapter();
    const runtime = await runtimeWith(db);
    const t = await limiter(db, { loginClient: { limit: 2, windowSeconds: 60 } });
    const login = () =>
      handleLogin(ctx({ email: 'nobody@example.com', password: 'wrong-password' }), {
        runtime,
        throttle: t.throttle
      });
    expect((await login()).status).toBe(401);
    expect((await login()).status).toBe(401);
    const derive = vi.spyOn(crypto.subtle, 'deriveBits');
    const refused = await login();
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await refused.json()).toEqual({
      error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts' }
    });
    expect(derive).not.toHaveBeenCalled();
  });

  it('signup is throttled per client', async () => {
    const db = new InMemoryDatabaseAdapter();
    const runtime = await runtimeWith(db);
    const t = await limiter(db, { signupClient: { limit: 1, windowSeconds: 60 } });
    const signup = (email: string) =>
      handleSignup(ctx({ email, password: 'password123' }), {
        runtime,
        enabled: true,
        throttle: t.throttle
      });
    expect((await signup('one@example.com')).status).toBe(201);
    expect((await signup('two@example.com')).status).toBe(429);
  });
});

describe('rateLimitBindingAuthThrottle (Cloudflare Rate Limiting bindings)', () => {
  function binding(allow: (key: string) => boolean) {
    const keys: string[] = [];
    const limiter: RateLimitBinding = {
      limit: ({ key }) => {
        keys.push(key);
        return Promise.resolve({ success: allow(key) });
      }
    };
    return { limiter, keys };
  }

  it('checks client and account for login, client only for signup, with the documented keys', async () => {
    const client = binding(() => true);
    const account = binding(() => true);
    const throttle = rateLimitBindingAuthThrottle({
      client: client.limiter,
      account: account.limiter,
      clientKey
    });
    expect(await throttle(attempt('login', 'a@example.com'))).toEqual({ allowed: true });
    expect(await throttle(attempt('signup', 'b@example.com'))).toEqual({ allowed: true });
    expect(client.keys).toEqual(['login:client:203.0.113.7', 'signup:client:203.0.113.7']);
    expect(account.keys).toEqual(['login:account:a@example.com']);
  });

  it('refuses when either budget is spent, with the configured Retry-After', async () => {
    const throttle = rateLimitBindingAuthThrottle({
      client: binding(() => true).limiter,
      account: binding(() => false).limiter,
      clientKey,
      retryAfterSeconds: 10
    });
    expect(await throttle(attempt('login', 'a@example.com'))).toEqual({
      allowed: false,
      retryAfterSeconds: 10
    });
  });
});
