import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { runStorageAdapterContractTests } from '@forge-cms/testing/contracts';
import { R2StorageAdapter } from '../../src/r2.adapter.js';

runStorageAdapterContractTests(() => new R2StorageAdapter().init(env));

describe('R2StorageAdapter — real local R2 binding', () => {
  it('puts, gets (with bytes and metadata), and lists an object', async () => {
    const adapter = new R2StorageAdapter().init(env);
    const bytes = new TextEncoder().encode('real r2 bytes');

    const put = await adapter.put({
      key: 'r2-smoke/hello.txt',
      body: bytes,
      contentType: 'text/plain',
      metadata: { source: 'test' }
    });
    expect(put.key).toBe('r2-smoke/hello.txt');
    expect(put.size).toBe(bytes.byteLength);

    const got = await adapter.get('r2-smoke/hello.txt');
    expect(got).not.toBeNull();
    expect(new TextDecoder().decode(got!.body)).toBe('real r2 bytes');
    expect(got?.contentType).toBe('text/plain');
    expect(got?.metadata).toEqual({ source: 'test' });

    const listed = await adapter.list('r2-smoke/');
    expect(listed.map((o) => o.key)).toContain('r2-smoke/hello.txt');
  });

  it('deletes an object', async () => {
    const adapter = new R2StorageAdapter().init(env);
    await adapter.put({ key: 'r2-smoke/delete-me.txt', body: new TextEncoder().encode('bye') });
    await adapter.delete('r2-smoke/delete-me.txt');
    expect(await adapter.get('r2-smoke/delete-me.txt')).toBeNull();
  });

  it('returns a public URL built from the default /api/media base', async () => {
    const adapter = new R2StorageAdapter().init(env);
    expect(await adapter.getPublicUrl('r2-smoke/hello.txt')).toBe('/api/media/r2-smoke/hello.txt');
  });

  it('throws a clear error naming the missing binding, against a real Miniflare env shape', () => {
    const adapter = new R2StorageAdapter({ binding: 'NOT_A_REAL_BINDING' });
    expect(() => adapter.init(env)).toThrow(
      'R2StorageAdapter requires env.NOT_A_REAL_BINDING binding'
    );
  });
});
