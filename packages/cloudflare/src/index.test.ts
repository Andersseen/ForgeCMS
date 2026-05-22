import { describe, expect, it } from 'vitest';
import type { CloudflareEnv, D1Database, R2Bucket, KVNamespace } from './index.js';

describe('Cloudflare bindings types', () => {
  it('CloudflareEnv can hold all binding types', () => {
    const env: CloudflareEnv = {
      DB: {} as D1Database,
      BUCKET: {} as R2Bucket,
      KV: {} as KVNamespace,
      MY_SECRET: 'shhh'
    };

    expect(env.DB).toBeTruthy();
    expect(env.BUCKET).toBeTruthy();
    expect(env.KV).toBeTruthy();
    expect(env.MY_SECRET).toBe('shhh');
  });
});
