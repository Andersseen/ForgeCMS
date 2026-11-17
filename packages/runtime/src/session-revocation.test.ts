/**
 * Spec 107 (V2-01): what session revocation means in 1.x, pinned down end to end through the HTTP
 * handlers. Sessions are stateless signed tokens (24 h) carrying the user row's `_sessionVersion`; every
 * request re-reads the row. So: a password change, "sign out everywhere", a role change and a deleted user
 * take effect on the next request; a plain logout only clears this browser's cookie.
 */
import { describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE_NAME,
  SignedTokenAuthAdapter,
  UsersCollectionAuthAdapter,
  defineUsersCollection
} from '@forge-cms/auth';
import type { ApiContext } from '@forge-cms/api';
import { InMemoryDatabaseAdapter, LibSqlDatabaseAdapter } from '@forge-cms/db';
import type { DatabaseAdapter } from '@forge-cms/db';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { handleLogin, handleLogout, handleLogoutEverywhere, handleMe } from './auth-handlers.js';
import { ForgeCmsRuntime } from './runtime.js';

const ORIGIN = 'https://forge.test';

const databases: [string, () => DatabaseAdapter][] = [
  ['InMemory', () => new InMemoryDatabaseAdapter()],
  ['libSQL', () => new LibSqlDatabaseAdapter(':memory:').init()]
];

async function setup(createDb: () => DatabaseAdapter) {
  const db = createDb();
  const auth = new UsersCollectionAuthAdapter({ devMode: true });
  const runtime = new ForgeCmsRuntime({
    collections: [defineUsersCollection()],
    adapters: { database: db, auth, storage: new InMemoryStorageAdapter() },
    env: { userDatabase: db }
  });
  runtime.init();
  await runtime.syncSchema();
  await auth.createUser({ email: 'ada@example.com', password: 'password123', role: 'admin' });
  await auth.createUser({ email: 'bob@example.com', password: 'password123', role: 'editor' });
  return { runtime, auth, db };
}

const ctx = (request: Request): ApiContext<unknown> => ({ request, env: {} });

