import { describe, expect, it } from 'vitest';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { parseS3Config, selectStorage } from '../server/api/storage';

describe('optional S3 storage profile (spec 083)', () => {
  const complete = { S3_BUCKET: 'media', S3_REGION: 'garage' };

  it('is off by default: no S3 setting means in-memory development storage', async () => {
    expect(parseS3Config(undefined)).toBeNull();
    expect(parseS3Config({ S3_BUCKET: '  ', S3_ENDPOINT: '' })).toBeNull();
    expect(await selectStorage({})).toBeInstanceOf(InMemoryStorageAdapter);
  });

  it('builds an S3 adapter from a complete configuration', async () => {
    const storage = await selectStorage({
      ...complete,
      S3_ENDPOINT: 'http://127.0.0.1:3900',
      S3_ACCESS_KEY_ID: 'id',
      S3_SECRET_ACCESS_KEY: 'secret',
      S3_FORCE_PATH_STYLE: 'TRUE'
    });
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
