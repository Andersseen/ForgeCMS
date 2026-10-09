// @vitest-environment jsdom
/**
 * Spec 087 (roadmap 0.11 / U03): the package components honour a non-default mount root — layout
 * links/breadcrumbs/log-in, sign-in return targets, sign-up landing and config propagation.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideForgeCms } from '@forge-cms/angular';
import { ForgeAdminLayoutComponent } from './layout.component.js';
import { ForgeCollectionsIndexComponent } from './collections-index.component.js';
import { forgeAdminAuthRoutes } from './auth-routes.js';
import { DEFAULT_ADMIN_NAV } from './config.js';
import * as h from './reliability.test-helpers.js';

@Component({ standalone: true, template: 'blank' })
class Blank {}

let transport: h.ControlledTransport;
beforeAll(() => {
  h.stubLayout();
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  })) as unknown as typeof window.matchMedia;
});
beforeEach(() => {
  h.initTestEnvironment();
  transport = new h.ControlledTransport();
});
afterEach(() => TestBed.resetTestingModule());

function configure(routes: Parameters<typeof provideRouter>[0]): void {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter(routes, withComponentInputBinding()),
      provideForgeCms({ transport: transport.transport })
    ]
  });
}

const links = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('a')).map((a) => a.getAttribute('href'));

describe('layout under /studio', () => {
  const config = { title: 'Studio', basePath: '/studio' };
  it('roots default nav, breadcrumbs and Log in at the mount', async () => {
    configure([
      {
        path: 'studio',
        component: ForgeAdminLayoutComponent,
        data: { config },
        children: [{ path: '**', component: Blank }]
      }
    ]);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/studio/collections/posts');
    await h.settle();
    const hrefs = links(harness.routeNativeElement as HTMLElement);
    expect(hrefs).toContain('/studio');
    expect(hrefs).toContain('/studio/collections');
    expect(hrefs).toContain('/studio/login');
    expect(hrefs.filter((href) => href?.startsWith('/admin'))).toEqual([]);
  });

  it('keeps `/studio-evil` out of the Collections breadcrumb and honours a host nav', async () => {
    configure([
      {
        path: 'studio',
        component: ForgeAdminLayoutComponent,
        data: {
          config: {
            ...config,
            nav: [{ items: [{ label: 'Inbox', routerLink: '/studio/inbox' }] }]
          }
        },
        children: [{ path: '**', component: Blank }]
      },
      { path: '**', component: Blank }
    ]);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/studio/inbox');
    await h.settle();
    const hrefs = links(harness.routeNativeElement as HTMLElement);
    expect(hrefs).toContain('/studio/inbox');
    expect(hrefs).not.toContain('/studio/collections');
  });
});

describe('default navigation (spec 087)', () => {
  it('only offers package-owned destinations', () => {
    const items = DEFAULT_ADMIN_NAV.flatMap((group) => group.items);
    expect(items.map((item) => item.routerLink)).toEqual(['/admin/collections', '/admin/users']);
    expect(items.find((item) => item.routerLink === '/admin/users')?.adminOnly).toBe(true);
  });
});

describe('sign-in / sign-up under /studio', () => {
  function mountAuth() {
    configure([
      { path: 'studio', children: forgeAdminAuthRoutes({ signup: true, basePath: '/studio' }) },
      { path: 'studio-home', component: Blank },
      { path: '**', component: Blank }
    ]);
  }

  async function submitSignIn(
    harness: RouterTestingHarness,
    router: Router,
    expectLanding: string
  ): Promise<void> {
    await h.settle();
    transport.last('/api/auth/me').resolve({ error: { code: 'UNAUTHORIZED', message: 'no' } }, 401);
    await h.settle();
    const root = harness.routeNativeElement as HTMLElement;
    await h.typeInto(root.querySelector('input#forge-signin-email') as HTMLInputElement, 'a@b.co');
    await h.typeInto(root.querySelector('input#forge-signin-password') as HTMLInputElement, 'pw');
    root.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await h.settle();
    transport
      .last('/api/auth/login', 'POST')
      .resolve({ data: { token: 't', user: { id: '1', email: 'a@b.co', role: 'admin' } } });
    await h.settle();
    expect(router.url).toBe(expectLanding);
  }

  it('links sign-up inside the mount and lands in /studio without a returnUrl', async () => {
    mountAuth();
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    await harness.navigateByUrl('/studio/login');
    await h.settle();
    expect(links(harness.routeNativeElement as HTMLElement)).toContain('/studio/signup');
    await submitSignIn(harness, router, '/studio');
  });

  it('restores a safe returnUrl and refuses unsafe ones', async () => {
    mountAuth();
    let harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(
      '/studio/login?returnUrl=%2Fstudio%2Fcollections%2Fposts%3Fpage%3D2'
    );
    await submitSignIn(harness, TestBed.inject(Router), '/studio/collections/posts?page=2');

    TestBed.resetTestingModule();
    transport = new h.ControlledTransport();
    mountAuth();
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/studio/login?returnUrl=%2Fadmin%2Fcollections');
    await submitSignIn(harness, TestBed.inject(Router), '/studio');
  });

  it('sign-up lands on the mount root', async () => {
    mountAuth();
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/studio/signup');
    await h.settle();
    transport.last('/api/auth/me').resolve({ error: { code: 'UNAUTHORIZED', message: 'no' } }, 401);
    await h.settle();
    const root = harness.routeNativeElement as HTMLElement;
    await h.typeInto(root.querySelector('input#forge-signup-email') as HTMLInputElement, 'a@b.co');
    await h.typeInto(
      root.querySelector('input#forge-signup-password') as HTMLInputElement,
      'longenough123'
    );
    root.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await h.settle();
    transport
      .last('/api/auth/signup', 'POST')
      .resolve({ data: { token: 't', user: { id: '1', email: 'a@b.co', role: 'viewer' } } });
    await h.settle();
    expect(TestBed.inject(Router).url).toBe('/studio');
  });
});

describe('config propagation (spec 087)', () => {
  it('layout-route data.config reaches the collections index through the real router', async () => {
    configure([
      {
        path: 'studio',
        component: ForgeAdminLayoutComponent,
        data: { config: { basePath: '/studio', collections: [{ slug: 'pages' }] } },
        children: [{ path: 'collections', component: ForgeCollectionsIndexComponent }]
      }
    ]);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/studio/collections');
    await h.settle();
    transport.last('/collections').resolve({ data: [h.POSTS, h.PAGES] });
    await h.settle();
    transport.last('/pages?').resolve(h.listPage('pages', [], { totalDocs: 1 }));
    await h.settle();
    const text = (harness.routeNativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Pages');
    expect(text).not.toContain('Posts');
  });
});
