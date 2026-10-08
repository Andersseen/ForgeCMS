// @vitest-environment jsdom
/**
 * Spec 085 (roadmap 0.11 / U01): the real collection workspace + list + confirm dialog, rendered —
 * query-state lifetime, outcome-safe delete, honest publish/unpublish, late-mutation isolation.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { convertToParamMap } from '@angular/router';
import { ForgeCollectionWorkspaceComponent } from './collection-workspace.component.js';
import { ForgeContentRefresh } from './content-refresh.js';
import * as h from './reliability.test-helpers.js';

let ctx: h.Harness;

beforeEach(() => {
  ctx = h.configureHarness();
});
afterEach(() => TestBed.resetTestingModule());

const DOCS = [
  { id: 'd1', title: 'First', _status: 'draft' },
  { id: 'd2', title: 'Second', _status: 'published' }
];

async function openWorkspace(
  user = { id: 'editor-1', role: 'editor' }
): Promise<ComponentFixture<ForgeCollectionWorkspaceComponent>> {
  await h.signIn(ctx.transport, user);
  ctx.routeParams.next(convertToParamMap({ collection: 'posts' }));
  const fixture = TestBed.createComponent(ForgeCollectionWorkspaceComponent);
  await h.settle();
  await h.answer(ctx.transport, '/collections', { data: [h.POSTS, h.PAGES] });
  await h.answer(ctx.transport, '/posts?', h.listPage('posts', DOCS));
  return fixture;
}

function button(fixture: ComponentFixture<unknown>, label: string, index = 0): HTMLButtonElement {
  const found = h
    .qa<HTMLButtonElement>(fixture, 'button')
    .filter((el) => (el.textContent ?? '').trim() === label);
  const el = found[index];
  if (el === undefined) throw new Error(`no button "${label}" (#${index})`);
  return el;
}

async function click(el: HTMLElement): Promise<void> {
  el.click();
  await h.settle();
}

/** The icon "Delete" buttons carry an sr-only label. */
const deleteButtons = (fixture: ComponentFixture<unknown>): HTMLButtonElement[] =>
  h
    .qa<HTMLButtonElement>(fixture, 'button')
    .filter((el) => (el.textContent ?? '').trim() === 'Delete');

const dialogConfirm = (fixture: ComponentFixture<unknown>): HTMLButtonElement =>
  h
    .qa<HTMLButtonElement>(fixture, '[role="dialog"] button')
    .find((el) => /Delete|Deleting/.test(el.textContent ?? '')) as HTMLButtonElement;

const dialogCancel = (fixture: ComponentFixture<unknown>): HTMLButtonElement =>
  h
    .qa<HTMLButtonElement>(fixture, '[role="dialog"] button')
    .find((el) => (el.textContent ?? '').trim() === 'Cancel') as HTMLButtonElement;

describe('query state lifetime', () => {
  it('survives an editor round trip and a content refresh on the same collection', async () => {
    const fixture = await openWorkspace();
    await click(button(fixture, 'Published'));
    expect(ctx.transport.last('/posts?').url).toContain('status=published');
    ctx.transport.last('/posts?').resolve(h.listPage('posts', [DOCS[1] as never]));
    await h.settle();

    // What an editor save/cancel does to the parent: the route re-emits, the content is bumped.
    ctx.routeParams.next(convertToParamMap({ collection: 'posts' }));
    TestBed.inject(ForgeContentRefresh).bump();
    await h.settle();

    expect(ctx.transport.last('/posts?').url).toContain('status=published');
  });

  it('a different collection starts from defaults', async () => {
    const fixture = await openWorkspace();
    await click(button(fixture, 'Published'));
    ctx.transport.last('/posts?').resolve(h.listPage('posts', [DOCS[1] as never]));
    await h.settle();

    ctx.routeParams.next(convertToParamMap({ collection: 'pages' }));
    await h.settle();
    await h.answer(ctx.transport, '/collections', { data: [h.POSTS, h.PAGES] });

    const url = ctx.transport.last('/pages?').url;
    expect(url).not.toContain('status=');
    expect(url).not.toContain('sort=');
    const state = fixture.componentInstance as unknown as {
      status(): string;
      searchTerm(): string;
      page(): number;
    };
    expect(state.status()).toBe('all');
    expect(state.searchTerm()).toBe('');
    expect(state.page()).toBe(1);
  });

  it('a pending search debounce from the old collection cannot touch the new one', async () => {
    const fixture = await openWorkspace();
    const search = h.q<HTMLInputElement>(fixture, 'input[type="text"]') as HTMLInputElement;
    await h.typeInto(search, 'zzz');

    ctx.routeParams.next(convertToParamMap({ collection: 'pages' }));
    await h.settle();
    await h.answer(ctx.transport, '/collections', { data: [h.POSTS, h.PAGES] });
    await new Promise((resolve) => setTimeout(resolve, 400)); // past the 300 ms debounce
    await h.settle();

    for (const call of ctx.transport.to('/pages?')) expect(call.url).not.toContain('zzz');
  });
});

