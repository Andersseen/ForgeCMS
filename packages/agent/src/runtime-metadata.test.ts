import { describe, expect, it } from 'vitest';
import { fetchRuntimeMetadata, parseOrigin } from './runtime-metadata.js';

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), init);

describe('parseOrigin', () => {
  it('accepts http(s) origins and drops any path/query', () => {
    expect(parseOrigin('http://localhost:4200/x?y=1').href).toBe('http://localhost:4200/');
    expect(parseOrigin('https://site.example').origin).toBe('https://site.example');
  });
  it('rejects non-URLs, other protocols and credentials', () => {
    expect(() => parseOrigin('not a url')).toThrow(/absolute http/);
    expect(() => parseOrigin('file:///etc/passwd')).toThrow(/http or https/);
    expect(() => parseOrigin('ftp://x')).toThrow(/http or https/);
    expect(() => parseOrigin('http://user:pass@localhost')).toThrow(/credentials/);
    expect(() => parseOrigin('http://user@localhost')).toThrow(/credentials/);
  });
});

describe('fetchRuntimeMetadata', () => {
  it('reads anonymous GET metadata, sanitized and bounded', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const result = await fetchRuntimeMetadata('http://localhost:4200', (async (
      url: URL,
      init: RequestInit
    ) => {
      seen = { url: String(url), init };
      return json({
        data: [
          {
            slug: 'posts',
            label: 'Posts',
            fields: [
              { name: 'title', type: 'text', localized: true },
              { name: 'body', type: 'richText' },
              'garbage'
            ]
          },
          'junk',
          { slug: 5, fields: 'nope' }
        ]
      });
    }) as unknown as typeof fetch);
    expect(seen?.url).toBe('http://localhost:4200/api/v1/collections');
    expect(seen?.init).toMatchObject({ method: 'GET', redirect: 'error', credentials: 'omit' });
    expect(result.origin).toBe('http://localhost:4200');
    expect(result.collections[0]).toEqual({
      slug: 'posts',
      label: 'Posts',
      fields: [
        { name: 'title', type: 'text', localized: true },
        { name: 'body', type: 'richText' },
        { name: '', type: '' }
      ]
    });
    expect(result.collections).toHaveLength(3);
    expect(result.collections[2]?.fields).toEqual([]);
  });

  it('treats a missing data array as no collections', async () => {
    const result = await fetchRuntimeMetadata('http://x.test', (async () =>
      json({})) as unknown as typeof fetch);
    expect(result.collections).toEqual([]);
  });

  it('turns every failure into one clear, bounded message', async () => {
    const failing = (impl: () => Promise<Response>) =>
      fetchRuntimeMetadata('http://x.test', impl as unknown as typeof fetch);
    await expect(failing(async () => json({}, { status: 503 }))).rejects.toThrow(/HTTP 503/);
    await expect(failing(async () => json('x'.repeat(600 * 1024)))).rejects.toThrow(/too large/);
    await expect(failing(async () => json('<html>'))).rejects.toThrow(
      /Could not read runtime metadata/
    );
    await expect(
      failing(async () => {
        throw new Error('connect ECONNREFUSED');
      })
    ).rejects.toThrow(/ECONNREFUSED/);
    await expect(
      failing(async () => {
        throw 'weird';
      })
    ).rejects.toThrow(/request failed/);
    await expect(
      failing(async () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      })
    ).rejects.toThrow(/timed out/);
  });
});
