/**
 * Spec 105 (V2-01): versioned password hashes, a configurable work factor and rehash-on-login. Work is
 * observed through Web Crypto / database spies and stored formats — never through wall-clock timing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { PASSWORD_HASHING_PRESETS } from './index.js';
import {
  hashPassword,
  needsRehash,
  parsePasswordHash,
  resolvePasswordHashing,
  timingSafeEqual,
  verifyPassword
} from './password-hash.js';
import { UsersCollectionAuthAdapter } from './users-collection.adapter.js';
import type { UsersCollectionAuthAdapterOptions } from './users-collection.adapter.js';

const PASSWORD = 'correct horse battery staple';
const DEFAULT = { iterations: 100_000 };
const STRONG = { iterations: 200_000 }; // > default, cheap enough for unit tests

afterEach(() => {
  vi.restoreAllMocks();
});

/** Exactly the 1.0 algorithm and format (`base64url(salt ‖ PBKDF2-SHA256(100 000))`), reproduced here. */
async function legacyHash(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    key,
    256
  );
  const combined = new Uint8Array(48);
  combined.set(salt);
  combined.set(new Uint8Array(bits), 16);
  let binary = '';
  for (const byte of combined) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function adapterWith(db: InMemoryDatabaseAdapter, options: UsersCollectionAuthAdapterOptions = {}) {
  return new UsersCollectionAuthAdapter({ devMode: true, ...options }).init({ userDatabase: db });
}

async function storedHash(db: InMemoryDatabaseAdapter, email: string): Promise<string> {
  const [row] = await db.findMany({ collection: 'users', where: { email } });
  return String(row?.passwordHash);
}

describe('configuration', () => {
  it('defaults to the 1.0 work factor and exposes documented presets', () => {
    expect(resolvePasswordHashing(undefined)).toEqual(DEFAULT);
    expect(PASSWORD_HASHING_PRESETS.workers).toEqual({ iterations: 100_000 });
    expect(PASSWORD_HASHING_PRESETS.node).toEqual({ iterations: 600_000 });
    expect(Object.isFrozen(PASSWORD_HASHING_PRESETS.node)).toBe(true);
  });

  it.each([99_999, 0, -1, 100_000.5, 10_000_001, Number.NaN])(
    'refuses iterations %s at construction (never weaker than 1.0)',
    (iterations) => {
      expect(() => new UsersCollectionAuthAdapter({ passwordHashing: { iterations } })).toThrow(
        /passwordHashing\.iterations/
      );
    }
  );
});

