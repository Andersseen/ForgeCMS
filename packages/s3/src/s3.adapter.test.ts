import { S3Client } from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { S3StorageAdapter, type S3StorageAdapterOptions } from './index.js';

const base: S3StorageAdapterOptions = {
  bucket: 'forge-test',
  region: 'garage',
  endpoint: 'http://127.0.0.1:3900',
  forcePathStyle: true,
  credentials: { accessKeyId: 'AKIA-TEST-ID', secretAccessKey: 'super-secret-value' }
};

type Sent = { constructor: { name: string }; input: Record<string, unknown> };

let send: ReturnType<typeof vi.fn>;
beforeEach(() => {
  send = vi.fn();
  vi.spyOn(S3Client.prototype, 'send').mockImplementation(send as never);
});
afterEach(() => vi.restoreAllMocks());

const sent = (n = 0) => send.mock.calls[n]![0] as Sent;

function awsError(name: string, status: number) {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
}

function body(bytes: Uint8Array) {
  return { transformToByteArray: async () => bytes };
}

describe('S3StorageAdapter — configuration', () => {
  it('is named s3 and init is a chainable no-op', () => {
    const adapter = new S3StorageAdapter(base);
    expect(adapter.name).toBe('s3');
    expect(adapter.init({ anything: true })).toBe(adapter);
  });

  it.each(['', '   '])('rejects a blank bucket (%j)', (bucket) => {
    expect(() => new S3StorageAdapter({ ...base, bucket })).toThrow(/bucket is required/);
  });

  it('rejects a blank region instead of inventing one', () => {
    expect(() => new S3StorageAdapter({ ...base, region: ' ' })).toThrow(/region is required/);
  });

  it.each(['not a url', 'ftp://host/x', '/relative', 'file:///tmp'])(
    'rejects endpoint %j without echoing it',
    (endpoint) => {
      const make = () => new S3StorageAdapter({ ...base, endpoint });
      expect(make).toThrow(/endpoint must be an absolute http: or https: URL/);
      expect(make).not.toThrow(new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')));
    }
  );

  it('accepts http and https endpoints and no endpoint at all', () => {
    expect(
      () => new S3StorageAdapter({ ...base, endpoint: 'https://s3.example.com' })
    ).not.toThrow();
    const { endpoint: _omit, ...noEndpoint } = base;
    expect(() => new S3StorageAdapter(noEndpoint)).not.toThrow();
  });

  it('rejects empty explicit credentials without printing them', () => {
    const make = () =>
      new S3StorageAdapter({
        ...base,
        credentials: { accessKeyId: 'AKIA-LEAK', secretAccessKey: '' }
      });
    expect(make).toThrow(/credentials\.secretAccessKey is required/);
    expect(make).not.toThrow(/AKIA-LEAK/);
  });

  it('allows credentials to be omitted (SDK provider chain)', () => {
    const { credentials: _omit, ...rest } = base;
    expect(() => new S3StorageAdapter(rest)).not.toThrow();
  });

  it('passes forcePathStyle, endpoint, region and credentials to the SDK client', async () => {
    const adapter = new S3StorageAdapter({
      ...base,
      credentials: { ...base.credentials!, sessionToken: 'tok' }
    });
    const client = (adapter as unknown as { client: S3Client }).client;
    expect(client.config.forcePathStyle).toBe(true);
    expect(await client.config.region()).toBe('garage');
    const creds = await (client.config.credentials as () => Promise<unknown>)();
    expect(creds).toMatchObject({
      accessKeyId: 'AKIA-TEST-ID',
      secretAccessKey: 'super-secret-value',
      sessionToken: 'tok'
    });
  });

  it('defaults forcePathStyle to false', () => {
    const { forcePathStyle: _omit, ...rest } = base;
    const client = (new S3StorageAdapter(rest) as unknown as { client: S3Client }).client;
    expect(client.config.forcePathStyle).toBe(false);
  });
});

describe('S3StorageAdapter — getPublicUrl', () => {
  it('defaults to the access-checked /api/media path', async () => {
    expect(await new S3StorageAdapter(base).getPublicUrl('media/a.png')).toBe(
      '/api/media/media/a.png'
    );
  });

  it('encodes each segment but keeps / as the separator', async () => {
    const url = await new S3StorageAdapter(base).getPublicUrl('media/id-my photo #1.png');
    expect(url).toBe('/api/media/media/id-my%20photo%20%231.png');
  });

  it('honours a configured base and trims trailing slashes', async () => {
    const adapter = new S3StorageAdapter({ ...base, publicUrlBase: 'https://cdn.example.com//' });
    expect(await adapter.getPublicUrl('a b/c?.png')).toBe('https://cdn.example.com/a%20b/c%3F.png');
  });
});

describe('S3StorageAdapter — put', () => {
  it('sends bytes, content type and metadata and returns what it knows', async () => {
    send.mockResolvedValue({});
    const result = await new S3StorageAdapter(base).put({
      key: 'k.bin',
      body: new Uint8Array([1, 2, 3]),
      contentType: 'application/octet-stream',
      metadata: { owner: 'forge' }
    });
    expect(sent().constructor.name).toBe('PutObjectCommand');
    expect(sent().input).toMatchObject({
      Bucket: 'forge-test',
      Key: 'k.bin',
      ContentLength: 3,
      ContentType: 'application/octet-stream',
      Metadata: { owner: 'forge' }
    });
    expect(Array.from(sent().input['Body'] as Uint8Array)).toEqual([1, 2, 3]);
    expect(result).toEqual({
      key: 'k.bin',
      size: 3,
      contentType: 'application/octet-stream',
      metadata: { owner: 'forge' }
    });
  });

  it('omits unset optional fields', async () => {
    send.mockResolvedValue({});
    const result = await new S3StorageAdapter(base).put({ key: 'k', body: new Uint8Array(0) });
    expect(sent().input).not.toHaveProperty('ContentType');
    expect(sent().input).not.toHaveProperty('Metadata');
    expect(result).toEqual({ key: 'k', size: 0 });
  });

  it('normalises Blob, ArrayBuffer and ReadableStream bodies', async () => {
    send.mockResolvedValue({});
    const adapter = new S3StorageAdapter(base);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1, 2]));
        c.enqueue(new Uint8Array([3]));
        c.close();
      }
    });
    await adapter.put({ key: 'blob', body: new Blob([new Uint8Array([9, 8])]) });
    await adapter.put({ key: 'ab', body: new Uint8Array([7]).buffer as ArrayBuffer });
    await adapter.put({ key: 'stream', body: stream });
    expect(Array.from(sent(0).input['Body'] as Uint8Array)).toEqual([9, 8]);
    expect(Array.from(sent(1).input['Body'] as Uint8Array)).toEqual([7]);
    expect(Array.from(sent(2).input['Body'] as Uint8Array)).toEqual([1, 2, 3]);
  });

  it('rejects when the provider fails and does not leak credentials', async () => {
    send.mockRejectedValue(awsError('AccessDenied', 403));
    const err = (await new S3StorageAdapter(base)
      .put({ key: 'k', body: new Uint8Array(1) })
      .catch((e: unknown) => e)) as Error;
    expect(err.name).toBe('AccessDenied');
    expect(String(err.message)).not.toMatch(/super-secret-value|AKIA-TEST-ID/);
  });
});

