// @vitest-environment jsdom
/**
 * Spec 086 (roadmap 0.11 / U02): the relation picker is operable by keyboard alone — search, reach a
 * result, choose, replace and remove — with accessible names, polite status and safe error text.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import type { CollectionMeta } from '@forge-cms/angular';
import { ForgeRelationPickerComponent } from './relation-picker.component.js';
import * as h from './reliability.test-helpers.js';

const USERS: CollectionMeta = {
  slug: 'users',
  name: 'Users',
  description: '',
  fieldDefinitions: [{ name: 'name', kind: 'text', label: 'Name', required: true }]
};
const JO = { id: 'user-jo-000000001', name: 'Jo' };
const JOAN = { id: 'user-joan-00000002', name: 'Joan' };

let ctx: h.Harness;
beforeAll(() => h.stubLayout());
beforeEach(() => {
  ctx = h.configureHarness();
});
afterEach(() => TestBed.resetTestingModule());

async function openPicker(
  options: { many?: boolean; value?: unknown; label?: string } = {}
): Promise<{ fixture: ComponentFixture<ForgeRelationPickerComponent>; emitted: unknown[] }> {
  const fixture = TestBed.createComponent(ForgeRelationPickerComponent);
  const emitted: unknown[] = [];
  fixture.componentRef.setInput('collection', 'users');
  fixture.componentRef.setInput('inputId', 'author');
  fixture.componentRef.setInput('many', options.many ?? false);
  if (options.label !== undefined) fixture.componentRef.setInput('label', options.label);
  if (options.value !== undefined) fixture.componentRef.setInput('value', options.value);
  // The parent owns the value: feed what the picker emits back in, as the form does.
  fixture.componentInstance.valueChange.subscribe((value) => {
    emitted.push(value);
    fixture.componentRef.setInput('value', value);
  });
  await h.settle();
  await h.answer(ctx.transport, '/collections', { data: [USERS] });
  return { fixture, emitted };
}

const search = async (fixture: ComponentFixture<unknown>, term: string) => {
  const input = h.q<HTMLInputElement>(fixture, 'input#author') as HTMLInputElement;
  input.focus();
  await h.typeInto(input, term);
};
const results = (fixture: ComponentFixture<unknown>) =>
  h.qa<HTMLButtonElement>(fixture, '[data-forge-results] button');
const status = (fixture: ComponentFixture<unknown>) =>
  h.q(fixture, '[role="status"]')?.textContent?.trim();

describe('relation picker, keyboard only', () => {
  it('Enter in the search box never submits the form, and moves to the first result', async () => {
    const { fixture } = await openPicker({ label: 'Author' });
    await search(fixture, 'jo');
    expect(status(fixture)).toBe('Searching…');
    await h.answer(ctx.transport, '/users?', h.listPage('users', [JO, JOAN]));
    expect(status(fixture)).toBe('2 results.');

    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    (h.q(fixture, 'input#author') as HTMLElement).dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(h.active()).toBe(results(fixture)[0]);
  });

  it('Enter pressed before the answer arrives still lands on the first result when it does', async () => {
    const { fixture } = await openPicker({ label: 'Author' });
    await search(fixture, 'jo');
    (h.q(fixture, 'input#author') as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
    expect(h.active()).toBe(h.q(fixture, 'input#author'));
    await h.answer(ctx.transport, '/users?', h.listPage('users', [JO]));
    expect(h.active()).toBe(results(fixture)[0]);
  });

  it('chooses a result with a button activation and focus lands on "Choose another" (single)', async () => {
    const { fixture, emitted } = await openPicker({ label: 'Author' });
    await search(fixture, 'jo');
    await h.answer(ctx.transport, '/users?', h.listPage('users', [JO]));
    results(fixture)[0]?.focus();
    results(fixture)[0]?.click(); // Enter / Space on a focused button
    await h.settle();

    expect(emitted).toEqual([JO.id]);
    expect(h.text(fixture)).toContain('Jo');
    expect(h.q(fixture, 'input#author')).toBeNull(); // replaced by the chip and the replace action
    expect(h.active()?.textContent?.trim()).toMatch(/^Choose another/);
  });

  it('removes the selection with a named button and focus returns to the search box (single)', async () => {
    const { fixture, emitted } = await openPicker({ label: 'Author', value: JO.id });
    const remove = h.q<HTMLButtonElement>(fixture, 'li button') as HTMLButtonElement;
    expect(remove.getAttribute('aria-label')).toMatch(/^Remove .* from Author$/);
    remove.focus();
    remove.click();
    await h.settle();
    expect(emitted).toEqual(['']);
    expect(h.active()).toBe(h.q(fixture, 'input#author'));
  });

  it('"Choose another" lets a single selection be replaced and hands focus to the search box', async () => {
    const { fixture } = await openPicker({ label: 'Author', value: JO.id });
    const choose = h
      .qa<HTMLButtonElement>(fixture, 'button')
      .find((b) => /Choose another/.test(b.textContent ?? ''));
    expect(choose?.textContent).toContain('Author');
    choose?.click();
    await h.settle();
    expect(h.active()).toBe(h.q(fixture, 'input#author'));
  });

  it('many: each chip’s remove names its target, choosing keeps focus in the search box', async () => {
    const { fixture, emitted } = await openPicker({
      many: true,
      label: 'Reviewers',
      value: [JO.id]
    });
    expect(h.q(fixture, 'ul[aria-label="Reviewers selected"]')).not.toBeNull();
    await search(fixture, 'joan');
    await h.answer(ctx.transport, '/users?', h.listPage('users', [JOAN]));
    results(fixture)[0]?.click();
    await h.settle();
    expect(emitted.at(-1)).toEqual([JO.id, JOAN.id]);
    expect(h.active()).toBe(h.q(fixture, 'input#author'));
    const names = h.qa(fixture, 'li button').map((b) => b.getAttribute('aria-label'));
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2); // not two identical "Remove" buttons
  });

  it('names the search box when there is no surrounding label', async () => {
    const { fixture } = await openPicker();
    expect(h.q(fixture, 'input#author')?.getAttribute('aria-label')).toBe('Search users');
  });
});

describe('relation picker status and failures', () => {
  it('says when nothing matched', async () => {
    const { fixture } = await openPicker({ label: 'Author' });
    await search(fixture, 'zzz');
    await h.answer(ctx.transport, '/users?', h.listPage('users', []));
    expect(status(fixture)).toBe('No matches.');
  });

  it('shows a safe message for a failed search, never provider text', async () => {
    const { fixture } = await openPicker({ label: 'Author' });
    await search(fixture, 'jo');
    ctx.transport
      .last('/users?')
      .resolve(
        { error: { code: 'INTERNAL', message: 'SQLITE_ERROR: no such table users_v2' } },
        500
      );
    await h.settle();
    const alert = h.q(fixture, '[role="alert"]');
    expect(alert?.textContent).toBe('Something went wrong on the server. Please try again.');
    expect(h.text(fixture)).not.toContain('SQLITE');
  });

  it('a late answer to an older search cannot replace the newest results', async () => {
    const { fixture } = await openPicker({ label: 'Author' });
    await search(fixture, 'j');
    const first = ctx.transport.last('/users?');
    await search(fixture, 'jo');
    const second = ctx.transport.last('/users?');
    second.resolve(h.listPage('users', [JO]));
    await h.settle();
    first.resolve(h.listPage('users', [JOAN]));
    await h.settle();
    expect(results(fixture).map((b) => b.textContent)).toEqual([expect.stringContaining('Jo')]);
    expect(results(fixture)[0]?.textContent).not.toContain('Joan');
  });
});
