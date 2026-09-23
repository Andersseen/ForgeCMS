import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
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
    collections: [
      defineUsersCollection(),
      // An ordinary (non-auth-managed) collection with a function-based `access` rule — the shape the
      // CSRF tests below need; `users` itself is auth-managed and refuses generic mutation (spec 061).
      defineCollection({
        slug: 'notes',
        fields: { title: defineField.text({ required: true }) },
        access: { update: ({ user }) => user !== null }
      })
    ],
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

  // These two exercise the CSRF gate on a collection whose access is a *function* (the shape that makes
  // `resolveRequest` take the `resolveOptionalUser` branch rather than `authorize()`'s). They used to run
  // against `users`; spec 061 makes every generic mutation of the auth-managed `users` collection a
  // `403 AUTH_MANAGED_COLLECTION`, which would pass a "cross-site is rejected" assertion for the wrong
  // reason — so they use an ordinary collection with the same access shape, and the users collection
  // gets its own assertion below that tells the two `403`s apart by code.
  async function signupViewerWithNote() {
    const runtime = await buildRuntime();
    const auth = runtime.adapters.auth as UsersCollectionAuthAdapter;
    await auth.signup({ email: 'admin@example.com', password: 'password123' });
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
    const note = await runtime.create({ collection: 'notes', data: { title: 'A note' } });
    return { runtime, token, viewerId, noteId: note.id as string };
  }

  it('rejects a cross-site cookie-only mutation against a collection with its own function-based access', async () => {
    const { runtime, token, noteId } = await signupViewerWithNote();

    const response = await handleUpdate(
      contextFor(
        new Request(`https://forge.test/api/v1/notes/${noteId}`, {
          method: 'PATCH',
          headers: { cookie: `forge_session=${token}`, origin: 'https://evil.test' },
          body: JSON.stringify({ title: 'Cross-site write' })
        }),
        { collection: 'notes', id: noteId }
      ),
      { runtime }
    );
    expect(response.status).toBe(403);
    expect((await jsonOf<{ error: { code: string } }>(response)).error.code).toBe('FORBIDDEN');
    expect(await runtime.findByID({ collection: 'notes', id: noteId })).toMatchObject({
      title: 'A note'
    });
  });

  it('allows the identical same-origin request against that same collection shape', async () => {
    const { runtime, token, noteId } = await signupViewerWithNote();

    const response = await handleUpdate(
      contextFor(
        new Request(`https://forge.test/api/v1/notes/${noteId}`, {
          method: 'PATCH',
          headers: { cookie: `forge_session=${token}`, origin: 'https://forge.test' },
          body: JSON.stringify({ title: 'Same-site write' })
        }),
        { collection: 'notes', id: noteId }
      ),
      { runtime }
    );
    expect(response.status).toBe(200);
  });

  it('on the auth-managed users collection a same-origin cookie mutation is refused by the boundary, a cross-site one by CSRF', async () => {
    const { runtime, token, viewerId } = await signupViewerWithNote();
    const patch = (origin: string) =>
      handleUpdate(
        contextFor(
          new Request(`https://forge.test/api/v1/users/${viewerId}`, {
            method: 'PATCH',
            headers: { cookie: `forge_session=${token}`, origin },
            body: JSON.stringify({ name: 'Renamed' })
          }),
          { collection: 'users', id: viewerId }
        ),
        { runtime }
      );

    const sameSite = await patch('https://forge.test');
    expect(sameSite.status).toBe(403);
    expect((await jsonOf<{ error: { code: string } }>(sameSite)).error.code).toBe(
      'AUTH_MANAGED_COLLECTION'
    );

    const crossSite = await patch('https://evil.test');
    expect(crossSite.status).toBe(403);
    expect((await jsonOf<{ error: { code: string } }>(crossSite)).error.code).toBe('FORBIDDEN');
  });
});

describe('defineUsersCollection(): role escalation cannot happen through the generic update route', () => {
  async function signupTwo() {
    const runtime = await buildRuntime();
    const auth = runtime.adapters.auth as UsersCollectionAuthAdapter;
    const first = await handleSignup(
      contextFor(
        new Request('https://forge.test/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ email: 'root-admin@example.com', password: 'password123' })
        })
      ),
      { runtime, enabled: true }
    );
    const admin = (await jsonOf<{ data: { user: { id: string; role: string } } }>(first)).data.user;
    expect(admin.role).toBe('admin'); // first signup ever — bootstrapped, per spec 053

    // A second, non-first signup actually lands as `viewer`.
    const second = await handleSignup(
      contextFor(
        new Request('https://forge.test/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ email: 'second-viewer@example.com', password: 'password123' })
        })
      ),
      { runtime, enabled: true }
    );
    const viewer = (await jsonOf<{ data: { user: { id: string; role: string } } }>(second)).data
      .user;
    expect(viewer.role).toBe('viewer');
    return { runtime, auth, admin, viewer };
  }

  it('a non-admin cannot escalate their own role — the generic route refuses every write to the record', async () => {
    const { runtime, viewer } = await signupTwo();
    const asViewer = { id: viewer.id, role: 'viewer' };

    // Spec 061: `users` is auth-managed, so generic updates are refused outright — the field-level
    // `role: { write: ['admin'] }` rule below is defence in depth, no longer the only line.
    await expect(
      runtime.update({
        collection: 'users',
        id: viewer.id,
        data: { role: 'admin' },
        user: asViewer,
        overrideAccess: false
      })
    ).rejects.toMatchObject({ code: 'AUTH_MANAGED_COLLECTION', status: 403 });
    await expect(
      runtime.update({
        collection: 'users',
        id: viewer.id,
        data: { name: 'Renamed By Self' },
        user: asViewer,
        overrideAccess: false
      })
    ).rejects.toMatchObject({ code: 'AUTH_MANAGED_COLLECTION' });

    const stillViewer = await runtime.findByID({
      collection: 'users',
      id: viewer.id,
      user: asViewer,
      overrideAccess: false
    });
    expect(stillViewer).toMatchObject({ role: 'viewer' });
  });

  it('the field-level write rule on `role` still holds where a write is previewed (defence in depth)', async () => {
    const { runtime, viewer } = await signupTwo();
    await expect(
      runtime.preview({
        collection: 'users',
        id: viewer.id,
        data: { role: 'admin' },
        user: { id: viewer.id, role: 'viewer' },
        overrideAccess: false
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('an admin changes another user’s role through the dedicated surface, not generic CRUD', async () => {
    const { runtime, auth, admin, viewer } = await signupTwo();
    const asAdmin = { id: admin.id, role: 'admin' };

    await expect(
      runtime.update({
        collection: 'users',
        id: viewer.id,
        data: { role: 'editor' },
        user: asAdmin,
        overrideAccess: false
      })
    ).rejects.toMatchObject({ code: 'AUTH_MANAGED_COLLECTION' });

    await expect(auth.updateUser(viewer.id, { role: 'editor' })).resolves.toMatchObject({
      role: 'editor'
    });
  });
});
