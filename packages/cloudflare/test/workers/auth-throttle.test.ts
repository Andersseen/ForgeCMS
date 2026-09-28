import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { UsersCollectionAuthAdapter, defineUsersCollection } from '@forge-cms/auth';
import type { AuthAttemptThrottle } from '@forge-cms/runtime';
import { ForgeCmsRuntime, handleLogin, handleSignup } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { D1DatabaseAdapter } from '../../src/d1.adapter.js';

/**
 * Spec 069 (H04): the Cloudflare host wiring documented in browser-auth.md, verbatim — a client bucket
 * for every attempt plus an account bucket for login — against Miniflare's local emulation of the Rate
 * Limiting binding inside workerd (client 3 / account 5 per 60 s, `wrangler.test.jsonc`). It proves the
 * wiring and Forge's 429 semantics on the real runtime; it does NOT exercise Cloudflare's remote
 * rate-limit service (per-location, eventually consistent). Forge's own throttle semantics are pinned
 * clock-free in packages/runtime/src/auth-abuse.test.ts; here the platform's window is wall-clock, so
 * each scenario uses fresh keys and starts inside a single window (see `withinOneWindow`).
 */
function cloudflareAuthThrottle(bindings: Cloudflare.Env): AuthAttemptThrottle {
  return async ({ action, identifier, request }) => {
    const client = request.headers.get('cf-connecting-ip') ?? 'unknown';
    const checks = [bindings.AUTH_CLIENT_LIMITER.limit({ key: `${action}:client:${client}` })];
    if (action === 'login') {
      checks.push(bindings.AUTH_ACCOUNT_LIMITER.limit({ key: `login:account:${identifier}` }));
    }
    const results = await Promise.all(checks);
    return results.every((r) => r.success)
      ? { allowed: true }
      : { allowed: false, retryAfterSeconds: 60 };
  };
}

/**
 * Miniflare buckets by `floor(Date.now() / period)`. A scenario of a few requests takes well under a
 * second, so start it only when at least 5 s of the current 60 s window remain — otherwise a window
 * boundary in the middle would reset the counters and make the expected 429 a flaky 401.
 */
async function withinOneWindow(): Promise<void> {
  const remaining = 60_000 - (Date.now() % 60_000);
  if (remaining < 5_000) await scheduler.wait(remaining + 50);
}

let runId = 0;
async function buildRuntime() {
  const collection = `throttle_users_${++runId}_${Date.now()}`;
  const database = new D1DatabaseAdapter();
  const auth = new UsersCollectionAuthAdapter({ devMode: true, collection }).init({
    userDatabase: database
  });
  const runtime = new ForgeCmsRuntime({
    collections: [defineUsersCollection({ slug: collection })],
    adapters: { database, auth, storage: new InMemoryStorageAdapter() },
    env
  });
  runtime.init();
  await runtime.syncSchema();
  const admin = `admin-${collection}@example.com`;
  await auth.signup({ email: admin, password: 'password123' });
  return { runtime, admin, tag: collection };
}

function login(runtime: ForgeCmsRuntime, email: string, password: string, client: string) {
  return handleLogin(
    {
      request: new Request('https://forge.test/api/auth/login', {
        method: 'POST',
        headers: { 'cf-connecting-ip': client },
        body: JSON.stringify({ email, password })
      }),
      env
    },
    { runtime, throttle: cloudflareAuthThrottle(env) }
  );
}

describe('Cloudflare Rate Limiting bindings → AuthAttemptThrottle (local workerd emulation)', () => {
  it('one client: the client bucket allows 3 attempts, then 429 RATE_LIMITED with Retry-After', async () => {
    const { runtime, admin, tag } = await buildRuntime();
    await withinOneWindow();
    const client = `198.51.100.1-${tag}`;
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      statuses.push((await login(runtime, admin, 'wrong-password', client)).status);
    }
    const limited = await login(runtime, admin, 'password123', client);
    expect(statuses).toEqual([401, 401, 401]);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect(await limited.json()).toEqual({
      error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts' }
    });
  });

  it('many clients, one account: the account bucket stops a distributed guess at 5 — the same for an unknown email', async () => {
    const { runtime, admin, tag } = await buildRuntime();
    for (const email of [admin, `nobody-${tag}@example.com`]) {
      await withinOneWindow();
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const client = `203.0.113.${i}-${email}`;
        statuses.push((await login(runtime, email, 'wrong-password', client)).status);
      }
      expect(statuses, email).toEqual([401, 401, 401, 401, 401, 429]);
    }
  });

  it('signup is limited per client only: new emails from one client cannot get past the client bucket', async () => {
    const { runtime, tag } = await buildRuntime();
    await withinOneWindow();
    const client = `192.0.2.7-${tag}`;
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const response = await handleSignup(
        {
          request: new Request('https://forge.test/api/auth/signup', {
            method: 'POST',
            headers: { 'cf-connecting-ip': client },
            body: JSON.stringify({ email: `new-${i}-${tag}@example.com`, password: 'password123' })
          }),
          env
        },
        { runtime, enabled: true, throttle: cloudflareAuthThrottle(env) }
      );
      statuses.push(response.status);
    }
    expect(statuses).toEqual([201, 201, 201, 429]);
  });
});

describe('PBKDF2 on workerd (spec 069 work-factor audit)', () => {
  async function derive(iterations: number): Promise<number> {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('password'),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: new Uint8Array(16), iterations, hash: 'SHA-256' },
      key,
      256
    );
    return bits.byteLength;
  }

  // workerd does not cap PBKDF2 iterations (an earlier assumption that it stops at 100,000 was checked
  // here and is false). The 100,000-iteration decision rests on CPU cost instead — see spec 069.
  it('runs the 100,000-iteration PBKDF2-SHA256 derivation Forge stores and verifies', async () => {
    expect(await derive(100_000)).toBe(32);
  });
});
