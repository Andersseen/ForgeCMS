// @vitest-environment jsdom
/**
 * Public result transfer in the browser (spec 080, roadmap S02): eligibility, the one-time hydration
 * window, and the C03 resource semantics after a transferred initial value.
 */
import '@angular/compiler';
import { afterEach, describe, expect, it } from 'vitest';
import { PendingTasks, TransferState, provideZonelessChangeDetection, signal } from '@angular/core';
import type { WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { collectionResource, documentResource } from './resources.js';
import type { CollectionRequest } from './resources.js';
import { publicTransferKey } from './transfer.js';
import { provideForgeCms } from './types.js';
import type { ForgeCmsConfig, ForgeTransport } from './types.js';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

const META = {
  collection: 'posts',
  count: 1,
  totalDocs: 1,
  page: 1,
  totalPages: 1,
  hasNextPage: false,
  hasPrevPage: false
};
const page = (docs: unknown[]) => ({ docs, meta: META });

let urls: string[];
let release: (() => void) | undefined;

const transport: ForgeTransport = (request) => {
  urls.push(request.url);
  const body = request.url.includes('/posts/')
    ? { data: { id: 'doc-from-network' } }
    : { data: [{ id: 'from-network' }], meta: META };
  return Promise.resolve(
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
  );
};

/** An app that is still "hydrating": a pending task keeps it unstable until `release()`. */
function setup(config: ForgeCmsConfig = { credentials: 'omit' }, hydrating = true): void {
  urls = [];
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), provideForgeCms({ transport, ...config })]
  });
  if (hydrating) release = TestBed.inject(PendingTasks).add();
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  TestBed.tick();
}

const key = (requestKey: string, kind = 'collection', namespace = '/api/v1') =>
  publicTransferKey(namespace, kind, requestKey);

function transferred(entries: Record<string, unknown>): void {
  const state = TestBed.inject(TransferState);
  for (const [name, value] of Object.entries(entries)) state.set(name as never, value as never);
}

function posts(params: WritableSignal<CollectionRequest | undefined>, transfer = true) {
  const resource = TestBed.runInInjectionContext(() =>
    collectionResource(() => params(), transfer ? { transfer: 'public' } : {})
  );
  TestBed.tick();
  return resource;
}

afterEach(() => {
  release?.();
  release = undefined;
  TestBed.resetTestingModule();
});

describe('publicTransferKey', () => {
  it('separates namespace, kind and request, and never embeds an origin', () => {
    const base = key('posts?limit=1');
    expect(key('posts?limit=1', 'document')).not.toBe(base);
    expect(key('posts?limit=2')).not.toBe(base);
    expect(key('posts?limit=1', 'collection', 'https://cms.example/api/v1')).not.toBe(base);
    expect(base).toBe(key('posts?limit=1'));
  });
});

describe('eligibility — anonymous by construction', () => {
  it('refuses a default (credentialed) client', () => {
    setup({});
    expect(() => posts(signal({ collection: 'posts' }))).toThrow(TypeError);
  });

  it('refuses a client with an authToken, static or function', () => {
    setup({ credentials: 'omit', authToken: 'secret' });
    expect(() => posts(signal({ collection: 'posts' }))).toThrow(/anonymous client/);
    TestBed.resetTestingModule();
    setup({ credentials: 'omit', authToken: () => null });
    expect(() => posts(signal({ collection: 'posts' }))).toThrow(TypeError);
  });

  it('accepts credentials: omit without a token', () => {
    setup();
    expect(() => posts(signal({ collection: 'posts' }))).not.toThrow();
  });
});

