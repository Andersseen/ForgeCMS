import { describe, expect, it } from 'vitest';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { UsersCollectionAuthAdapter, defineUsersCollection } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import type { ApiContext } from '@forge-cms/api';
import { ForgeCmsRuntime } from './runtime.js';
import { handleLogin, handleLogout, handleMe, handleSignup } from './auth-handlers.js';
import { handleUpdate } from './handlers.js';

async function buildRuntime() {
  const db = new InMemoryDatabaseAdapter();
  const auth = new UsersCollectionAuthAdapter({ devMode: true });
  const runtime = new ForgeCmsRuntime({
    collections: [defineUsersCollection()],
    adapters: { database: db, auth, storage: new InMemoryStorageAdapter() },
    env: { userDatabase: db }
  });
  runtime.init();
  await runtime.syncSchema();
  return runtime;
}

function contextFor(request: Request, params?: Record<string, string>): ApiContext<unknown> {
  return { request, env: {}, ...(params !== undefined && { params }) };
}

function setCookieHeader(response: Response): string | null {
  return response.headers.get('set-cookie');
}

function extractCookieToken(setCookie: string): string {
  const match = /forge_session=([^;]+)/.exec(setCookie);
  return match?.[1] ?? '';
}

async function jsonOf<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe('browser auth foundation: handleLogin/handleSignup/handleLogout/handleMe', () => {
  it('handleLogin sets a session cookie and returns the token in the body (Bearer compatibility)', async () => {
    const runtime = await buildRuntime();
    const auth = runtime.adapters.auth as UsersCollectionAuthAdapter;
    await auth.signup({ email: 'admin@example.com', password: 'password123' });

    const response = await handleLogin(
      contextFor(
        new Request('https://forge.test/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: 'admin@example.com', password: 'password123' })
        })
      ),
      { runtime }
    );

    expect(response.status).toBe(200);
    const cookie = setCookieHeader(response);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');

    const body = await jsonOf<{ data: { user: { email: string }; token: string } }>(response);
    expect(body.data.user.email).toBe('admin@example.com');
    expect(typeof body.data.token).toBe('string');
  });

  it('handleLogin returns 401 for invalid credentials', async () => {
    const runtime = await buildRuntime();
    const response = await handleLogin(
      contextFor(
        new Request('https://forge.test/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: 'nobody@example.com', password: 'password123' })
        })
      ),
      { runtime }
    );
    expect(response.status).toBe(401);
  });

  it('handleLogin returns 400 for a missing field', async () => {
    const runtime = await buildRuntime();
    const response = await handleLogin(
      contextFor(
        new Request('https://forge.test/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: 'admin@example.com' })
        })
      ),
      { runtime }
    );
    expect(response.status).toBe(400);
  });

  it('handleMe resolves the user from the cookie set by handleLogin, with no Authorization header', async () => {
    const runtime = await buildRuntime();
    const auth = runtime.adapters.auth as UsersCollectionAuthAdapter;
    await auth.signup({ email: 'admin@example.com', password: 'password123' });

    const login = await handleLogin(
      contextFor(
        new Request('https://forge.test/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: 'admin@example.com', password: 'password123' })
        })
      ),
      { runtime }
    );
    const token = extractCookieToken(setCookieHeader(login) ?? '');

    const me = await handleMe(
      contextFor(
        new Request('https://forge.test/api/auth/me', {
          headers: { cookie: `forge_session=${token}` }
        })
      ),
      { runtime }
    );
    expect(me.status).toBe(200);
    const body = await jsonOf<{ data: { email: string } }>(me);
    expect(body.data.email).toBe('admin@example.com');
  });

  it('handleMe returns 401 with no credential at all', async () => {
    const runtime = await buildRuntime();
    const response = await handleMe(contextFor(new Request('https://forge.test/api/auth/me')), {
      runtime
    });
    expect(response.status).toBe(401);
  });

  it('handleSignup is disabled by default (404) even if the adapter supports it', async () => {
    const runtime = await buildRuntime();
    const response = await handleSignup(
      contextFor(
        new Request('https://forge.test/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ email: 'a@example.com', password: 'password123' })
        })
      ),
      { runtime, enabled: false }
    );
    expect(response.status).toBe(404);
  });

  it('handleSignup, when enabled, creates the account, sets a cookie, and ignores a smuggled role', async () => {
    const runtime = await buildRuntime();
    const response = await handleSignup(
      contextFor(
        new Request('https://forge.test/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({
            email: 'first@example.com',
            password: 'password123',
            role: 'admin' // not a real field on the input type — must be silently ignored, not honored
          })
        })
      ),
      { runtime, enabled: true }
    );

    expect(response.status).toBe(201);
    expect(setCookieHeader(response)).toContain('HttpOnly');
    const body = await jsonOf<{ data: { user: { role: string } } }>(response);
    // First user ever → bootstrapped to admin regardless of the (ignored) smuggled `role` field.
    expect(body.data.user.role).toBe('admin');
  });

  it('handleSignup maps weak-password/invalid-email/email-in-use to distinct statuses', async () => {
    const runtime = await buildRuntime();

    const weak = await handleSignup(
      contextFor(
        new Request('https://forge.test/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ email: 'weak@example.com', password: 'short' })
        })
      ),
      { runtime, enabled: true }
    );
    expect(weak.status).toBe(400);

    const invalidEmail = await handleSignup(
      contextFor(
        new Request('https://forge.test/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ email: 'not-an-email', password: 'password123' })
        })
      ),
      { runtime, enabled: true }
    );
    expect(invalidEmail.status).toBe(400);

    await handleSignup(
      contextFor(
        new Request('https://forge.test/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ email: 'dup@example.com', password: 'password123' })
        })
      ),
      { runtime, enabled: true }
    );
    const dup = await handleSignup(
      contextFor(
        new Request('https://forge.test/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ email: 'dup@example.com', password: 'password456' })
        })
      ),
      { runtime, enabled: true }
    );
    expect(dup.status).toBe(409);
  });

  it('handleLogout clears the cookie and returns 204', async () => {
    const runtime = await buildRuntime();
    const response = await handleLogout(
      contextFor(new Request('https://forge.test/api/auth/logout', { method: 'POST' })),
      { runtime }
    );
    expect(response.status).toBe(204);
    const cookie = setCookieHeader(response);
    expect(cookie).toContain('Max-Age=0');
  });
});

