// @vitest-environment jsdom
/**
 * Spec 086 (roadmap 0.11 / U02): the content list by keyboard — row actions named after their row,
 * a status filter that exposes its selection, and delete focus that survives the row disappearing.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { convertToParamMap } from '@angular/router';
import { ForgeCollectionWorkspaceComponent } from './collection-workspace.component.js';
import * as h from './reliability.test-helpers.js';

let ctx: h.Harness;
beforeAll(() => h.stubLayout());
beforeEach(() => {
  ctx = h.configureHarness();
});
afterEach(() => TestBed.resetTestingModule());

const DOCS = [
  { id: 'd1', title: 'First', _status: 'draft' },
  { id: 'd2', title: 'Second', _status: 'published' }
];

async function open(): Promise<ComponentFixture<ForgeCollectionWorkspaceComponent>> {
  await h.signIn(ctx.transport, { id: 'editor-1', role: 'editor' });
  ctx.routeParams.next(convertToParamMap({ collection: 'posts' }));
  const fixture = TestBed.createComponent(ForgeCollectionWorkspaceComponent);
  await h.settle();
  await h.answer(ctx.transport, '/collections', { data: [h.POSTS, h.PAGES] });
  await h.answer(ctx.transport, '/posts?', h.listPage('posts', DOCS));
  return fixture;
}

const names = (fixture: ComponentFixture<unknown>): string[] =>
  h
    .qa<HTMLButtonElement>(fixture, 'td button, [role="cell"] button')
    .map((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim());

describe('content list', () => {
  it('names every row action after its row, so no two controls share a name', async () => {
    const fixture = await open();
    const labels = names(fixture);
    expect(labels).toEqual(
      expect.arrayContaining([
        'Publish First',
        'Unpublish Second',
        'Edit First',
        'Delete First',
        'Edit Second',
        'Delete Second'
      ])
    );
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('exposes the status filter as pressed buttons in a labelled group, and the search by name', async () => {
    const fixture = await open();
    const group = h.q(fixture, '[role="group"][aria-label="Filter by status"]') as HTMLElement;
    const state = Array.from(group.querySelectorAll('button')).map((b) => [
      b.textContent?.trim(),
      b.getAttribute('aria-pressed')
    ]);
    expect(state).toEqual([
      ['All', 'true'],
      ['Published', 'false'],
      ['Draft', 'false']
    ]);
    group.querySelectorAll('button')[1]?.click();
    await h.settle();
    expect(group.querySelectorAll('button')[1]?.getAttribute('aria-pressed')).toBe('true');
    expect(h.q(fixture, 'input[aria-label="Search Posts"]')).not.toBeNull();
  });
});

describe('delete by keyboard', () => {
  const deleteFirst = (fixture: ComponentFixture<unknown>): HTMLButtonElement =>
    h
      .qa<HTMLButtonElement>(fixture, 'button')
      .find((b) => /^Delete First$/.test((b.textContent ?? '').trim())) as HTMLButtonElement;

  it('Cancel restores focus to the Delete button that opened the dialog', async () => {
    const fixture = await open();
    const trigger = deleteFirst(fixture);
    trigger.focus();
    trigger.click();
    await h.settle();
    const dialog = h.q(fixture, '[role="dialog"]') as HTMLElement;
    expect(dialog.contains(h.active())).toBe(true);
    expect(h.active()?.textContent?.trim()).toBe('Cancel');

    Array.from(dialog.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === 'Cancel')
      ?.click();
    await h.settle();
    expect(h.active()).toBe(trigger);
    expect(ctx.transport.to('/posts/d1', 'DELETE')).toHaveLength(0);
  });

  it('a successful delete removes the trigger, so focus moves to the page heading', async () => {
    const fixture = await open();
    const trigger = deleteFirst(fixture);
    trigger.focus();
    trigger.click();
    await h.settle();
    const dialog = h.q(fixture, '[role="dialog"]') as HTMLElement;
    Array.from(dialog.querySelectorAll('button'))
      .find((b) => /^Delete$/.test(b.textContent?.trim() ?? ''))
      ?.click();
    await h.settle();
    ctx.transport.last('/posts/d1', 'DELETE').resolve(undefined, 204);
    await h.settle();
    await h.answer(ctx.transport, '/posts?', h.listPage('posts', [DOCS[1] as never]));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(trigger.isConnected).toBe(false);
    expect(h.active()?.tagName).toBe('H1');
    expect(h.active()?.isConnected).toBe(true);
  });
});
