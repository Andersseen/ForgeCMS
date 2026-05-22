import { beforeEach, describe, expect, it } from 'vitest';

interface ContractStorageObject {
  key: string;
  body?: ArrayBuffer;
  url?: string;
  contentType?: string;
  size?: number;
  metadata?: Record<string, string>;
}

interface ContractStorageAdapter {
  readonly name: string;
  init(env?: unknown): unknown;
  put(options: {
    key: string;
    body: Blob | ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>;
    contentType?: string;
    metadata?: Record<string, string>;
  }): Promise<ContractStorageObject>;
  get(key: string): Promise<ContractStorageObject | null>;
  delete(key: string): Promise<void>;
  getPublicUrl(key: string): Promise<string>;
  list(prefix?: string): Promise<ContractStorageObject[]>;
}

export function runStorageAdapterContractTests(createAdapter: () => ContractStorageAdapter) {
  describe('StorageAdapter contract', () => {
    let adapter: ContractStorageAdapter;

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
      expect(putResult.size).toBe(5);

      const got = await adapter.get('test.txt');
      expect(got).toBeTruthy();
      expect(got?.key).toBe('test.txt');
      expect(got?.body).toBeInstanceOf(ArrayBuffer);
      if (got?.body) {
        expect(new TextDecoder().decode(got.body)).toBe('hello');
      }
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

    it('lists objects', async () => {
      await adapter.put({ key: 'a.txt', body: new TextEncoder().encode('a') });
      await adapter.put({ key: 'b.txt', body: new TextEncoder().encode('b') });
      const all = await adapter.list();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    it('lists objects with prefix', async () => {
      await adapter.put({ key: 'prefix/1.txt', body: new TextEncoder().encode('1') });
      await adapter.put({ key: 'other/2.txt', body: new TextEncoder().encode('2') });
      const prefixed = await adapter.list('prefix/');
      expect(prefixed.length).toBe(1);
      expect(prefixed[0]).toBeTruthy();
      expect(prefixed[0]!.key).toBe('prefix/1.txt');
    });
  });
}