describe('browser auth foundation: CSRF protection', () => {
  it('rejects a cross-site mutating request authenticated only by the session cookie', async () => {
    const runtime = await buildRuntime();
    const response = await handleLogout(
      contextFor(
        new Request('https://forge.test/api/auth/logout', {
          method: 'POST',
          headers: { cookie: 'forge_session=whatever', origin: 'https://evil.test' }
        })
      ),
      { runtime }
    );
    expect(response.status).toBe(403);
  });

  it('allows the identical request when Origin is same-site', async () => {
    const runtime = await buildRuntime();
    const response = await handleLogout(
      contextFor(
        new Request('https://forge.test/api/auth/logout', {
          method: 'POST',
          headers: { cookie: 'forge_session=whatever', origin: 'https://forge.test' }
        })
      ),
      { runtime }
    );
    expect(response.status).toBe(204);
  });

  it('is not applied to a request authenticated via Authorization: Bearer instead of the cookie', async () => {
    const runtime = await buildRuntime();
    // No cookie at all here — only a Bearer header — so CSRF's cookie-credential check never triggers,
    // regardless of Origin.
    const response = await handleLogout(
      contextFor(
        new Request('https://forge.test/api/auth/logout', {
          method: 'POST',
          headers: { authorization: 'Bearer some-token', origin: 'https://evil.test' }
        })
      ),
      { runtime }
    );
    expect(response.status).toBe(204);
  });

  it('rejects a cross-site cookie-only mutation against a collection with its own function-based access', async () => {
    // `defineUsersCollection()` declares its own `access.update` (a function), which makes the route
    // take the `resolveOptionalUser` branch in `resolveRequest` (no static `allowedRoles`/`requireAuth`
    // gate) rather than `authorize()`'s. CSRF must still apply there — this is the exact collection
    // shape this spec's own recommended helper produces.
    const runtime = await buildRuntime();
    const signup = await handleSignup(
      contextFor(
        new Request('https://forge.test/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ email: 'viewer@example.com', password: 'password123' })
        })
      ),
      { runtime, enabled: true }
    );
    const token = extractCookieToken(setCookieHeader(signup) ?? '');
    const viewerId = (await jsonOf<{ data: { user: { id: string } } }>(signup)).data.user.id;

    const response = await handleUpdate(
      contextFor(
        new Request(`https://forge.test/api/v1/users/${viewerId}`, {
          method: 'PATCH',
          headers: { cookie: `forge_session=${token}`, origin: 'https://evil.test' },
          body: JSON.stringify({ name: 'Cross-site write' })
        }),
        { collection: 'users', id: viewerId }
      ),
      { runtime }
    );
    expect(response.status).toBe(403);
  });

  it('allows the identical same-origin request against that same collection shape', async () => {
    const runtime = await buildRuntime();
    const signup = await handleSignup(
      contextFor(
        new Request('https://forge.test/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ email: 'same-site-viewer@example.com', password: 'password123' })
        })
      ),
      { runtime, enabled: true }
    );
    const token = extractCookieToken(setCookieHeader(signup) ?? '');
    const viewerId = (await jsonOf<{ data: { user: { id: string } } }>(signup)).data.user.id;

    const response = await handleUpdate(
      contextFor(
        new Request(`https://forge.test/api/v1/users/${viewerId}`, {
          method: 'PATCH',
          headers: { cookie: `forge_session=${token}`, origin: 'https://forge.test' },
          body: JSON.stringify({ name: 'Same-site write' })
        }),
        { collection: 'users', id: viewerId }
      ),
      { runtime }
    );
    expect(response.status).toBe(200);
  });
});