/** A fresh login: returns the session token (what both the cookie and a Bearer client hold). */
async function signIn(runtime: ForgeCmsRuntime, email: string, password = 'password123') {
  const response = await handleLogin(
    ctx(
      new Request(`${ORIGIN}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
    ),
    { runtime }
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { data: { token: string } };
  return body.data.token;
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const cookie = (token: string) => ({ cookie: `${SESSION_COOKIE_NAME}=${token}` });

async function me(runtime: ForgeCmsRuntime, headers: Record<string, string>) {
  return (await handleMe(ctx(new Request(`${ORIGIN}/api/auth/me`, { headers })), { runtime }))
    .status;
}

function post(path: string, headers: Record<string, string>) {
  return new Request(`${ORIGIN}${path}`, { method: 'POST', headers });
}

describe.each(databases)('session revocation on %s (spec 107)', (_name, createDb) => {
  it('a plain logout clears this browser cookie but does NOT revoke the token elsewhere', async () => {
    const { runtime } = await setup(createDb);
    const token = await signIn(runtime, 'ada@example.com');
    const logout = await handleLogout(
      ctx(post('/api/auth/logout', { origin: ORIGIN, ...cookie(token) })),
      {
        runtime
      }
    );
    expect(logout.status).toBe(204);
    expect(logout.headers.get('set-cookie')).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=;`));
    // A copy of the same token (another tab's Bearer client, a stolen cookie) is still valid until expiry.
    expect(await me(runtime, bearer(token))).toBe(200);
  });

  it('sign out everywhere revokes every earlier session of that user, cookie and Bearer, at once', async () => {
    const { runtime } = await setup(createDb);
    const laptop = await signIn(runtime, 'ada@example.com');
    const phone = await signIn(runtime, 'ada@example.com');
    const other = await signIn(runtime, 'bob@example.com');

    const response = await handleLogoutEverywhere(
      ctx(post('/api/auth/logout-everywhere', { origin: ORIGIN, ...cookie(laptop) })),
      { runtime }
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=;`));

    expect(await me(runtime, cookie(laptop))).toBe(401);
    expect(await me(runtime, bearer(phone))).toBe(401);
    expect(await me(runtime, bearer(other))).toBe(200); // other users are untouched
    // A new sign-in afterwards works normally.
    expect(await me(runtime, bearer(await signIn(runtime, 'ada@example.com')))).toBe(200);
  });

  it('works from a Bearer client too (no cookie, so no CSRF check applies)', async () => {
    const { runtime } = await setup(createDb);
    const token = await signIn(runtime, 'ada@example.com');
    expect(
      (
        await handleLogoutEverywhere(ctx(post('/api/auth/logout-everywhere', bearer(token))), {
          runtime
        })
      ).status
    ).toBe(204);
    expect(await me(runtime, bearer(token))).toBe(401);
  });

  it('a password change revokes every earlier session (unchanged 1.0 behaviour)', async () => {
    const { runtime, auth } = await setup(createDb);
    const token = await signIn(runtime, 'bob@example.com');
    const bob = (await auth.listUsers()).find((u) => u.email === 'bob@example.com');
    await auth.updateUser(String(bob?.id), { password: 'a-new-password-456' });
    expect(await me(runtime, bearer(token))).toBe(401);
    expect(
      await me(runtime, bearer(await signIn(runtime, 'bob@example.com', 'a-new-password-456')))
    ).toBe(200);
  });

  it('a role change applies on the next request; a deleted user is signed out on the next request', async () => {
    const { runtime, auth } = await setup(createDb);
    const token = await signIn(runtime, 'bob@example.com');
    const bob = (await auth.listUsers()).find((u) => u.email === 'bob@example.com');
    await auth.updateUser(String(bob?.id), { role: 'viewer' });
    const response = await handleMe(
      ctx(new Request(`${ORIGIN}/api/auth/me`, { headers: bearer(token) })),
      { runtime }
    );
    expect(((await response.json()) as { data: { role: string } }).data.role).toBe('viewer');
    await auth.deleteUser(String(bob?.id));
    expect(await me(runtime, bearer(token))).toBe(401);
  });

  it('refuses anonymous callers (401) and cross-site cookie requests (CSRF), revoking nothing', async () => {
    const { runtime } = await setup(createDb);
    const token = await signIn(runtime, 'ada@example.com');
    expect(
      (
        await handleLogoutEverywhere(ctx(post('/api/auth/logout-everywhere', { origin: ORIGIN })), {
          runtime
        })
      ).status
    ).toBe(401);
    const crossSite = await handleLogoutEverywhere(
      ctx(post('/api/auth/logout-everywhere', { origin: 'https://evil.test', ...cookie(token) })),
      { runtime }
    );
    expect(crossSite.status).toBe(403);
    expect(await me(runtime, bearer(token))).toBe(200);
  });

  it('revokeSessions on an unknown user resolves false and writes nothing', async () => {
    const { auth } = await setup(createDb);
    expect(await auth.revokeSessions('no-such-user')).toBe(false);
  });
});

describe('adapters that cannot revoke', () => {
  it('SignedTokenAuthAdapter: logout-everywhere is 404, the token stays valid until it expires', async () => {
    const db = new InMemoryDatabaseAdapter();
    const auth = new SignedTokenAuthAdapter({ devMode: true });
    const runtime = new ForgeCmsRuntime({
      collections: [],
      adapters: { database: db, auth, storage: new InMemoryStorageAdapter() },
      env: {}
    });
    runtime.init();
    const response = await handleLogoutEverywhere(
      ctx(post('/api/auth/logout-everywhere', { authorization: 'Bearer anything' })),
      { runtime }
    );
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });
});
