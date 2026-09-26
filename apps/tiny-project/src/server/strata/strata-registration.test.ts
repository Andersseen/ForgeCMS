/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import type { NitroRouter, StrataAnalogRequest } from '@strata-sc/analog';
import strataPlugin from '../plugins/strata';
import { readCloudflareEnv, toForgeRequest } from './forge-request';

describe('Strata registration', () => {
  it('registers GET /api/v1/:collection on the Nitro router it is handed', () => {
    const registered: { path: string; method: string }[] = [];
    const router: NitroRouter = {
      add(path, _handler, method) {
        registered.push({ path, method });
      }
    };

    strataPlugin({ router });

    expect(registered).toEqual([{ path: '/api/v1/:collection', method: 'get' }]);
  });

  it('leaves no file-system route competing for the same URL', () => {
    const fileSystemGetRoutes = Object.keys(import.meta.glob('../routes/api/v1/*.get.ts'));
    expect(fileSystemGetRoutes).toEqual(['../routes/api/v1/collections.get.ts']);
  });
});

describe('toForgeRequest', () => {
  it('keeps the method, the full query string and every header handleList reads', () => {
    const url = new URL('http://localhost/api/v1/posts?status=all&limit=1&title[in]=a,b');
    const headers = new Headers({
      authorization: 'Bearer token',
      cookie: 'forge_session=abc; other=1',
      'accept-language': 'es'
    });
    const request = toForgeRequest({ method: 'GET', url, headers } as StrataAnalogRequest);

    expect(request.method).toBe('GET');
    expect(request.url).toBe(url.href);
    expect(new URL(request.url).searchParams.get('title[in]')).toBe('a,b');
    expect(request.headers.get('authorization')).toBe('Bearer token');
    expect(request.headers.get('cookie')).toBe('forge_session=abc; other=1');
    expect(request.headers.get('accept-language')).toBe('es');
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
