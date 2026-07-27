import { describe, expect, it, beforeEach } from 'vitest';
import { runStorageAdapterContractTests } from '@forge-cms/testing/contracts';
import { R2StorageAdapter } from './r2.adapter.js';
import type { R2Bucket, R2Object, R2HTTPMetadata } from './bindings.js';

/** Mock R2ObjectBody for unit testing */
class MockR2ObjectBody implements R2Object {
  key: string;
  size: number;
  etag: string;
  httpEtag: string;
  httpMetadata: R2HTTPMetadata;
  customMetadata: Record<string, string>;
  checksums = {};
  uploaded: Date;
  version = '1';
  body = new ReadableStream();
  bodyUsed = false;
  private readonly bytes: Uint8Array;

  constructor(obj: R2Object, bytes: Uint8Array = new Uint8Array()) {
    this.bytes = bytes;
    this.key = obj.key;
    this.size = obj.size;
    this.etag = obj.etag;
    this.httpEtag = obj.httpEtag;
    this.httpMetadata = obj.httpMetadata;
    this.customMetadata = obj.customMetadata;
    this.uploaded = obj.uploaded;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.bytes.buffer.slice(
      this.bytes.byteOffset,
      this.bytes.byteOffset + this.bytes.byteLength
    ) as ArrayBuffer;
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(this.bytes);
  }

  async json<T>(): Promise<T> {
    return {} as T;
  }

  async blob(): Promise<Blob> {
    return new Blob();
  }
}

/** Simple in-memory mock of R2Bucket for unit testing */
async function toBytes(
  value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null
): Promise<Uint8Array> {
  if (value === null) return new Uint8Array();
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(
      value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
    );
  }
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());

  const reader = (value as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    chunks.push(chunk);
    total += chunk.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

class MockR2Bucket implements R2Bucket {
  private objects = new Map<string, R2Object>();
  /** Real bytes, so `get()` can be held to the contract's round-trip assertion. */
  private bodies = new Map<string, Uint8Array>();

  async head(key: string): Promise<R2Object | null> {
    return this.objects.get(key) ?? null;
  }

  async get(key: string): Promise<MockR2ObjectBody | null> {
    const obj = this.objects.get(key);
    if (!obj) return null;
    return new MockR2ObjectBody(obj, this.bodies.get(key) ?? new Uint8Array());
  }

  async put(
    key: string,
    _value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
    options?: { customMetadata?: Record<string, string>; httpMetadata?: R2HTTPMetadata }
  ): Promise<R2Object> {
    const bytes = await toBytes(_value);
    this.bodies.set(key, bytes);
    const size = bytes.length;
    const obj: R2Object = {
      key,
      size,
      etag: 'etag-' + key,
      httpEtag: '"etag-' + key + '"',
      httpMetadata: options?.httpMetadata ?? {},
      customMetadata: options?.customMetadata ?? {},
      checksums: {},
      uploaded: new Date(),
      version: '1'
    };
    this.objects.set(key, obj);
    return obj;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
    this.bodies.delete(key);
  }

  async list(options?: { limit?: number; prefix?: string; cursor?: string }): Promise<{
    objects: R2Object[];
    truncated: boolean;
    delimitedPrefixes: string[];
  }> {
    const all = Array.from(this.objects.values());
    const filtered = options?.prefix ? all.filter((o) => o.key.startsWith(options.prefix!)) : all;
    return {
      objects: filtered.slice(0, options?.limit ?? 1000),
      truncated: false,
      delimitedPrefixes: []
    };
  }
}

// CONVENTIONS.md requires this of every adapter, but only the in-memory ones were doing it — which
// is exactly why `get()` returning no body went unnoticed until a demo tried to serve an image.
runStorageAdapterContractTests(() => new R2StorageAdapter().init({ BUCKET: new MockR2Bucket() }));

describe('R2StorageAdapter', () => {
  let adapter: R2StorageAdapter;
  let mockBucket: MockR2Bucket;

  beforeEach(() => {
    mockBucket = new MockR2Bucket();
    adapter = new R2StorageAdapter();
    adapter.init({ BUCKET: mockBucket });
  });

  it('initialises with BUCKET binding', () => {
    expect(adapter.name).toBe('r2');
  });

  it('throws if BUCKET binding is missing', () => {
    const badAdapter = new R2StorageAdapter();
    expect(() => badAdapter.init({})).toThrow('R2StorageAdapter requires env.BUCKET binding');
  });

  it('reads a custom binding name (spec 040)', async () => {
    const custom = new R2StorageAdapter({ binding: 'MEDIA' });
    custom.init({ MEDIA: mockBucket });

    await custom.put({ key: 'x.txt', body: new TextEncoder().encode('hi') });
    expect(await custom.get('x.txt')).not.toBeNull();
  });

  it('names the binding it looked for when it is missing', () => {
    const custom = new R2StorageAdapter({ binding: 'MEDIA' });
    expect(() => custom.init({ BUCKET: mockBucket })).toThrow(
      'R2StorageAdapter requires env.MEDIA binding'
    );
  });

  it('takes a public URL base from the constructor', async () => {
    const custom = new R2StorageAdapter({ publicUrlBase: 'https://cdn.example.com/' });
    custom.init({ BUCKET: mockBucket });

    expect(await custom.getPublicUrl('media/a.png')).toBe('https://cdn.example.com/media/a.png');
  });

  it('puts and gets an object', async () => {
    const data = new TextEncoder().encode('hello r2');
    const putResult = await adapter.put({
      key: 'test.txt',
      body: data,
      contentType: 'text/plain',
      metadata: { author: 'test' }
    });

    expect(putResult.key).toBe('test.txt');

    const got = await adapter.get('test.txt');
    expect(got).toBeTruthy();
    expect(got?.key).toBe('test.txt');
    expect(got?.metadata?.author).toBe('test');
  });

  it('deletes an object', async () => {
    await adapter.put({ key: 'delete-me.txt', body: new TextEncoder().encode('bye') });
    await adapter.delete('delete-me.txt');

    const got = await adapter.get('delete-me.txt');
    expect(got).toBeNull();
  });

  // The default has to be a path an app can actually serve (`handleFile`), not a placeholder
  // domain: a stored file whose URL points nowhere is a broken image on every page that shows it.
  it('returns a servable public URL by default', async () => {
    const url = await adapter.getPublicUrl('media/public.txt');
    expect(url).toBe('/api/media/media/public.txt');
  });

  it('returns public URL with custom base', async () => {
    adapter.setPublicUrlBase('https://cdn.example.com');
    const url = await adapter.getPublicUrl('public.txt');
    expect(url).toBe('https://cdn.example.com/public.txt');
  });

  it('lists objects with prefix', async () => {
    await adapter.put({ key: 'prefix/1.txt', body: new TextEncoder().encode('1') });
    await adapter.put({ key: 'prefix/2.txt', body: new TextEncoder().encode('2') });
    await adapter.put({ key: 'other/3.txt', body: new TextEncoder().encode('3') });

    const prefixed = await adapter.list('prefix/');
    expect(prefixed).toHaveLength(2);
  });
});
