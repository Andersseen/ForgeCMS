import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import type { Injector as InjectorType } from '@angular/core';
import { Router } from '@angular/router';
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { CmsApiService } from './api.service.js';
import { forgeAuthGuard } from './auth-guard.js';
import { ForgeAuthSession } from './auth-session.js';
import { FORGE_CMS_CONFIG } from './types.js';
import type { AuthUser } from './types.js';

let respond: () => Response;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

const EDITOR: AuthUser = { id: 'u2', email: 'editor@forgecms.dev', role: 'editor' };

/** Only `createUrlTree` is called by `forgeAuthGuard` — a real `Router` needs a full platform to
 *  construct outside a running app, which this repo's test suites otherwise avoid entirely. */
interface FakeUrlTree {
  commands: unknown[];
  extras: Record<string, unknown> | undefined;
}

function createFakeRouter(): Router {
  const createUrlTree = vi.fn(
    (commands: unknown[], extras?: Record<string, unknown>): FakeUrlTree => ({ commands, extras })
  );
  return { createUrlTree } as unknown as Router;
}

function createInjector(router: Router): InjectorType {
  return Injector.create({
    providers: [
      { provide: FORGE_CMS_CONFIG, useValue: { baseUrl: '/api/v1' } },
      { provide: Router, useValue: router },
      { provide: CmsApiService, useClass: CmsApiService, deps: [] },
      { provide: ForgeAuthSession, useClass: ForgeAuthSession, deps: [] }
    ]
  });
}

function fakeState(url: string): RouterStateSnapshot {
  return { url } as RouterStateSnapshot;
}

const fakeRoute = {} as ActivatedRouteSnapshot;

beforeEach(() => {
  respond = () => new Response(null, { status: 401 });
  vi.stubGlobal('fetch', () => Promise.resolve(respond()));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('forgeAuthGuard', () => {
  it('redirects an anonymous visitor to /admin/login with a returnUrl', async () => {
    const router = createFakeRouter();
    const injector = createInjector(router);

    const result = await runInInjectionContext(injector, () =>
      forgeAuthGuard()(fakeRoute, fakeState('/admin/collections/posts'))
    );

    expect(router.createUrlTree).toHaveBeenCalledWith(['/admin/login'], {
      queryParams: { returnUrl: '/admin/collections/posts' }
    });
    expect(result).not.toBe(true);
  });

  it('honors a custom signInPath', async () => {
    const router = createFakeRouter();
    const injector = createInjector(router);

    await runInInjectionContext(injector, () =>
      forgeAuthGuard({ signInPath: '/signin' })(fakeRoute, fakeState('/admin'))
    );

    expect(router.createUrlTree).toHaveBeenCalledWith(['/signin'], expect.anything());
  });

  it('allows an authenticated user through with no roles restriction', async () => {
    respond = () => jsonResponse({ data: EDITOR });
    const router = createFakeRouter();
    const injector = createInjector(router);
    // Prime the session bootstrap before the guard runs, same as a real app where the layout (or a
    // previous guarded route) has already resolved `ready()`.
    await runInInjectionContext(injector, () => injector.get(ForgeAuthSession).ready());

    const result = await runInInjectionContext(injector, () =>
      forgeAuthGuard()(fakeRoute, fakeState('/admin/collections'))
    );

    expect(result).toBe(true);
    expect(router.createUrlTree).not.toHaveBeenCalled();
  });

  it('redirects an authenticated user lacking the required role to forbiddenPath', async () => {
    respond = () => jsonResponse({ data: EDITOR });
    const router = createFakeRouter();
    const injector = createInjector(router);
    await runInInjectionContext(injector, () => injector.get(ForgeAuthSession).ready());

    const result = await runInInjectionContext(injector, () =>
      forgeAuthGuard({ roles: ['admin'] })(fakeRoute, fakeState('/admin/users'))
    );

    expect(result).not.toBe(true);
    expect(router.createUrlTree).toHaveBeenCalledWith(['/admin']);
  });

  it('waits for the session bootstrap instead of redirecting mid-load', async () => {
    let resolveMe!: (r: Response) => void;
    vi.stubGlobal(
      'fetch',
      () =>
        new Promise<Response>((resolve) => {
          resolveMe = resolve;
        })
    );
    const router = createFakeRouter();
    const injector = createInjector(router);

    const guardPromise = runInInjectionContext(injector, () =>
      forgeAuthGuard()(fakeRoute, fakeState('/admin'))
    );

    resolveMe(jsonResponse({ data: EDITOR }));
    const result = await guardPromise;

    expect(result).toBe(true);
  });
});