describe('defineUsersCollection(): role escalation cannot happen through the generic update route', () => {
  it('a non-admin cannot write their own role, but can update their own name', async () => {
    const runtime = await buildRuntime();
    const signup = await handleSignup(
      contextFor(
        new Request('https://forge.test/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ email: 'plain-viewer@example.com', password: 'password123' })
        })
      ),
      { runtime, enabled: true }
    );
    const { user } = (await jsonOf<{ data: { user: { id: string; role: string } } }>(signup)).data;
    expect(user.role).toBe('admin'); // first signup ever — bootstrapped, per spec 053

    // A second, non-first signup actually lands as `viewer`.
    const secondSignup = await handleSignup(
      contextFor(
        new Request('https://forge.test/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ email: 'second-viewer@example.com', password: 'password123' })
        })
      ),
      { runtime, enabled: true }
    );
    const viewer = (await jsonOf<{ data: { user: { id: string; role: string } } }>(secondSignup))
      .data.user;
    expect(viewer.role).toBe('viewer');

    // The viewer tries to PATCH their own record's `role` to `admin` — must be rejected: `role` has
    // `access: { write: ['admin'] }` (see `user-fields.ts`), so `assertWritableFields` (403s) it even
    // though the collection's row-level `update` access grants self-service on the record itself.
    await expect(
      runtime.update({
        collection: 'users',
        id: viewer.id,
        data: { role: 'admin' },
        user: { id: viewer.id, role: 'viewer' },
        overrideAccess: false
      })
    ).rejects.toThrow();

    const stillViewer = await runtime.findByID({
      collection: 'users',
      id: viewer.id,
      user: { id: viewer.id, role: 'viewer' },
      overrideAccess: false
    });
    expect(stillViewer.role).toBe('viewer');

    // The same viewer CAN update their own name — the collection's self-service grant still works for
    // fields that aren't role.
    const renamed = await runtime.update({
      collection: 'users',
      id: viewer.id,
      data: { name: 'Renamed By Self' },
      user: { id: viewer.id, role: 'viewer' },
      overrideAccess: false
    });
    expect(renamed.name).toBe('Renamed By Self');
  });

  it('an admin can change another user’s role', async () => {
    const runtime = await buildRuntime();
    const adminSignup = await handleSignup(
      contextFor(
        new Request('https://forge.test/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ email: 'root-admin@example.com', password: 'password123' })
        })
      ),
      { runtime, enabled: true }
    );
    const admin = (await jsonOf<{ data: { user: { id: string; role: string } } }>(adminSignup)).data
      .user;

    const viewerSignup = await handleSignup(
      contextFor(
        new Request('https://forge.test/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ email: 'promote-me@example.com', password: 'password123' })
        })
      ),
      { runtime, enabled: true }
    );
    const viewer = (await jsonOf<{ data: { user: { id: string; role: string } } }>(viewerSignup))
      .data.user;

    const promoted = await runtime.update({
      collection: 'users',
      id: viewer.id,
      data: { role: 'editor' },
      user: { id: admin.id, role: 'admin' },
      overrideAccess: false
    });
    expect(promoted.role).toBe('editor');
  });
});