describe('S3StorageAdapter — get', () => {
  it('returns bytes as an ArrayBuffer with content type and metadata', async () => {
    send.mockResolvedValue({
      Body: body(new Uint8Array([4, 5, 6])),
      ContentType: 'image/png',
      Metadata: { owner: 'forge' }
    });
    const got = await new S3StorageAdapter(base).get('a.png');
    expect(sent().constructor.name).toBe('GetObjectCommand');
    expect(got?.body).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(got!.body!))).toEqual([4, 5, 6]);
    expect(got).toMatchObject({
      key: 'a.png',
      size: 3,
      contentType: 'image/png',
      metadata: { owner: 'forge' }
    });
  });

  it.each(['NoSuchKey', 'NotFound'])('maps %s to null', async (name) => {
    send.mockRejectedValue(awsError(name, 404));
    expect(await new S3StorageAdapter(base).get('missing')).toBeNull();
  });

  it.each([
    ['NoSuchBucket', 404],
    ['AccessDenied', 403],
    ['InvalidAccessKeyId', 403],
    ['SignatureDoesNotMatch', 403],
    ['InternalError', 500],
    ['ServiceUnavailable', 503],
    ['TimeoutError', 0]
  ])('rejects %s (%i) instead of returning null', async (name, status) => {
    send.mockRejectedValue(awsError(name, status));
    await expect(new S3StorageAdapter(base).get('k')).rejects.toMatchObject({ name });
  });

  it('rejects a response with no body', async () => {
    send.mockResolvedValue({});
    await expect(new S3StorageAdapter(base).get('k')).rejects.toThrow(/without a body/);
  });
});

