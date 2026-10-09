/**
 * Shared harness for the rendered reliability tests (spec 085): a transport whose responses the test
 * settles by hand, router/route fakes, and DOM helpers. Excluded from the published build.
 */
import '@angular/compiler';
import { vi } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import type { ParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { ForgeAuthSession, provideForgeCms } from '@forge-cms/angular';
import type { CollectionMeta, ForgeTransport, ForgeTransportRequest } from '@forge-cms/angular';
import { ForgeContentRefresh } from './content-refresh.js';

let initialised = false;
export function initTestEnvironment(): void {
  if (initialised) return;
  initialised = true;
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
}

export interface PendingCall {
  request: ForgeTransportRequest;
  url: string;
  resolve(body: unknown, status?: number): void;
  /** Settles like a dropped connection. */
  fail(): void;
}

/** Never answers on its own and ignores the abort signal — the worst case for staleness. */
export class ControlledTransport {
  readonly calls: PendingCall[] = [];

  readonly transport: ForgeTransport = (request) =>
    new Promise<Response>((resolve, reject) => {
      this.calls.push({
        request,
        url: request.url,
        resolve: (body, status = 200) =>
          resolve(
            new Response(body === undefined ? null : JSON.stringify(body), {
              status,
              headers: { 'content-type': 'application/json' }
            })
          ),
        fail: () => reject(new TypeError('Failed to fetch'))
      });
    });

  to(fragment: string, method = 'GET'): PendingCall[] {
    return this.calls.filter(
      (call) => call.url.includes(fragment) && call.request.method === method
    );
  }

  last(fragment: string, method = 'GET'): PendingCall {
    const call = this.to(fragment, method).at(-1);
    if (call === undefined) throw new Error(`no ${method} request to ${fragment}`);
    return call;
  }
}

export const POSTS: CollectionMeta = {
  slug: 'posts',
  name: 'Posts',
  description: '',
  drafts: true,
  useAsTitle: 'title',
  fieldDefinitions: [
    { name: 'title', kind: 'text', label: 'Title', required: true },
    { name: 'summary', kind: 'text', label: 'Summary', required: false }
  ]
};

export const PAGES: CollectionMeta = {
  slug: 'pages',
  name: 'Pages',
  description: '',
  drafts: false,
  useAsTitle: 'title',
  fieldDefinitions: [{ name: 'title', kind: 'text', label: 'Title', required: false }]
};

export function listPage(
  collection: string,
  docs: Record<string, unknown>[],
  extra: Record<string, unknown> = {}
): unknown {
  return {
    data: docs,
    meta: {
      collection,
      count: docs.length,
      totalDocs: docs.length,
      page: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPrevPage: false,
      ...extra
    }
  };
}

export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  TestBed.tick();
}

export interface Harness {
  transport: ControlledTransport;
  /** Emits the route's own params (`id`) — the editor reads `collection` off the parent. */
  routeParams: BehaviorSubject<ParamMap>;
  /** Emits the parent route's params (`collection`). */
  parentParams: BehaviorSubject<ParamMap>;
  navigate: ReturnType<typeof vi.fn>;
}

/** Configures TestBed with the transport, a fake router and a fake route. Call in `beforeEach`. */
export function configureHarness(): Harness {
  initTestEnvironment();
  const transport = new ControlledTransport();
  const routeParams = new BehaviorSubject(convertToParamMap({}));
  const parentParams = new BehaviorSubject(convertToParamMap({ collection: 'posts' }));
  const navigate = vi.fn(async () => true);
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideForgeCms({ transport: transport.transport }),
      ForgeContentRefresh,
      { provide: Router, useValue: { navigate } },
      {
        provide: ActivatedRoute,
        // The workspace reads `collection` off its own paramMap; the editor off its parent's.
        useValue: {
          paramMap: routeParams,
          parent: { paramMap: parentParams }
        }
      }
    ]
  });
  return { transport, routeParams, parentParams, navigate };
}

/** A signed-in session as `user`, with the bootstrap `/me` answered. */
export async function signIn(
  transport: ControlledTransport,
  user: { id: string; role: string }
): Promise<ForgeAuthSession> {
  const session = TestBed.inject(ForgeAuthSession);
  transport.last('/api/auth/me').resolve({ data: user });
  await session.ready();
  return session;
}

export async function answer(transport: ControlledTransport, fragment: string, body: unknown) {
  transport.last(fragment).resolve(body);
  await settle();
}

export function q<T extends Element = HTMLElement>(
  fixture: ComponentFixture<unknown>,
  selector: string
): T | null {
  return (fixture.nativeElement as HTMLElement).querySelector<T>(selector);
}

export function qa<T extends Element = HTMLElement>(
  fixture: ComponentFixture<unknown>,
  selector: string
): T[] {
  return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<T>(selector));
}

/** Types into the `<input>` inside the control labelled/identified by `selector`. */
export async function typeInto(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string
): Promise<void> {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
}

export function submitForm(fixture: ComponentFixture<unknown>): void {
  const form = q<HTMLFormElement>(fixture, 'form');
  if (form === null) throw new Error('no form rendered');
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

export function text(fixture: ComponentFixture<unknown>): string {
  return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
}

/**
 * jsdom has no layout, so every element looks hidden and CDK's focus trap finds nothing tabbable.
 * Gives elements a geometry for the duration of a test file (spec 086 accessibility tests).
 */
export function stubLayout(): void {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 10
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 10
  });
  HTMLElement.prototype.getClientRects = function getClientRects() {
    return [{ width: 10, height: 10 }] as unknown as DOMRectList;
  };
}

/** The element that currently has focus. */
export function active(): Element | null {
  return document.activeElement;
}

export const focusables = (root: ParentNode): HTMLElement[] =>
  Array.from(
    root.querySelectorAll<HTMLElement>(
      'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])'
    )
  );

/** Dispatches a keydown for `key` on `target` (bubbling), as the browser would. */
export function press(target: Element, key: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

/** Picks `value` in a native `<select>` the way a user would. */
export async function choose(select: HTMLSelectElement, value: string): Promise<void> {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
}

/** The `<label for>` text naming `control`, or `null` when no label actually points at it. */
export function labelFor(control: Element): string | null {
  const label = Array.from(document.querySelectorAll('label')).find(
    (candidate) => candidate.getAttribute('for') === control.id && control.id !== ''
  );
  return label === undefined ? null : (label.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** The text of the elements `control` points at with `aria-describedby`. */
export function describedBy(control: Element): string {
  return (control.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => (document.getElementById(id)?.textContent ?? '').trim())
    .join(' ');
}
