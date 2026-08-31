import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ApiKeyAuthAdapter, CompositeAuthAdapter, ForgeAuthError } from '@forge-cms/auth';
import { D1DatabaseAdapter } from '../../src/d1.adapter.js';

function realDb(): D1DatabaseAdapter {
  return new D1DatabaseAdapter().init(env);
}

describe('ApiKeyAuthAdapter — real local D1 binding: full lifecycle', () => {
  it('syncs, creates, authenticates, propagates scope/metadata, and revokes through real D1', async () => {
    const database = realDb();
    const auth = new ApiKeyAuthAdapter();
    auth.init({ apiKeyDatabase: database });
    await auth.syncSchema();

    const { apiKey, secret } = await auth.createApiKey({
      name: 'lifecycle-bot',
      scopes: ['articles:read'],
      metadata: { tenant: 'acme' }
    });
    expect(apiKey.revokedAt).toBeUndefined();

    const request = new Request('https://forge.test', {
      headers: { authorization: `Bearer ${secret}` }
    });
    const user = await auth.requireAuth(request);
    expect(user.role).toBe('machine');
    expect(user.scopes).toEqual(['articles:read']);
    expect(user.metadata).toEqual({ tenant: 'acme' });

    await auth.revokeApiKey(apiKey.id);
    const afterRevoke = await auth.getApiKey(apiKey.id);
    expect(afterRevoke?.revokedAt).toBeTruthy();

    await expect(auth.requireAuth(request)).rejects.toThrow();
  });

  it('throttles lastUsedAt writes, then advances it once the throttle window passes', async () => {
    const database = realDb();
    // A zero throttle makes every successful authentication update lastUsedAt, so the "it advances"
    // half of the contract is directly observable without waiting out the default 5-minute window.
    const auth = new ApiKeyAuthAdapter({ lastUsedAtThrottleMs: 0 });
    auth.init({ apiKeyDatabase: database });
    await auth.syncSchema();

    const { apiKey, secret } = await auth.createApiKey({ name: 'throttle-bot' });
    expect(apiKey.lastUsedAt).toBeUndefined();

    const request = () =>
      new Request('https://forge.test', { headers: { authorization: `Bearer ${secret}` } });

    await auth.requireAuth(request());
    const afterFirst = await auth.getApiKey(apiKey.id);
    expect(afterFirst?.lastUsedAt).toBeTruthy();

    await auth.requireAuth(request());
    const afterSecond = await auth.getApiKey(apiKey.id);
    expect(afterSecond?.lastUsedAt).toBeTruthy();
    expect(Date.parse(afterSecond!.lastUsedAt!)).toBeGreaterThanOrEqual(
      Date.parse(afterFirst!.lastUsedAt!)
    );
  });

  it('a throttled second authentication does not advance lastUsedAt within the window', async () => {
    const database = realDb();
    const auth = new ApiKeyAuthAdapter({ lastUsedAtThrottleMs: 60_000 });
    auth.init({ apiKeyDatabase: database });
    await auth.syncSchema();

    const { apiKey, secret } = await auth.createApiKey({ name: 'throttle-window-bot' });
    const request = () =>
      new Request('https://forge.test', { headers: { authorization: `Bearer ${secret}` } });

    await auth.requireAuth(request());
    const afterFirst = await auth.getApiKey(apiKey.id);

    await auth.requireAuth(request());
    const afterSecond = await auth.getApiKey(apiKey.id);

    expect(afterSecond?.lastUsedAt).toBe(afterFirst?.lastUsedAt);
  });
});

describe('CompositeAuthAdapter — real local D1 binding: failure semantics', () => {
  // spec 049: only an expected `ForgeAuthError` (bad/missing/expired/revoked credential) may cause
  // `CompositeAuthAdapter` to treat a request as unauthenticated. A DB outage or misconfiguration
  // must propagate as itself, not be silently downgraded to "unauthenticated" (which `handlers.ts`
  // would otherwise turn into a misleading 401 instead of a 500). Proven here with a *real* D1
  // failure — the auth table was never synced — not a fake adapter that throws on command.
  it('a real D1 failure (unsynced auth table) propagates, not a 401-style rejection', async () => {
    const database = realDb();
    const auth = new ApiKeyAuthAdapter();
    auth.init({ apiKeyDatabase: database });
    // Deliberately never calling auth.syncSchema() — the `_forge_api_keys` table does not exist.

    const composite = new CompositeAuthAdapter([auth]);
    const request = new Request('https://forge.test', {
      headers: { authorization: 'Bearer forge_00000000-0000-0000-0000-000000000000_somesecret' }
    });

    let thrown: unknown;
    try {
      await composite.requireAuth(request);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeDefined();
    expect(thrown).not.toBeInstanceOf(ForgeAuthError);
  });
});
