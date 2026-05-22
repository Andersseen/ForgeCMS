import { describe, expect, it, beforeEach } from 'vitest';
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

  constructor(obj: R2Object) {
    this.key = obj.key;
    this.size = obj.size;
    this.etag = obj.etag;
    this.httpEtag = obj.httpEtag;
    this.httpMetadata = obj.httpMetadata;
    this.customMetadata = obj.customMetadata;
    this.uploaded = obj.uploaded;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }

  async text(): Promise<string> {
    return '';
  }

  async json<T>(): Promise<T> {
    return {} as T;
  }

  async blob(): Promise<Blob> {
    return new Blob();
  }
}

/** Simple in-memory mock of R2Bucket for unit testing */
class MockR2Bucket implements R2Bucket {
  private objects = new Map<string, R2Object>();

  async head(key: string): Promise<R2Object | null> {
    return this.objects.get(key) ?? null;
  }

  async get(key: string): Promise<MockR2ObjectBody | null> {
    const obj = this.objects.get(key);
    if (!obj) return null;
    return new MockR2ObjectBody(obj);
  }

  async put(
    key: string,
    _value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
    options?: { customMetadata?: Record<string, string>; httpMetadata?: R2HTTPMetadata }
  ): Promise<R2Object> {
    const size = typeof _value === 'string' ? _value.length : 0;
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
  }

  async list(options?: { limit?: number; prefix?: string; cursor?: string }): Promise<{
    objects: R2Object[];
    truncated: boolean;
    delimitedPrefixes: string[];
  }> {
    const all = Array.from(this.objects.values());
    const filtered = options?.prefix
      ? all.filter((o) => o.key.startsWith(options.prefix!))
      : all;
    return {
      objects: filtered.slice(0, options?.limit ?? 1000),
      truncated: false,
      delimitedPrefixes: []
    };
  }
}

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

  it('returns public URL with default base', async () => {
    const url = await adapter.getPublicUrl('public.txt');
    expect(url).toBe('https://r2.example.com/public.txt');
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
