import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runStorageAdapterContractTests } from '@forge-cms/testing/contracts';
import { S3StorageAdapter } from '../src/index.js';

// Spec 082: real S3 API traffic against the isolated Garage container that `pnpm test:s3`
// (scripts/test-s3.mjs) starts. Missing configuration is a hard failure, never a skip.
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Run these tests through \`pnpm test:s3\`, which starts the Garage service.`
    );
  }
  return value;
}

const endpoint = required('FORGE_S3_TEST_ENDPOINT');
const region = required('FORGE_S3_TEST_REGION');
const bucket = required('FORGE_S3_TEST_BUCKET');
const accessKeyId = required('FORGE_S3_TEST_ACCESS_KEY_ID');
const secretAccessKey = required('FORGE_S3_TEST_SECRET_ACCESS_KEY');

const options = {
  bucket,
  region,
  endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey }
};
const make = () => new S3StorageAdapter(options);
const text = (body: ArrayBuffer | undefined) => new TextDecoder().decode(body);

// Garage needs a moment after the port opens before the default bucket/key are usable.
beforeAll(async () => {
  let last: unknown;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await make().list(`readiness-${crypto.randomUUID()}/`);
      return;
    } catch (err) {
      last = err;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw last;
});

runStorageAdapterContractTests(make);

describe('S3StorageAdapter — real S3-compatible service (Garage)', () => {
  const ns = `focused-${crypto.randomUUID()}`;
  const created: string[] = [];
  const put = async (key: string, body: Uint8Array, extra: { contentType?: string } = {}) => {
    created.push(key);
    return make().put({ key, body, ...extra });
  };

  afterAll(async () => {
    const adapter = make();
    for (const key of created) await adapter.delete(key);
    const leftovers = await adapter.list(`${ns}/`);
    expect(leftovers).toEqual([]);
  });

  it('uses the configured custom endpoint with path-style addressing', async () => {
    const key = `${ns}/endpoint.txt`;
    await put(key, new TextEncoder().encode('endpoint'));
    // A raw signed-less GET on the path-style URL must reach this very bucket (and be refused: auth).
    const res = await fetch(`${endpoint}/${bucket}/${key}`);
    expect(res.status).toBe(403);
    expect(text((await make().get(key))?.body)).toBe('endpoint');
  });

  it('rejects wrong credentials instead of treating the object as missing', async () => {
    const bad = new S3StorageAdapter({
      ...options,
      credentials: { accessKeyId, secretAccessKey: 'not-the-secret'.padEnd(64, '0') }
    });
    const err = (await bad.get(`${ns}/anything`).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).not.toContain(secretAccessKey);
    expect(err.message).not.toContain('not-the-secret');
    await expect(bad.list()).rejects.toBeInstanceOf(Error);
  });

  it('rejects a missing bucket instead of returning null', async () => {
    const wrong = new S3StorageAdapter({ ...options, bucket: `no-such-${crypto.randomUUID()}` });
    await expect(wrong.get('k')).rejects.toBeInstanceOf(Error);
    await expect(wrong.list()).rejects.toBeInstanceOf(Error);
  });

  it('rejects an unreachable endpoint instead of returning null', async () => {
    const down = new S3StorageAdapter({ ...options, endpoint: 'http://127.0.0.1:1' });
    await expect(down.get('k')).rejects.toBeInstanceOf(Error);
  });

  it('keeps empty and non-text bytes exact', async () => {
    const binary = Uint8Array.from({ length: 2048 }, (_, i) => (i * 7) % 256);
    await put(`${ns}/binary.bin`, binary, { contentType: 'application/octet-stream' });
    await put(`${ns}/empty.bin`, new Uint8Array(0));
    const got = await make().get(`${ns}/binary.bin`);
    expect(Array.from(new Uint8Array(got!.body!))).toEqual(Array.from(binary));
    expect(got?.contentType).toBe('application/octet-stream');
    expect((await make().get(`${ns}/empty.bin`))?.body?.byteLength).toBe(0);
  });

  it('round-trips metadata with S3 semantics (keys lowercased)', async () => {
    const key = `${ns}/meta.txt`;
    created.push(key);
    await make().put({
      key,
      body: new Uint8Array([1]),
      contentType: 'text/plain',
      metadata: { Origin: 'forge', collection: 'media' }
    });
    const got = await make().get(key);
    expect(got?.metadata).toEqual({ origin: 'forge', collection: 'media' });
  });

  it('lists by prefix with sizes and no cross-prefix leakage', async () => {
    await put(`${ns}/list/a.txt`, new Uint8Array(3));
    await put(`${ns}/list/sub/b.txt`, new Uint8Array(4));
    await put(`${ns}/listing-other.txt`, new Uint8Array(1));
    const listed = await make().list(`${ns}/list/`);
    expect(listed.map((o) => [o.key, o.size]).sort()).toEqual([
      [`${ns}/list/a.txt`, 3],
      [`${ns}/list/sub/b.txt`, 4]
    ]);
  });

  it('lists many real objects completely (multi-page mechanics are pinned in the unit suite)', async () => {
    const adapter = make();
    const keys = Array.from({ length: 25 }, (_, i) => `${ns}/many/${String(i).padStart(3, '0')}`);
    await Promise.all(keys.map((key) => put(key, new Uint8Array([1]))));
    const listed = await adapter.list(`${ns}/many/`);
    expect(listed.map((o) => o.key).sort()).toEqual(keys);
  });

  it.each([
    'media/id-my photo.png',
    'media/id-日本語 résumé.pdf',
    'media/id-a#b?c%d&e=f+g.txt',
    'media/id-percent%20literal.txt'
  ])('stores %s and serves it through a URL that decodes to the same key', async (key) => {
    const full = `${ns}/${key}`;
    await put(full, new TextEncoder().encode(key));
    expect(text((await make().get(full))?.body)).toBe(key);
    const url = new URL(await make().getPublicUrl(full), 'http://forge.test');
    expect(url.search + url.hash).toBe('');
    // What handleFile does with the route param:
    const routeParam = url.pathname.slice('/api/media/'.length);
    expect(decodeURIComponent(routeParam)).toBe(full);
    expect(text((await make().get(decodeURIComponent(routeParam)))?.body)).toBe(key);
  });
});
