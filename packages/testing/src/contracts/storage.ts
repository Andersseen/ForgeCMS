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

/**
 * Runs the basic durable-storage contract against an adapter. Every test works under its own random
 * key namespace, so the suite is safe against a persistent store (a real bucket) as well as a fresh
 * in-memory one. Metadata keys are lowercase because S3 normalises them; adapters must round-trip
 * lowercase-keyed, ASCII-valued metadata.
 */
export function runStorageAdapterContractTests(createAdapter: () => ContractStorageAdapter) {
  describe('StorageAdapter contract', () => {
    let adapter: ContractStorageAdapter;
    let ns: string;
    const bytesOf = (text: string) => new TextEncoder().encode(text);
    const textOf = (body: ArrayBuffer | undefined) => new TextDecoder().decode(body);

    beforeEach(() => {
      adapter = createAdapter();
      ns = `contract-${crypto.randomUUID()}`;
    });

    it('has a name', () => {
      expect(adapter.name).toBeTruthy();
      expect(typeof adapter.name).toBe('string');
    });

    it('puts and gets an object', async () => {
      const putResult = await adapter.put({
        key: `${ns}/test.txt`,
        body: bytesOf('hello'),
        contentType: 'text/plain'
      });
      expect(putResult.key).toBe(`${ns}/test.txt`);
      expect(putResult.size).toBe(5);

      const got = await adapter.get(`${ns}/test.txt`);
      expect(got).toBeTruthy();
      expect(got?.key).toBe(`${ns}/test.txt`);
      expect(got?.body).toBeInstanceOf(ArrayBuffer);
      expect(textOf(got?.body)).toBe('hello');
      expect(got?.size).toBe(5);
    });

    it('preserves exact binary bytes, including an empty object', async () => {
      const binary = Uint8Array.from({ length: 256 }, (_, i) => i);
      await adapter.put({ key: `${ns}/binary.bin`, body: binary });
      const got = await adapter.get(`${ns}/binary.bin`);
      expect(got?.body).toBeInstanceOf(ArrayBuffer);
      expect(Array.from(new Uint8Array(got?.body ?? new ArrayBuffer(0)))).toEqual(
        Array.from(binary)
      );

      await adapter.put({ key: `${ns}/empty.bin`, body: new Uint8Array(0) });
      const empty = await adapter.get(`${ns}/empty.bin`);
      expect(empty).toBeTruthy();
      expect(empty?.body?.byteLength).toBe(0);
    });

    it('accepts every PutObjectOptions body shape', async () => {
      const text = 'shapes';
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytesOf('sha'));
          controller.enqueue(bytesOf('pes'));
          controller.close();
        }
      });
      const bodies: Record<string, Blob | ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>> = {
        blob: new Blob([text]),
        arraybuffer: bytesOf(text).buffer as ArrayBuffer,
        uint8: bytesOf(text),
        stream
      };
      for (const [name, body] of Object.entries(bodies)) {
        const put = await adapter.put({ key: `${ns}/${name}.txt`, body });
        expect(put.size).toBe(text.length);
        expect(textOf((await adapter.get(`${ns}/${name}.txt`))?.body)).toBe(text);
      }
    });

    it('round-trips content type and custom metadata', async () => {
      await adapter.put({
        key: `${ns}/photo.png`,
        body: bytesOf('png'),
        contentType: 'image/png',
        metadata: { owner: 'forge', purpose: 'contract' }
      });
      const got = await adapter.get(`${ns}/photo.png`);
      expect(got?.contentType).toBe('image/png');
      expect(got?.metadata).toMatchObject({ owner: 'forge', purpose: 'contract' });
    });

    it('overwrites an existing key', async () => {
      await adapter.put({ key: `${ns}/o.txt`, body: bytesOf('one') });
      await adapter.put({ key: `${ns}/o.txt`, body: bytesOf('three') });
      const got = await adapter.get(`${ns}/o.txt`);
      expect(textOf(got?.body)).toBe('three');
      expect(got?.size).toBe(5);
    });

    it('returns null for missing object', async () => {
      const got = await adapter.get(`${ns}/nonexistent.txt`);
      expect(got).toBeNull();
    });

    it('deletes an object', async () => {
      await adapter.put({ key: `${ns}/delete-me.txt`, body: bytesOf('bye') });
      await adapter.delete(`${ns}/delete-me.txt`);
      const got = await adapter.get(`${ns}/delete-me.txt`);
      expect(got).toBeNull();
    });

    it('delete of a missing object resolves', async () => {
      await expect(adapter.delete(`${ns}/never-existed.txt`)).resolves.toBeUndefined();
    });

    it('returns a public URL', async () => {
      const url = await adapter.getPublicUrl(`${ns}/public.txt`);
      expect(typeof url).toBe('string');
      expect(url.length).toBeGreaterThan(0);
    });

    it('lists objects', async () => {
      await adapter.put({ key: `${ns}/a.txt`, body: bytesOf('a') });
      await adapter.put({ key: `${ns}/b.txt`, body: bytesOf('bb') });
      const all = await adapter.list();
      expect(all.length).toBeGreaterThanOrEqual(2);
      const mine = all.filter((o) => o.key.startsWith(`${ns}/`));
      expect(mine.map((o) => o.key).sort()).toEqual([`${ns}/a.txt`, `${ns}/b.txt`]);
      expect(mine.find((o) => o.key === `${ns}/b.txt`)?.size).toBe(2);
    });

    it('lists objects with prefix', async () => {
      await adapter.put({ key: `${ns}/prefix/1.txt`, body: bytesOf('1') });
      await adapter.put({ key: `${ns}/other/2.txt`, body: bytesOf('2') });
      const prefixed = await adapter.list(`${ns}/prefix/`);
      expect(prefixed.length).toBe(1);
      expect(prefixed[0]).toBeTruthy();
      expect(prefixed[0]!.key).toBe(`${ns}/prefix/1.txt`);
    });

    describe('URL-sensitive keys', () => {
      const names = [
        'my photo.png',
        'résumé-日本語.pdf',
        'a#b.txt',
        'what?.txt',
        '100%.txt',
        'plus+and&amp=eq.txt',
        'percent%20literal.txt'
      ];

      it.each(names)('stores %s and builds a URL that decodes back to the key', async (name) => {
        const key = `${ns}/media/id-${name}`;
        await adapter.put({ key, body: bytesOf(name) });
        expect(textOf((await adapter.get(key))?.body)).toBe(name);
        expect((await adapter.list(`${ns}/media/`)).map((o) => o.key)).toContain(key);

        const url = await adapter.getPublicUrl(key);
        const parsed = new URL(url, 'http://forge.test');
        // `#` and `?` must not leak out of the path, and `/` stays the hierarchy separator.
        expect(parsed.hash).toBe('');
        expect(parsed.search).toBe('');
        expect(decodeURIComponent(parsed.pathname).endsWith(`/${key}`)).toBe(true);
        expect(parsed.pathname).toContain(`${ns}/media/`);
      });
    });
  });
}