describe('S3StorageAdapter — delete', () => {
  it('sends DeleteObject and resolves', async () => {
    send.mockResolvedValue({});
    await expect(new S3StorageAdapter(base).delete('k')).resolves.toBeUndefined();
    expect(sent().constructor.name).toBe('DeleteObjectCommand');
    expect(sent().input).toMatchObject({ Bucket: 'forge-test', Key: 'k' });
  });

  it('rejects provider failures', async () => {
    send.mockRejectedValue(awsError('AccessDenied', 403));
    await expect(new S3StorageAdapter(base).delete('k')).rejects.toMatchObject({
      name: 'AccessDenied'
    });
  });
});

describe('S3StorageAdapter — list', () => {
  it('follows continuation tokens across every page', async () => {
    const page = (from: number, count: number, next?: string) => ({
      Contents: Array.from({ length: count }, (_, i) => ({ Key: `k/${from + i}`, Size: from + i })),
      IsTruncated: next !== undefined,
      ...(next !== undefined && { NextContinuationToken: next })
    });
    send
      .mockResolvedValueOnce(page(0, 1000, 't1'))
      .mockResolvedValueOnce(page(1000, 1000, 't2'))
      .mockResolvedValueOnce(page(2000, 5));

    const all = await new S3StorageAdapter(base).list('k/');

    expect(all).toHaveLength(2005);
    expect(all[0]).toEqual({ key: 'k/0', size: 0 });
    expect(all.at(-1)).toEqual({ key: 'k/2004', size: 2004 });
    expect(send).toHaveBeenCalledTimes(3);
    expect(sent(0).input).toMatchObject({ Prefix: 'k/' });
    expect(sent(0).input).not.toHaveProperty('ContinuationToken');
    expect(sent(1).input).toMatchObject({ Prefix: 'k/', ContinuationToken: 't1' });
    expect(sent(2).input).toMatchObject({ ContinuationToken: 't2' });
  });

  it('lists everything without a prefix and tolerates an empty bucket', async () => {
    send.mockResolvedValue({ IsTruncated: false });
    expect(await new S3StorageAdapter(base).list()).toEqual([]);
    expect(sent().input).not.toHaveProperty('Prefix');
  });

  it('never issues per-object HEAD requests', async () => {
    send.mockResolvedValue({
      Contents: [
        { Key: 'a', Size: 1 },
        { Key: 'b', Size: 2 }
      ]
    });
    await new S3StorageAdapter(base).list();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('fails loudly if a truncated page has no continuation token', async () => {
    send.mockResolvedValue({ Contents: [], IsTruncated: true });
    await expect(new S3StorageAdapter(base).list()).rejects.toThrow(/continuation token/);
  });

  it('rejects provider failures rather than returning a partial list', async () => {
    send
      .mockResolvedValueOnce({
        Contents: [{ Key: 'a' }],
        IsTruncated: true,
        NextContinuationToken: 't'
      })
      .mockRejectedValueOnce(awsError('InternalError', 500));
    await expect(new S3StorageAdapter(base).list()).rejects.toMatchObject({
      name: 'InternalError'
    });
  });
});