describe('initial hydration', () => {
  it('uses the transferred value with zero requests', () => {
    setup();
    transferred({ [key('posts?limit=1')]: page([{ id: 'ssr' }]) });
    const resource = posts(signal({ collection: 'posts', limit: 1 }));
    expect(resource.value()).toEqual(page([{ id: 'ssr' }]));
    expect(resource.isLoading()).toBe(false);
    expect(urls).toEqual([]);
  });

  it('serves several identical resources from the same entry', () => {
    setup();
    transferred({ [key('posts?limit=1')]: page([{ id: 'ssr' }]) });
    const a = posts(signal({ collection: 'posts', limit: 1 }));
    const b = posts(signal({ collection: 'posts', limit: 1 }));
    expect(a.value()?.docs).toEqual([{ id: 'ssr' }]);
    expect(b.value()?.docs).toEqual([{ id: 'ssr' }]);
    expect(urls).toEqual([]);
  });

  it('does not transfer when the resource did not opt in', async () => {
    setup();
    transferred({ [key('posts?limit=1')]: page([{ id: 'ssr' }]) });
    const resource = posts(signal({ collection: 'posts', limit: 1 }), false);
    await settle();
    expect(urls).toEqual(['/api/v1/posts?limit=1']);
    expect(resource.value()?.docs).toEqual([{ id: 'from-network' }]);
  });

  it('never lets one key satisfy another (page, sort, where, depth, id)', async () => {
    setup();
    transferred({ [key('posts?limit=1')]: page([{ id: 'ssr' }]) });
    for (const request of [
      { collection: 'posts', limit: 1, page: 2 },
      { collection: 'posts', limit: 1, sort: 'title' },
      { collection: 'posts', limit: 1, where: { slug: 'x' } },
      { collection: 'posts', limit: 1, depth: 1 as const },
      { collection: 'posts', limit: 1, locale: 'es' },
      { collection: 'pages', limit: 1 }
    ]) {
      posts(signal<CollectionRequest | undefined>(request as unknown as CollectionRequest));
    }
    await settle();
    expect(urls).toHaveLength(6);
  });

  it('after a hit, reload() and key changes are real requests (C03 semantics resume)', async () => {
    setup();
    transferred({ [key('posts?limit=1')]: page([{ id: 'ssr' }]) });
    const params = signal<CollectionRequest | undefined>({ collection: 'posts', limit: 1 });
    const resource = posts(params);
    expect(urls).toEqual([]);

    resource.reload();
    TestBed.tick();
    expect(resource.isLoading()).toBe(true);
    expect(resource.value()?.docs).toEqual([{ id: 'ssr' }]); // same request: kept while reloading
    await settle();
    expect(urls).toEqual(['/api/v1/posts?limit=1']);
    expect(resource.value()?.docs).toEqual([{ id: 'from-network' }]);

    params.set({ collection: 'posts', limit: 2 });
    TestBed.tick();
    expect(resource.value()).toBeUndefined(); // key change resets
    await settle();
    expect(urls).toEqual(['/api/v1/posts?limit=1', '/api/v1/posts?limit=2']);
  });

  it('transfers documents under their own kind and id', async () => {
    setup();
    const k = publicTransferKey('/api/v1', 'document', JSON.stringify(['posts', 'a', 0]));
    transferred({ [k]: { id: 'a', title: 'SSR' } });
    const id = signal('a');
    const resource = TestBed.runInInjectionContext(() =>
      documentResource(() => ({ collection: 'posts', id: id() }), { transfer: 'public' })
    );
    TestBed.tick();
    expect(resource.value()).toEqual({ id: 'a', title: 'SSR' });
    expect(urls).toEqual([]);
    id.set('b');
    TestBed.tick();
    await settle();
    expect(urls).toEqual(['/api/v1/posts/b']);
  });
});

describe('lifetime', () => {
  it('closes when the app is stable: later resources fetch, and Forge entries are removed', async () => {
    setup();
    transferred({ [key('posts?limit=1')]: page([{ id: 'ssr' }]), other: 'kept' });
    posts(signal({ collection: 'posts', limit: 1 }));
    release?.();
    release = undefined;
    await settle();

    const state = TestBed.inject(TransferState);
    expect(state.hasKey(key('posts?limit=1') as never)).toBe(false);
    expect(state.get('other' as never, null as never)).toBe('kept');

    const late = posts(signal({ collection: 'posts', limit: 1 }));
    await settle();
    expect(urls).toEqual(['/api/v1/posts?limit=1']);
    expect(late.value()?.docs).toEqual([{ id: 'from-network' }]);
  });

  it('is not a hydration when the first transfer resource appears on an already stable app', async () => {
    setup({ credentials: 'omit' }, false);
    transferred({ [key('posts?limit=1')]: page([{ id: 'stale' }]) });
    posts(signal({ collection: 'posts', limit: 1 }));
    await settle();
    expect(urls).toEqual(['/api/v1/posts?limit=1']);
  });
});
