import type { StorageAdapter } from '@forge-cms/storage';
import { beforeEach, describe, expect, it } from 'vitest';

export function runStorageAdapterContractTests(createAdapter: () => StorageAdapter) {
  describe('StorageAdapter contract', () => {
    let adapter: StorageAdapter;

    beforeEach(() => {
      adapter = createAdapter();
    });

    it('has a name', () => {
      expect(adapter.name).toBeTruthy();
      expect(typeof adapter.name).toBe('string');
    });

    it('puts and gets an object', async () => {
      const data = new TextEncoder().encode('hello');
      const putResult = await adapter.put({
        key: 'test.txt',
        body: data,
        contentType: 'text/plain'
      });
      expect(putResult.key).toBe('test.txt');

      const got = await adapter.get('test.txt');
      expect(got).toBeTruthy();
      expect(got?.key).toBe('test.txt');
    });

    it('returns null for missing object', async () => {
      const got = await adapter.get('nonexistent.txt');
      expect(got).toBeNull();
    });

    it('deletes an object', async () => {
      await adapter.put({
        key: 'delete-me.txt',
        body: new TextEncoder().encode('bye')
      });
      await adapter.delete('delete-me.txt');
      const got = await adapter.get('delete-me.txt');
      expect(got).toBeNull();
    });

    it('returns a public URL', async () => {
      const url = await adapter.getPublicUrl('public.txt');
      expect(typeof url).toBe('string');
      expect(url.length).toBeGreaterThan(0);
    });
  });
}
