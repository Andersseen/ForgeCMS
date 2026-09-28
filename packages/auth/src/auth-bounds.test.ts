/**
 * Spec 069 (roadmap 0.6 H04): bounded credential inputs, explicit development secrets, login
 * verification parity and cookie attributes. Expensive work is observed through spies on Web Crypto and
 * the database adapter — never through wall-clock timing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { ApiKeyAuthAdapter } from './api-key.adapter.js';
import { buildLogoutCookie, buildSessionCookie } from './cookie.js';
import { UserMutationError } from './index.js';
import { SESSION_TTL_SECONDS } from './session-lifetime.js';
import { DEMO_CREDENTIALS, SignedTokenAuthAdapter } from './signed-token.adapter.js';
import { MAX_SIGNED_TOKEN_LENGTH, MIN_SIGNING_SECRET_BYTES } from './token-signer.js';
import { UsersCollectionAuthAdapter } from './users-collection.adapter.js';

const STRONG_SECRET = 'a-production-secret-with-more-than-32-bytes';

async function usersAdapter(
  options: ConstructorParameters<typeof UsersCollectionAuthAdapter>[0] = {}
) {
  const db = new InMemoryDatabaseAdapter();
  const adapter = new UsersCollectionAuthAdapter({ devMode: true, ...options }).init({
    userDatabase: db
  });
  return { adapter, db };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('signing secrets: development mode is explicit, production secrets have a minimum', () => {
  const adapters = [
    {
      label: 'UsersCollectionAuthAdapter',
      init: (devMode: boolean, secret?: string) =>
        new UsersCollectionAuthAdapter({ devMode }).init({
          ...(secret !== undefined && { AUTH_SECRET: secret }),
          userDatabase: new InMemoryDatabaseAdapter()
        })
    },
    {
      label: 'SignedTokenAuthAdapter',
      init: (devMode: boolean, secret?: string) =>
        new SignedTokenAuthAdapter({ devMode }).init(
          secret !== undefined ? { AUTH_SECRET: secret } : {}
        )
    }
  ];

  for (const { label, init } of adapters) {
    it(`${label}: no secret without devMode fails configuration`, () => {
      expect(() => init(false)).toThrow(`${label} requires AUTH_SECRET to be set`);
    });

    it(`${label}: no secret with an explicit devMode uses the dev secret`, () => {
      expect(() => init(true)).not.toThrow();
    });

    it(`${label}: a strong secret without devMode succeeds; exactly ${MIN_SIGNING_SECRET_BYTES} bytes is enough`, () => {
      expect(() => init(false, STRONG_SECRET)).not.toThrow();
      expect(() => init(false, 'x'.repeat(MIN_SIGNING_SECRET_BYTES))).not.toThrow();
    });

    it(`${label}: a weak production secret fails configuration without echoing it`, () => {
      const weak = 'short-secret-value';
      let message = '';
      try {
        init(false, weak);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain('AUTH_SECRET is too short');
      expect(message).not.toContain(weak);
      expect(() => init(false, 'x'.repeat(MIN_SIGNING_SECRET_BYTES - 1))).toThrow('too short');
    });

    it(`${label}: the minimum is measured in UTF-8 bytes, not characters`, () => {
      // 11 characters, 33 bytes.
      expect(() => init(false, '€'.repeat(11))).not.toThrow();
      // 31 characters, 31 bytes.
      expect(() => init(false, 'e'.repeat(31))).toThrow('too short');
    });

    it(`${label}: devMode accepts a short secret it was given (local-only)`, () => {
      expect(() => init(true, 'x')).not.toThrow();
    });
  }

  it('a production adapter never accepts a token signed with the public dev secret', async () => {
    const forged = await new SignedTokenAuthAdapter({ devMode: true })
      .init({})
      .issueToken({ id: 'u1', role: 'admin' });
    const production = new SignedTokenAuthAdapter().init({ AUTH_SECRET: STRONG_SECRET });
    expect(await production.validateSession(forged)).toBeNull();
  });
});

describe('PasswordPolicy: one bounded length definition on every path', () => {
  it('rejects invalid policy configuration at construction', () => {
    const bad = [
      { minLength: 0 },
      { minLength: 1.5 },
      { maxLength: 7 }, // below the default minimum of 8
      { minLength: 12, maxLength: 11 },
      { maxLength: 4097 },
      { maxLength: Number.POSITIVE_INFINITY },
      { maxLength: Number.NaN }
    ];
    for (const passwordPolicy of bad) {
      expect(() => new UsersCollectionAuthAdapter({ devMode: true, passwordPolicy })).toThrow(
        /passwordPolicy/
      );
    }
    expect(
      () => new UsersCollectionAuthAdapter({ passwordPolicy: { minLength: 12, maxLength: 12 } })
    ).not.toThrow();
    expect(
      () => new UsersCollectionAuthAdapter({ passwordPolicy: { maxLength: 4096 } })
    ).not.toThrow();
  });

  it('accepts exactly the minimum and the default maximum (1024), rejects one past either, before hashing', async () => {
    const { adapter } = await usersAdapter();
    const derive = vi.spyOn(crypto.subtle, 'deriveBits');

    expect((await adapter.signup({ email: 'min@example.com', password: 'x'.repeat(8) })).ok).toBe(
      true
    );
    expect(
      (await adapter.signup({ email: 'max@example.com', password: 'x'.repeat(1024) })).ok
    ).toBe(true);
    expect(derive).toHaveBeenCalledTimes(2);
    derive.mockClear();

    expect(await adapter.signup({ email: 'short@example.com', password: 'x'.repeat(7) })).toEqual({
      ok: false,
      reason: 'weak-password'
    });
    expect(await adapter.signup({ email: 'long@example.com', password: 'x'.repeat(1025) })).toEqual(
      {
        ok: false,
        reason: 'weak-password'
      }
    );
    expect(
      await adapter.createUser({ email: 'long2@example.com', password: 'x'.repeat(1_000_000) })
    ).toEqual({ ok: false, reason: 'weak-password' });
    expect(derive).not.toHaveBeenCalled();
  });

  it('a long password manager passphrase logs in and is never truncated', async () => {
    const { adapter } = await usersAdapter();
    const passphrase = 'correct horse battery staple '.repeat(40).slice(0, 900);
    expect((await adapter.signup({ email: 'p@example.com', password: passphrase })).ok).toBe(true);
    expect(passphrase).toHaveLength(900);
    expect((await adapter.login('p@example.com', passphrase)).ok).toBe(true);
    // Same 900-character prefix plus one more character: a different password, not a truncated match.
    expect((await adapter.login('p@example.com', passphrase + 'x')).ok).toBe(false);
    expect((await adapter.login('p@example.com', passphrase.slice(0, 899))).ok).toBe(false);
  });

  it('updateUser refuses an out-of-policy password before hashing or writing', async () => {
    const { adapter, db } = await usersAdapter();
    const created = await adapter.createUser({ email: 'u@example.com', password: 'password123' });
    if (!created.ok) throw new Error('setup');
    const derive = vi.spyOn(crypto.subtle, 'deriveBits');
    const update = vi.spyOn(db, 'update');
    const updateIf = vi.spyOn(db, 'updateIf');

    for (const password of ['x'.repeat(1025), 'short']) {
      const err = await adapter.updateUser(created.user.id, { password }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UserMutationError);
      expect((err as UserMutationError).reason).toBe('weak-password');
    }
    expect(derive).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(updateIf).not.toHaveBeenCalled();
    expect((await adapter.login('u@example.com', 'password123')).ok).toBe(true);
  });

  it('a configured maximum applies to login too: a stored password above a lowered maximum no longer logs in', async () => {
    const db = new InMemoryDatabaseAdapter();
    const generous = new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: db });
    await generous.signup({ email: 'old@example.com', password: 'y'.repeat(100) });
    const lowered = new UsersCollectionAuthAdapter({
      devMode: true,
      passwordPolicy: { maxLength: 64 }
    }).init({ userDatabase: db });
    expect(await lowered.login('old@example.com', 'y'.repeat(100))).toEqual({
      ok: false,
      reason: 'invalid-credentials'
    });
    expect((await generous.login('old@example.com', 'y'.repeat(100))).ok).toBe(true);
  });
});

describe('login: generic failures, one verification, no work for oversized input', () => {
  let adapter: UsersCollectionAuthAdapter;
  let db: InMemoryDatabaseAdapter;

  beforeEach(async () => {
    ({ adapter, db } = await usersAdapter());
    await adapter.signup({ email: 'known@example.com', password: 'password123' });
  });

  it('an oversized password is invalid-credentials before any lookup or PBKDF2', async () => {
    const derive = vi.spyOn(crypto.subtle, 'deriveBits');
    const importKey = vi.spyOn(crypto.subtle, 'importKey');
    const findMany = vi.spyOn(db, 'findMany');
    for (const email of ['known@example.com', 'unknown@example.com']) {
      expect(await adapter.login(email, 'x'.repeat(1025))).toEqual({
        ok: false,
        reason: 'invalid-credentials'
      });
    }
    expect(derive).not.toHaveBeenCalled();
    expect(importKey).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('unknown email and known email + wrong password: same result, exactly one PBKDF2 each, no writes, no salt', async () => {
    const derive = vi.spyOn(crypto.subtle, 'deriveBits');
    const random = vi.spyOn(crypto, 'getRandomValues');
    const writes = [
      vi.spyOn(db, 'create'),
      vi.spyOn(db, 'update'),
      vi.spyOn(db, 'updateIf'),
      vi.spyOn(db, 'atomicWrite')
    ];

    const unknown = await adapter.login('unknown@example.com', 'wrong-password');
    const unknownDerives = derive.mock.calls.length;
    derive.mockClear();
    const wrong = await adapter.login('known@example.com', 'wrong-password');
    const wrongDerives = derive.mock.calls.length;

    expect(unknown).toEqual({ ok: false, reason: 'invalid-credentials' });
    expect(wrong).toEqual(unknown);
    expect(unknownDerives).toBe(1);
    expect(wrongDerives).toBe(1);
    for (const write of writes) expect(write).not.toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled();
  });

  it('the dummy verification uses the stored hash format (16-byte salt, 256-bit PBKDF2-SHA256)', async () => {
    const derive = vi.spyOn(crypto.subtle, 'deriveBits');
    await adapter.login('nobody@example.com', 'whatever-password');
    const [params, , bits] = derive.mock.calls[0]!;
    const pbkdf2 = params as Pbkdf2Params;
    expect(pbkdf2.name).toBe('PBKDF2');
    expect(pbkdf2.hash).toBe('SHA-256');
    expect(pbkdf2.iterations).toBe(100_000);
    expect((pbkdf2.salt as Uint8Array).byteLength).toBe(16);
    expect(bits).toBe(256);
  });

  it('a row without a stored hash also verifies once and fails generically', async () => {
    await db.create('users', { email: 'nohash@example.com', role: 'viewer' });
    const derive = vi.spyOn(crypto.subtle, 'deriveBits');
    expect(await adapter.login('nohash@example.com', 'anything-at-all')).toEqual({
      ok: false,
      reason: 'invalid-credentials'
    });
    expect(derive).toHaveBeenCalledTimes(1);
  });

  it('the correct password still logs in', async () => {
    expect((await adapter.login('KNOWN@example.com ', 'password123')).ok).toBe(true);
  });
});

describe('email and name bounds keep issued tokens bounded', () => {
  it('rejects an email over 254 characters and a name over 256, on create, signup and update', async () => {
    const { adapter } = await usersAdapter();
    const longEmail = `${'a'.repeat(250)}@example.com`;
    expect(await adapter.signup({ email: longEmail, password: 'password123' })).toEqual({
      ok: false,
      reason: 'invalid-email'
    });
    expect(
      await adapter.createUser({
        email: 'n@example.com',
        password: 'password123',
        name: 'n'.repeat(257)
      })
    ).toEqual({ ok: false, reason: 'invalid-name' });

    const created = await adapter.createUser({
      email: 'ok@example.com',
      password: 'password123',
      name: 'n'.repeat(256)
    });
    if (!created.ok) throw new Error('setup');
    for (const [input, reason] of [
      [{ email: longEmail }, 'invalid-email'],
      [{ email: 'not-an-email' }, 'invalid-email'],
      [{ name: 'n'.repeat(257) }, 'invalid-name']
    ] as const) {
      const err = await adapter.updateUser(created.user.id, input).catch((e: unknown) => e);
      expect((err as UserMutationError).reason).toBe(reason);
    }
  });

  it('the largest token Forge issues stays well under MAX_SIGNED_TOKEN_LENGTH and validates', async () => {
    const { adapter } = await usersAdapter();
    // Worst case for JSON + base64 size: lone surrogates are escaped to six characters each.
    const created = await adapter.createUser({
      email: `${'a'.repeat(242)}@example.com`,
      password: 'password123',
      name: '\ud800'.repeat(256),
      role: 'admin'
    });
    if (!created.ok) throw new Error(`setup: ${created.reason}`);
    expect(created.token.length).toBeLessThan(MAX_SIGNED_TOKEN_LENGTH / 2);
    expect(await adapter.validateSession(created.token)).not.toBeNull();
  });
});

describe('Forge-owned credential formats fail cheaply when oversized', () => {
  it('a signed token over the bound is refused before any split, decode or HMAC', async () => {
    const adapter = new SignedTokenAuthAdapter({ devMode: true }).init({});
    const verify = vi.spyOn(crypto.subtle, 'verify');
    const importKey = vi.spyOn(crypto.subtle, 'importKey');
    const huge = `${'a'.repeat(MAX_SIGNED_TOKEN_LENGTH)}.b`;
    expect(adapter.canHandleToken(huge)).toBe(false);
    expect(await adapter.validateSession(huge)).toBeNull();
    const request = new Request('https://forge.test', {
      headers: { authorization: `Bearer ${huge}` }
    });
    await expect(adapter.requireAuth(request)).rejects.toMatchObject({ name: 'ForgeAuthError' });
    expect(verify).not.toHaveBeenCalled();
    expect(importKey).not.toHaveBeenCalled();
  });

  it('users-collection sessions apply the same bound (no HMAC, no database read)', async () => {
    const { adapter, db } = await usersAdapter();
    const verify = vi.spyOn(crypto.subtle, 'verify');
    const findById = vi.spyOn(db, 'findById');
    expect(await adapter.validateSession(`${'a'.repeat(5_000_000)}.b`)).toBeNull();
    expect(verify).not.toHaveBeenCalled();
    expect(findById).not.toHaveBeenCalled();
  });

  it('an API key over the bound is refused before any database lookup or hashing; real keys still work', async () => {
    const db = new InMemoryDatabaseAdapter();
    const adapter = new ApiKeyAuthAdapter({ prefix: 'a-rather-long-custom-prefix' }).init({
      apiKeyDatabase: db
    });
    await adapter.syncSchema();
    const { secret } = await adapter.createApiKey({ name: 'ci' });
    const findById = vi.spyOn(db, 'findById');
    const digest = vi.spyOn(crypto.subtle, 'digest');

    const huge = `a-rather-long-custom-prefix_${'z'.repeat(5_000_000)}_secret`;
    expect(adapter.canHandleToken(huge)).toBe(false);
    expect(await adapter.validateSession(huge)).toBeNull();
    expect(findById).not.toHaveBeenCalled();
    expect(digest).not.toHaveBeenCalled();

    expect(adapter.canHandleToken(secret)).toBe(true);
    expect((await adapter.validateSession(secret))?.user.role).toBe('machine');
  });

  it('SignedTokenAuthAdapter demo login never hashes an oversized password', async () => {
    const adapter = new SignedTokenAuthAdapter({ devMode: true }).init({});
    const digest = vi.spyOn(crypto.subtle, 'digest');
    expect(await adapter.login(DEMO_CREDENTIALS.email, 'x'.repeat(1025))).toEqual({
      ok: false,
      reason: 'invalid-credentials'
    });
    expect(digest).not.toHaveBeenCalled();
    expect((await adapter.login(DEMO_CREDENTIALS.email, DEMO_CREDENTIALS.password)).ok).toBe(true);
  });
});

describe('session cookie attributes', () => {
  it('a session cookie is HttpOnly, SameSite=Lax, Path=/, Secure by default, and lives as long as the token', async () => {
    const cookie = buildSessionCookie('tok');
    const attrs = cookie.split('; ');
    expect(attrs[0]).toBe('forge_session=tok');
    expect(attrs).toEqual(
      expect.arrayContaining([
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        'Secure',
        `Max-Age=${SESSION_TTL_SECONDS}`
      ])
    );
    expect(SESSION_TTL_SECONDS).toBe(24 * 60 * 60);

    const { adapter } = await usersAdapter();
    const before = Date.now();
    const created = await adapter.createUser({ email: 'ttl@example.com', password: 'password123' });
    if (!created.ok) throw new Error('setup');
    const session = await adapter.validateSession(created.token);
    const lifetime = (session!.expiresAt!.getTime() - before) / 1000;
    expect(Math.abs(lifetime - SESSION_TTL_SECONDS)).toBeLessThan(5);
  });

  it('the logout cookie carries the same security attributes with Max-Age=0', () => {
    const attrs = buildLogoutCookie().split('; ');
    expect(attrs).toEqual([
      'forge_session=',
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      'Max-Age=0',
      'Secure'
    ]);
  });

  it('only an explicit secure: false (local http:// development) drops Secure, and nothing else', () => {
    expect(buildSessionCookie('tok', {})).toContain('Secure');
    expect(buildSessionCookie('tok', { secure: true })).toContain('Secure');
    const insecure = buildSessionCookie('tok', { secure: false }).split('; ');
    expect(insecure).not.toContain('Secure');
    expect(insecure).toEqual(expect.arrayContaining(['Path=/', 'HttpOnly', 'SameSite=Lax']));
    expect(buildLogoutCookie({ secure: false })).not.toContain('Secure');
  });
});
