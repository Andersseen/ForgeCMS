// @vitest-environment jsdom
/**
 * Spec 104 (V2-01): the admin shell's landmarks, skip link, single tab stops and focus after navigation.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideForgeCms } from '@forge-cms/angular';
import { ForgeAdminLayoutComponent } from './layout.component.js';
import { forgeAdminAuthRoutes } from './auth-routes.js';
import * as h from './reliability.test-helpers.js';

@Component({ standalone: true, template: '<h1>Page</h1><button type="button" id="go">Go</button>' })
class Page {}

@Component({
  standalone: true,
  imports: [ForgeAdminLayoutComponent],
  template: '<main><forge-admin-layout /></main>'
})
class HostWithMain {}

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

async function shell(url = '/admin/collections'): Promise<{
  root: HTMLElement;
  harness: RouterTestingHarness;
}> {
  configure([
    {
      path: 'admin',
      component: ForgeAdminLayoutComponent,
      children: [{ path: '**', component: Page }]
    }
  ]);
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await h.settle();
  const root = harness.routeNativeElement as HTMLElement;
  document.body.appendChild(root);
  return { root, harness };
}

describe('admin shell landmarks (spec 104)', () => {
  it('has exactly one main landmark that contains the page, and labelled navigation', async () => {
    const { root } = await shell();
    const mains = root.querySelectorAll('[role="main"], main');
    expect(mains).toHaveLength(1);
    expect(mains[0]?.querySelector('h1')?.textContent).toBe('Page');
    const navs = Array.from(root.querySelectorAll('nav')).map((n) => n.getAttribute('aria-label'));
    expect(navs).toEqual(['Admin', 'Breadcrumb']);
    expect(
      root.querySelector('nav[aria-label="Admin"] a[href="/admin/collections"]')
    ).not.toBeNull();
  });

  it('gives each sidebar entry one Tab stop (its link), not a second one on the item host', async () => {
    const { root } = await shell();
    const items = Array.from(root.querySelectorAll('volt-sidebar-item'));
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.getAttribute('tabindex')).toBe('-1');
      expect(item.querySelectorAll('a')).toHaveLength(1);
    }
  });

  it('marks the current breadcrumb and hides its separators', async () => {
    const { root } = await shell('/admin');
    const current = root.querySelector('nav[aria-label="Breadcrumb"] [aria-current="page"]');
    expect(current?.textContent?.trim()).toBe('Dashboard');
    for (const chevron of Array.from(
      root.querySelectorAll('nav[aria-label="Breadcrumb"] lmn-chevron-right')
    )) {
      expect(chevron.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('starts with a skip link that focuses the main region without leaving the admin', async () => {
    const { root } = await shell();
    const first = root.querySelector('a, button');
    expect(first?.textContent?.trim()).toBe('Skip to main content');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    first?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement?.getAttribute('role')).toBe('main');
  });

  it('renders Exit (and Log in) as one focusable element each', async () => {
    const { root } = await shell();
    for (const label of ['Exit', 'Log in']) {
      const link = Array.from(root.querySelectorAll('a')).find(
        (a) => a.textContent?.trim() === label
      );
      expect(link, label).toBeDefined();
      expect(link?.querySelector('button, a, [tabindex]'), label).toBeNull();
    }
  });

  it('moves lost focus to the main region after an in-shell navigation', async () => {
    const { root, harness } = await shell();
    root.querySelector<HTMLButtonElement>('#go')?.focus();
    await harness.navigateByUrl('/admin/users');
    await h.settle();
    // The page was re-created: the old button is gone, so focus must not be stranded on <body>.
    expect(document.activeElement?.getAttribute('role')).toBe('main');
  });

  it('does not add a second main landmark inside a host <main>', async () => {
    configure([]);
    const fixture = TestBed.createComponent(HostWithMain);
    document.body.appendChild(fixture.nativeElement as HTMLElement);
    fixture.detectChanges();
    await h.settle();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('main')).toHaveLength(1);
    expect(root.querySelectorAll('[role="main"]')).toHaveLength(0);
  });
});

describe('sign-in page landmark (spec 104)', () => {
  it('is the main landmark', async () => {
    configure(forgeAdminAuthRoutes());
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/login');
    await h.settle();
    const root = harness.routeNativeElement as HTMLElement;
    document.body.appendChild(root);
    await h.settle();
    const main = root.querySelector('[role="main"]');
    expect(main?.querySelector('h1')?.textContent).toBe('Sign in');
  });
});