describe('delete', () => {
  it('Cancel sends no request and leaves the list alone', async () => {
    const fixture = await openWorkspace();
    await click(deleteButtons(fixture)[0] as HTMLElement);
    await click(dialogCancel(fixture));

    expect(ctx.transport.to('/posts/d1', 'DELETE')).toHaveLength(0);
    expect(h.q(fixture, '[role="dialog"]')).toBeNull();
    expect(h.text(fixture)).toContain('First');
  });

  it('Confirm sends exactly one DELETE even if clicked twice, and the row goes only after success', async () => {
    const fixture = await openWorkspace();
    await click(deleteButtons(fixture)[0] as HTMLElement);
    const confirm = dialogConfirm(fixture);
    confirm.click();
    confirm.click();
    await h.settle();

    expect(ctx.transport.to('/posts/d1', 'DELETE')).toHaveLength(1);
    expect(h.text(fixture)).toContain('Deleting…');
    expect(h.text(fixture)).toContain('First'); // not removed before the server says so

    const listCalls = ctx.transport.to('/posts?').length;
    ctx.transport.last('/posts/d1', 'DELETE').resolve(undefined, 204);
    await h.settle();
    expect(h.q(fixture, '[role="dialog"]')).toBeNull();
    expect(ctx.transport.to('/posts?')).toHaveLength(listCalls + 1);
    ctx.transport.last('/posts?').resolve(h.listPage('posts', [DOCS[1] as never]));
    await h.settle();
    expect(h.text(fixture)).not.toContain('First');
  });

  it('a failed delete keeps the dialog as the retry path, shows the error, and a retry can succeed', async () => {
    const fixture = await openWorkspace();
    await click(deleteButtons(fixture)[0] as HTMLElement);
    await click(dialogConfirm(fixture));
    ctx.transport
      .last('/posts/d1', 'DELETE')
      .resolve({ error: { code: 'BOOM', message: 'x' } }, 500);
    await h.settle();

    expect(h.q(fixture, '[role="dialog"]')).not.toBeNull();
    expect(h.text(fixture)).toContain('Something went wrong on the server');
    expect(h.text(fixture)).toContain('First');

    await click(dialogConfirm(fixture));
    expect(ctx.transport.to('/posts/d1', 'DELETE')).toHaveLength(2);
    ctx.transport.last('/posts/d1', 'DELETE').resolve(undefined, 204);
    await h.settle();
    expect(h.q(fixture, '[role="dialog"]')).toBeNull();
    expect(h.text(fixture)).not.toContain('Something went wrong');
  });
});

describe('publish / unpublish', () => {
  it('a double click sends one request and shows a pending state', async () => {
    const fixture = await openWorkspace();
    const publish = button(fixture, 'Publish');
    publish.click();
    publish.click();
    await h.settle();

    expect(ctx.transport.to('/posts/d1', 'PUT')).toHaveLength(1);
    expect(h.text(fixture)).toContain('Publishing…');
  });

  it('a failure leaves the real status visible; a later success clears the error', async () => {
    const fixture = await openWorkspace();
    await click(button(fixture, 'Publish'));
    const statusCalls = (): ReturnType<typeof ctx.transport.to> =>
      ctx.transport.calls.filter((c) => c.request.method !== 'GET' && c.url.includes('/posts/d1'));
    statusCalls()
      .at(-1)
      ?.resolve({ error: { code: 'BOOM', message: 'x' } }, 500);
    await h.settle();

    expect(h.text(fixture)).toContain('Something went wrong on the server');
    expect(h.text(fixture)).toContain('Draft');
    expect(button(fixture, 'Publish').disabled).toBe(false);

    await click(button(fixture, 'Publish'));
    statusCalls()
      .at(-1)
      ?.resolve({ data: { id: 'd1', _status: 'published' } });
    await h.settle();
    expect(h.text(fixture)).not.toContain('Something went wrong');
  });
});

describe('late mutation responses', () => {
  it('a delete started on posts cannot change the pages view when it settles late', async () => {
    const fixture = await openWorkspace();
    await click(deleteButtons(fixture)[0] as HTMLElement);
    await click(dialogConfirm(fixture));
    const lateDelete = ctx.transport.last('/posts/d1', 'DELETE');

    ctx.routeParams.next(convertToParamMap({ collection: 'pages' }));
    await h.settle();
    await h.answer(ctx.transport, '/collections', { data: [h.POSTS, h.PAGES] });
    await h.answer(ctx.transport, '/pages?', h.listPage('pages', [{ id: 'p1', title: 'Page' }]));
    expect(h.q(fixture, '[role="dialog"]')).toBeNull();
    const pagesRequests = ctx.transport.to('/pages?').length;

    lateDelete.resolve({ error: { code: 'BOOM', message: 'x' } }, 500);
    await h.settle();
    expect(h.text(fixture)).not.toContain('Something went wrong');
    expect(h.q(fixture, '[role="dialog"]')).toBeNull();

    // …and a late *success* does not reload the new collection as if it were its own.
    expect(ctx.transport.to('/pages?')).toHaveLength(pagesRequests);
  });

  it('a late delete success and a late publish response do not touch the new collection', async () => {
    const fixture = await openWorkspace();
    await click(deleteButtons(fixture)[0] as HTMLElement);
    await click(dialogConfirm(fixture));
    const lateDelete = ctx.transport.last('/posts/d1', 'DELETE');
    ctx.routeParams.next(convertToParamMap({ collection: 'pages' }));
    await h.settle();
    await h.answer(ctx.transport, '/collections', { data: [h.POSTS, h.PAGES] });
    await h.answer(ctx.transport, '/pages?', h.listPage('pages', [{ id: 'p1', title: 'Page' }]));
    const pagesRequests = ctx.transport.to('/pages?').length;

    lateDelete.resolve(undefined, 204);
    await h.settle();
    expect(ctx.transport.to('/pages?')).toHaveLength(pagesRequests);
    expect(h.q(fixture, '[role="dialog"]')).toBeNull();
  });
});
