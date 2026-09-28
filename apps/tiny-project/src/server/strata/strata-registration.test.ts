/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import type { NitroRouter, StrataAnalogRequest } from '@strata-sc/analog';
import strataPlugin from '../plugins/strata';
import { createForgeReadContext, readCloudflareEnv } from './forge-read-context';

describe('Strata registration', () => {
  it('registers the two read routes, and only GETs, on the Nitro router it is handed', () => {
    const registered: { path: string; method: string }[] = [];
    const router: NitroRouter = {
      add(path, _handler, method) {
        registered.push({ path, method });
      }
    };

    strataPlugin({ router });

    expect(registered).toEqual([
      { path: '/api/v1/:collection', method: 'get' },
      { path: '/api/v1/:collection/:id', method: 'get' }
    ]);
  });

  it('leaves no file-system GET route competing for the same URLs; mutations stay H3', () => {
    const fileSystemRoutes = Object.keys(import.meta.glob('../routes/api/v1/**/*.ts')).sort();
    expect(fileSystemRoutes).toEqual([
      '../routes/api/v1/[collection].post.ts',
      '../routes/api/v1/[collection]/[id].delete.ts',
      '../routes/api/v1/[collection]/[id].put.ts',
      '../routes/api/v1/collections.get.ts'
    ]);
  });
});

function strataRequest(
  method: string,
  url: string,
  headers: HeadersInit = {}
): StrataAnalogRequest {
  const parsed = new URL(url);
  return {
    method,
    url: parsed,
    path: parsed.pathname,
    headers: new Headers(headers),
    params: {},
    query: {},
    context: {}
  } as unknown as StrataAnalogRequest;
}

describe('createForgeReadContext', () => {
  it('keeps the method, the full query string, every header the read handlers use, and params', () => {
    const context = createForgeReadContext(
      strataRequest('GET', 'http://localhost/api/v1/posts?status=all&limit=1&title[in]=a,b', {
        authorization: 'Bearer token',
        cookie: 'forge_session=abc; other=1',
        'accept-language': 'es'
      }),
      { collection: 'posts', id: 'p1' }
    );

    expect(context.request.method).toBe('GET');
    expect(new URL(context.request.url).searchParams.get('title[in]')).toBe('a,b');
    expect(context.request.headers.get('authorization')).toBe('Bearer token');
    expect(context.request.headers.get('cookie')).toBe('forge_session=abc; other=1');
    expect(context.request.headers.get('accept-language')).toBe('es');
    expect(context.params).toEqual({ collection: 'posts', id: 'p1' });
    expect(context.env).toBeUndefined();
  });

  it('refuses anything but a bodyless read, so it cannot back a mutating route by accident', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(() =>
        createForgeReadContext(strataRequest(method, 'http://localhost/api/v1/posts'), {})
      ).toThrow(/read-only/);
    }
  });
});

describe('readCloudflareEnv', () => {
  it('reads event.context.cloudflare.env from the Strata context snapshot', () => {
    const env = { AUTH_SECRET: 'secret' };
    expect(readCloudflareEnv({ cloudflare: { env } })).toBe(env);
  });

  it('is undefined off Cloudflare, like event.context.cloudflare?.env', () => {
    expect(readCloudflareEnv({})).toBeUndefined();
    expect(readCloudflareEnv({ cloudflare: null })).toBeUndefined();
    expect(readCloudflareEnv({ cloudflare: {} })).toBeUndefined();
  });
});
