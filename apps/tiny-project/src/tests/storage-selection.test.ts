import { describe, expect, it } from 'vitest';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { createS3Storage, parseS3Config } from '../server/api/storage';
import { resolveProfile, type ProfileEnv } from '../server/api/profile';
import { getServerRuntime, resetServerRuntimeForTests } from '../server/api/runtime';

describe('S3 configuration (specs 083, 084)', () => {
  const complete = { S3_BUCKET: 'media', S3_REGION: 'garage' };

  it('is absent when no S3 setting is present', () => {
    expect(parseS3Config(undefined)).toBeNull();
    expect(parseS3Config({ S3_BUCKET: '  ', S3_ENDPOINT: '' })).toBeNull();
  });

  it('builds an S3 adapter from a complete configuration', async () => {
    const config = parseS3Config({
      ...complete,
      S3_ENDPOINT: 'http://127.0.0.1:3900',
      S3_ACCESS_KEY_ID: 'id',
      S3_SECRET_ACCESS_KEY: 'secret',
      S3_FORCE_PATH_STYLE: 'TRUE'
    });
    const storage = await createS3Storage(config!);
    expect(storage.name).toBe('s3');
    expect(await storage.getPublicUrl('media/a b.txt')).toBe('/api/media/media/a%20b.txt');
  });

  it('keeps endpoint and credentials optional, so AWS and its provider chain still work', () => {
    expect(parseS3Config(complete)).toEqual({
      bucket: 'media',
      region: 'garage',
      forcePathStyle: false
    });
  });

  it('honours the public URL base', () => {
    expect(
      parseS3Config({ ...complete, S3_PUBLIC_URL_BASE: 'https://cdn.example/files' })
    ).toMatchObject({
      publicUrlBase: 'https://cdn.example/files'
    });
  });

  it('fails clearly, without echoing values, when the configuration is partial or malformed', () => {
    expect(() => parseS3Config({ S3_BUCKET: 'media' })).toThrow(/S3_BUCKET and S3_REGION/);
    expect(() => parseS3Config({ S3_ENDPOINT: 'http://x' })).toThrow(/S3_BUCKET and S3_REGION/);
    expect(() => parseS3Config({ ...complete, S3_ACCESS_KEY_ID: 'only-id' })).toThrow(
      /go together/
    );
    expect(() => parseS3Config({ ...complete, S3_SECRET_ACCESS_KEY: 'hush-hush' })).toThrow(
      /go together/
    );
    expect(() => parseS3Config({ ...complete, S3_SESSION_TOKEN: 'tok' })).toThrow(
      /S3_SESSION_TOKEN/
    );
    expect(() => parseS3Config({ ...complete, S3_FORCE_PATH_STYLE: 'yes' })).toThrow(
      /'true' or 'false'/
    );
    try {
      parseS3Config({ ...complete, S3_SECRET_ACCESS_KEY: 'hush-hush' });
    } catch (err) {
      expect(String(err)).not.toContain('hush-hush');
    }
  });
});

describe('deployment profile (spec 084): durable in production, in-memory only in development', () => {
  const production = { development: false };
  const development = { development: true };
  const d1 = {};
  const r2 = {};
  const s3 = { S3_BUCKET: 'media', S3_REGION: 'garage' };

  it('development with nothing configured may use the in-memory adapters', () => {
    expect(resolveProfile(undefined, development)).toMatchObject({
      name: 'development',
      database: 'memory',
      storage: 'memory'
    });
    expect(resolveProfile({}, development)).toMatchObject({
      database: 'memory',
      storage: 'memory'
    });
  });

  it('development still follows whatever durable setting is present', () => {
    expect(resolveProfile({ DATABASE_URL: 'file:/tmp/x.db' }, development)).toMatchObject({
      database: 'libsql',
      storage: 'memory'
    });
    expect(resolveProfile({ DB: d1, BUCKET: r2 }, development)).toMatchObject({
      database: 'd1',
      storage: 'r2'
    });
  });

  it('production without any durable profile fails clearly instead of using memory', () => {
    for (const env of [undefined, {}, { AUTH_SECRET: 'x'.repeat(40) }]) {
      expect(() => resolveProfile(env, production)).toThrow(/No durable deployment profile/);
    }
  });

  it('production with a database but no matching durable storage fails, naming what is missing', () => {
    expect(() => resolveProfile({ DB: d1 }, production)).toThrow(
      /Incomplete Cloudflare profile: missing BUCKET/
    );
    expect(() => resolveProfile({ DATABASE_URL: 'file:/tmp/x.db' }, production)).toThrow(
      /Incomplete portable profile: missing S3_BUCKET and S3_REGION/
    );
  });

  it('production with storage but no matching durable database fails, naming what is missing', () => {
    expect(() => resolveProfile({ BUCKET: r2 }, production)).toThrow(
      /Incomplete Cloudflare profile: missing DB/
    );
    expect(() => resolveProfile(s3, production)).toThrow(
      /Incomplete portable profile: missing DATABASE_URL/
    );
  });

  it('accepts exactly the two complete durable profiles', () => {
    expect(resolveProfile({ DB: d1, BUCKET: r2 }, production)).toEqual({
      name: 'cloudflare',
      database: 'd1',
      storage: 'r2'
    });
    const portable = resolveProfile(
      { DATABASE_URL: 'file:/data/forge.db', ...s3, S3_FORCE_PATH_STYLE: 'true' },
      production
    );
    expect(portable).toMatchObject({ name: 'portable', database: 'libsql', storage: 's3' });
    expect(portable.s3).toMatchObject({ bucket: 'media', region: 'garage', forcePathStyle: true });
  });

  it('rejects a mixed Cloudflare + portable configuration instead of guessing a precedence', () => {
    expect(() =>
      resolveProfile({ DB: d1, BUCKET: r2, DATABASE_URL: 'file:/tmp/x.db', ...s3 }, production)
    ).toThrow(/Ambiguous deployment profile/);
    expect(() => resolveProfile({ DB: d1, ...s3 }, production)).toThrow(/Ambiguous/);
  });

  it('never echoes secret values', () => {
    const attempts: ProfileEnv[] = [
      { S3_BUCKET: 'media', S3_SECRET_ACCESS_KEY: 'hush-hush-secret' },
      { DATABASE_URL: 'libsql://user:hush-hush-secret@db.example', S3_ACCESS_KEY_ID: 'id' },
      { DB: d1, S3_SECRET_ACCESS_KEY: 'hush-hush-secret' }
    ];
    for (const env of attempts) {
      try {
        resolveProfile(env, production);
        throw new Error('expected a failure');
      } catch (err) {
        expect(String(err)).not.toContain('hush-hush-secret');
      }
    }
  });

  it('the built runtime enforces it at startup (production) and permits memory in development', async () => {
    resetServerRuntimeForTests();
    await expect(getServerRuntime({ AUTH_SECRET: 'x'.repeat(40) })).rejects.toThrow(
      /No durable deployment profile/
    );
    resetServerRuntimeForTests({ development: true });
    const runtime = await getServerRuntime({ AUTH_SECRET: 'x'.repeat(40) });
    expect(runtime.adapters.storage).toBeInstanceOf(InMemoryStorageAdapter);
    resetServerRuntimeForTests();
  });
});
