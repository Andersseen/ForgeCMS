// Spec 080: public result transfer on a real `platformServer` — what is written to TransferState.
import '@angular/compiler';
import '@angular/platform-server/init';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Component,
  TransferState,
  provideZonelessChangeDetection,
  runInInjectionContext
} from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { INITIAL_CONFIG, platformServer, provideServerRendering } from '@angular/platform-server';
import { collectionResource } from './resources.js';
import { provideForgeCmsServer } from './server-context.js';
import { publicTransferKey } from './transfer.js';
import { provideForgeCms, type ForgeCmsConfig } from './types.js';

const ORIGIN = 'http://cms.internal:3000';
const AWKWARD = '</script><script>alert("x")</script> & \'quotes\' > <b>';
const META = {
  collection: 'posts',
  count: 1,
  totalDocs: 1,
  page: 1,
  totalPages: 1,
  hasNextPage: false,
  hasPrevPage: false
};

let status = 200;
const urls: string[] = [];

beforeEach(() => {
  urls.length = 0;
  status = 200;
  vi.stubGlobal('fetch', (input: string | URL) => {
    urls.push(String(input));
    return Promise.resolve(
      new Response(
        JSON.stringify(
          status === 200
            ? { data: [{ id: 'p1', title: AWKWARD }], meta: META }
            : { error: { code: 'BOOM', message: 'internal diagnostic detail' } }
        ),
        { status, headers: { 'content-type': 'application/json' } }
      )
    );
  });
});
afterEach(() => vi.unstubAllGlobals());

@Component({ selector: 'app-root', template: '' })
class Root {}

async function render(config: ForgeCmsConfig, forwardAuthorization = false, withServer = true) {
  const platform = platformServer([
    { provide: INITIAL_CONFIG, useValue: { document: '<app-root></app-root>', url: '/' } }
  ]);
  const appRef = await bootstrapApplication(
    Root,
    {
      providers: [
        provideZonelessChangeDetection(),
        provideServerRendering(),
        provideForgeCms(config),
        ...(withServer ? provideForgeCmsServer({ origin: ORIGIN, forwardAuthorization }) : [])
      ]
    },
    { platformRef: platform }
  );
  return { appRef, platform, state: appRef.injector.get(TransferState) };
}

const KEY = publicTransferKey('/api/v1', 'collection', 'posts?limit=1');
const make = (appRef: Awaited<ReturnType<typeof render>>['appRef']) =>
  runInInjectionContext(appRef.injector, () =>
    collectionResource(() => ({ collection: 'posts', limit: 1 }), { transfer: 'public' })
  );

async function settle(appRef: { tick(): void }) {
  appRef.tick();
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  appRef.tick();
}

describe('server: what is serialized', () => {
  it('stores the successful value under the logical key — not the absolute origin — escaped by Angular', async () => {
    const { appRef, platform, state } = await render({ credentials: 'omit' });
    make(appRef);
    await settle(appRef);
    expect(urls).toEqual([`${ORIGIN}/api/v1/posts?limit=1`]);
    expect(state.get(KEY as never, null as never)).toEqual({
      docs: [{ id: 'p1', title: AWKWARD }],
      meta: META
    });
    const json = state.toJson();
    expect(json).not.toContain('</script>');
    expect(json).not.toContain(ORIGIN);
    platform.destroy();
  });

  it('never stores an error', async () => {
    status = 500;
    const { appRef, platform, state } = await render({ credentials: 'omit' });
    const resource = make(appRef);
    await settle(appRef);
    expect(resource.error()).not.toBeNull();
    expect(state.isEmpty).toBe(true);
    expect(state.toJson()).not.toContain('diagnostic');
    platform.destroy();
  });

  it('fails closed for a forwarded Authorization or a credentialed client', async () => {
    const forwarding = await render({ credentials: 'omit' }, true);
    expect(() => make(forwarding.appRef)).toThrow(TypeError);
    forwarding.platform.destroy();
    const credentialed = await render({});
    expect(() => make(credentialed.appRef)).toThrow(TypeError);
    credentialed.platform.destroy();
  });

  it('fails closed on a server render without provideForgeCmsServer (identity unknown)', async () => {
    const app = await render({ credentials: 'omit' }, false, false);
    expect(() => make(app.appRef)).toThrow(TypeError);
    app.platform.destroy();
  });

  it('keeps each render’s state separate', async () => {
    const a = await render({ credentials: 'omit' });
    const b = await render({ credentials: 'omit' });
    make(a.appRef);
    await settle(a.appRef);
    expect(a.state.hasKey(KEY as never)).toBe(true);
    expect(b.state.isEmpty).toBe(true);
    a.platform.destroy();
    b.platform.destroy();
  });
});