describe('stored formats', () => {
  it('a 1.0 hash verifies unchanged, under the default and under a stronger work factor', async () => {
    const legacy = await legacyHash(PASSWORD);
    expect(parsePasswordHash(legacy)?.iterations).toBe(100_000);
    expect(await verifyPassword(PASSWORD, legacy, DEFAULT)).toBe(true);
    expect(await verifyPassword(PASSWORD, legacy, STRONG)).toBe(true);
    expect(await verifyPassword('wrong password!', legacy, STRONG)).toBe(false);
  });

  it('the default work factor still writes the 1.0 format, so a rollback to 1.0 keeps verifying', async () => {
    const hash = await hashPassword(PASSWORD, DEFAULT);
    expect(hash).not.toContain('$');
    expect(hash).toMatch(/^[A-Za-z0-9_-]{64}$/);
  });

  it('a raised work factor writes a versioned hash that records its own iterations', async () => {
    const hash = await hashPassword(PASSWORD, STRONG);
    expect(hash).toMatch(/^\$pbkdf2-sha256\$i=200000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(await verifyPassword(PASSWORD, hash, DEFAULT)).toBe(true);
    expect(await verifyPassword(PASSWORD, hash, STRONG)).toBe(true);
    expect(await verifyPassword('wrong password!', hash, STRONG)).toBe(false);
  });

  it.each([
    '',
    'not-base64!!',
    'AAAA',
    '$pbkdf2-sha256$i=99999$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    '$pbkdf2-sha256$i=200000$AAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    '$pbkdf2-sha256$i=200000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA$x',
    '$pbkdf2-sha512$i=200000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  ])('a malformed hash (%j) never verifies, and still pays one derivation', async (stored) => {
    const derive = vi.spyOn(crypto.subtle, 'deriveBits');
    expect(await verifyPassword(PASSWORD, stored, DEFAULT)).toBe(false);
    expect(derive).toHaveBeenCalledTimes(1);
  });

  it('needsRehash: only a hash below the configured work factor', async () => {
    const legacy = await legacyHash(PASSWORD);
    const strong = await hashPassword(PASSWORD, STRONG);
    expect(needsRehash(legacy, DEFAULT)).toBe(false);
    expect(needsRehash(legacy, STRONG)).toBe(true);
    expect(needsRehash(strong, STRONG)).toBe(false);
    expect(needsRehash(strong, DEFAULT)).toBe(false); // never downgraded
    expect(needsRehash('garbage', STRONG)).toBe(false);
  });
});

describe('timing-safe compare', () => {
  it('reads every byte whatever the position of the first difference', () => {
    const reads = (a: Uint8Array, b: Uint8Array) => {
      let count = 0;
      const counted = new Proxy(a, {
        get(target, prop) {
          if (typeof prop === 'string' && /^\d+$/.test(prop)) count += 1;
          return Reflect.get(target, prop, target) as unknown;
        }
      });
      const equal = timingSafeEqual(counted, b);
      return { equal, count };
    };
    const base = new Uint8Array(32).fill(7);
    const firstDiffers = base.slice();
    firstDiffers[0] = 8;
    const lastDiffers = base.slice();
    lastDiffers[31] = 8;
    expect(reads(base, base.slice())).toEqual({ equal: true, count: 32 });
    expect(reads(firstDiffers, base)).toEqual({ equal: false, count: 32 });
    expect(reads(lastDiffers, base)).toEqual({ equal: false, count: 32 });
    expect(timingSafeEqual(new Uint8Array(31), new Uint8Array(32))).toBe(false);
  });
});

describe('UsersCollectionAuthAdapter: migration from 1.0 hashes and rehash-on-login', () => {
  it('a 1.0 user signs in after the upgrade with the default unchanged — no rewrite', async () => {
    const db = new InMemoryDatabaseAdapter();
    const legacy = await legacyHash(PASSWORD);
    await db.create('users', { email: 'old@example.com', role: 'editor', passwordHash: legacy });
    const writes = [vi.spyOn(db, 'update'), vi.spyOn(db, 'updateIf')];

    const result = await adapterWith(db).login('old@example.com', PASSWORD);

    expect(result.ok).toBe(true);
    for (const write of writes) expect(write).not.toHaveBeenCalled();
    expect(await storedHash(db, 'old@example.com')).toBe(legacy);
  });

  it('a raised work factor upgrades a 1.0 hash on the next successful login, without revoking sessions', async () => {
    const db = new InMemoryDatabaseAdapter();
    const legacy = await legacyHash(PASSWORD);
    await db.create('users', {
      email: 'old@example.com',
      role: 'editor',
      passwordHash: legacy,
      _sessionVersion: 3
    });
    const adapter = adapterWith(db, { passwordHashing: STRONG });

    const first = await adapter.login('old@example.com', PASSWORD);
    expect(first.ok).toBe(true);
    const upgraded = await storedHash(db, 'old@example.com');
    expect(upgraded).toMatch(/^\$pbkdf2-sha256\$i=200000\$/);
    const [row] = await db.findMany({ collection: 'users', where: { email: 'old@example.com' } });
    expect(row?._sessionVersion).toBe(3);
    // The session issued before the upgrade is still valid.
    if (!first.ok) throw new Error('unreachable');
    const request = new Request('https://cms.test/', {
      headers: { authorization: `Bearer ${first.token}` }
    });
    await expect(adapter.requireAuth(request)).resolves.toMatchObject({ email: 'old@example.com' });

    const updateIf = vi.spyOn(db, 'updateIf');
    expect((await adapter.login('old@example.com', PASSWORD)).ok).toBe(true);
    expect(updateIf).not.toHaveBeenCalled(); // already at the target
    expect(await storedHash(db, 'old@example.com')).toBe(upgraded);
  });

  it('a wrong password never rehashes', async () => {
    const db = new InMemoryDatabaseAdapter();
    const legacy = await legacyHash(PASSWORD);
    await db.create('users', { email: 'old@example.com', role: 'editor', passwordHash: legacy });
    const updateIf = vi.spyOn(db, 'updateIf');

    const result = await adapterWith(db, { passwordHashing: STRONG }).login(
      'old@example.com',
      'not the password'
    );

    expect(result).toEqual({ ok: false, reason: 'invalid-credentials' });
    expect(updateIf).not.toHaveBeenCalled();
    expect(await storedHash(db, 'old@example.com')).toBe(legacy);
  });

  it('the rehash is a compare-and-set on the old hash: a password changed meanwhile is kept', async () => {
    const db = new InMemoryDatabaseAdapter();
    const legacy = await legacyHash(PASSWORD);
    const row = await db.create('users', {
      email: 'old@example.com',
      role: 'editor',
      passwordHash: legacy
    });
    const changed = await legacyHash('a brand new password');
    const original = db.updateIf.bind(db);
    const updateIf = vi.spyOn(db, 'updateIf').mockImplementation(async (...args) => {
      // Another request changes the password between this login's verification and its rehash.
      await db.update('users', String(row.id), { passwordHash: changed });
      return original(...args);
    });

    expect(
      (await adapterWith(db, { passwordHashing: STRONG }).login('old@example.com', PASSWORD)).ok
    ).toBe(true);

    expect(updateIf).toHaveBeenCalledWith(
      'users',
      String(row.id),
      expect.objectContaining({
        passwordHash: expect.stringMatching(/^\$pbkdf2-sha256\$/) as unknown
      }),
      { targetMatches: { passwordHash: legacy } }
    );
    expect(await storedHash(db, 'old@example.com')).toBe(changed);
  });

  it('a failed rehash write is not a failed login', async () => {
    const db = new InMemoryDatabaseAdapter();
    const legacy = await legacyHash(PASSWORD);
    await db.create('users', { email: 'old@example.com', role: 'editor', passwordHash: legacy });
    vi.spyOn(db, 'updateIf').mockRejectedValue(new Error('database unavailable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await adapterWith(db, { passwordHashing: STRONG }).login(
      'old@example.com',
      PASSWORD
    );

    expect(result.ok).toBe(true);
    expect(await storedHash(db, 'old@example.com')).toBe(legacy);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).not.toContain(PASSWORD);
  });

  it('new users and password changes use the configured work factor', async () => {
    const db = new InMemoryDatabaseAdapter();
    const adapter = adapterWith(db, { passwordHashing: STRONG });
    const created = await adapter.createUser({ email: 'new@example.com', password: PASSWORD });
    expect(created.ok).toBe(true);
    expect(await storedHash(db, 'new@example.com')).toMatch(/^\$pbkdf2-sha256\$i=200000\$/);
    expect((await adapter.login('new@example.com', PASSWORD)).ok).toBe(true);
  });

  it('an unknown email pays one derivation at the configured work factor', async () => {
    const db = new InMemoryDatabaseAdapter();
    const derive = vi.spyOn(crypto.subtle, 'deriveBits');
    await adapterWith(db, { passwordHashing: STRONG }).login('nobody@example.com', PASSWORD);
    expect(derive).toHaveBeenCalledTimes(1);
    expect((derive.mock.calls[0]?.[0] as Pbkdf2Params).iterations).toBe(200_000);
  });
});
