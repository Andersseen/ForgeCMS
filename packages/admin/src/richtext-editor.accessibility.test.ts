// @vitest-environment jsdom
/**
 * Spec 086 (roadmap 0.11 / U02): the simple-block richtext editor — every control is named, structural
 * actions keep focus somewhere useful, and a tree it cannot represent stays an explicit, lossless JSON view.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ForgeRichTextEditorComponent } from './richtext-editor.component.js';
import * as h from './reliability.test-helpers.js';

const para = (text: string) => ({ type: 'paragraph', children: [{ type: 'text', text }] });

beforeAll(() => h.stubLayout());
beforeEach(() => {
  h.configureHarness();
});
afterEach(() => TestBed.resetTestingModule());

async function openEditor(
  value: unknown
): Promise<{ fixture: ComponentFixture<ForgeRichTextEditorComponent>; emitted: unknown[] }> {
  const fixture = TestBed.createComponent(ForgeRichTextEditorComponent);
  const emitted: unknown[] = [];
  fixture.componentRef.setInput('label', 'Body');
  fixture.componentRef.setInput('idPrefix', 'body');
  fixture.componentRef.setInput('value', value);
  fixture.componentInstance.valueChange.subscribe((next) => {
    emitted.push(next);
    fixture.componentRef.setInput('value', next);
  });
  await h.settle();
  return { fixture, emitted };
}

const named = (fixture: ComponentFixture<unknown>, name: RegExp): HTMLButtonElement[] =>
  h
    .qa<HTMLButtonElement>(fixture, 'button')
    .filter((b) => name.test((b.textContent ?? '').replace(/\s+/g, ' ').trim()));

describe('block mode', () => {
  it('names every control after its block, never just "↑", "↓" or "Remove"', async () => {
    const { fixture } = await openEditor([para('one'), para('two')]);
    const names = h
      .qa<HTMLButtonElement>(fixture, 'button')
      .map((b) => (b.textContent ?? '').replace(/↑|↓/g, '').replace(/\s+/g, ' ').trim());
    expect(names).toEqual([
      'Move Body block 1 of 2 up',
      'Move Body block 1 of 2 down',
      'Remove Body block 1 of 2',
      'Move Body block 2 of 2 up',
      'Move Body block 2 of 2 down',
      'Remove Body block 2 of 2',
      'Add block to Body'
    ]);
    // The arrows are decoration; the spoken name is the sr-only text.
    expect(
      h.qa(fixture, 'button [aria-hidden="true"]').map((el) => el.textContent?.trim())
    ).toEqual(['↑', '↓', '↑', '↓']);

    for (const id of [
      'body-block-0-type',
      'body-block-1-type',
      'body-block-0-text',
      'body-block-1-text'
    ]) {
      expect(h.labelFor(h.q(fixture, `[id="${id}"]`) as HTMLElement), id).toMatch(
        /^Body block [12] of 2 (type|text)$/
      );
    }
    expect(h.qa(fixture, '[role="group"]').map((g) => g.getAttribute('aria-label'))).toEqual([
      'Body block 1 of 2',
      'Body block 2 of 2'
    ]);
  });

  it('Add focuses the new block’s text', async () => {
    const { fixture, emitted } = await openEditor([para('one')]);
    named(fixture, /^Add block/)[0]?.click();
    await h.settle();
    expect(emitted).toHaveLength(1);
    expect(h.active()).toBe(h.q(fixture, '[id="body-block-1-text"]'));
  });

  it('Remove focuses the neighbouring block, or Add block when none is left', async () => {
    const { fixture } = await openEditor([para('one'), para('two')]);
    named(fixture, /^Remove Body block 1 of 2$/)[0]?.click();
    await h.settle();
    expect(h.active()).toBe(h.q(fixture, '[id="body-block-0-text"]'));
    expect((h.active() as HTMLTextAreaElement).value).toBe('two');

    named(fixture, /^Remove Body block 1 of 1$/)[0]?.click();
    await h.settle();
    expect(h.active()?.textContent?.trim()).toMatch(/^Add block/);
  });

  it('Move keeps focus on the moved block’s move action', async () => {
    const { fixture, emitted } = await openEditor([para('one'), para('two'), para('three')]);
    named(fixture, /Move Body block 2 of 3 down$/)[0]?.click();
    await h.settle();
    expect(
      (emitted.at(-1) as { children: { text: string }[] }[]).map((b) => b.children[0]?.text)
    ).toEqual(['one', 'three', 'two']);
    // The moved block is now last, so "down" is disabled and focus uses "up" of that block.
    expect(h.active()?.textContent).toContain('Move Body block 3 of 3 up');
  });

  it('typing keeps the rest of the tree', async () => {
    const { fixture, emitted } = await openEditor([para('one')]);
    await h.typeInto(h.q(fixture, '[id="body-block-0-text"]') as HTMLInputElement, 'edited');
    expect(emitted.at(-1)).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'edited' }] }
    ]);
  });
});

describe('JSON fallback', () => {
  const complex = [
    {
      type: 'paragraph',
      children: [{ type: 'link', href: '/x', children: [{ type: 'text', text: 'deep' }] }]
    }
  ];

  it('stays explicit, is labelled, and shows the whole tree', async () => {
    const { fixture } = await openEditor(complex);
    const area = h.q<HTMLTextAreaElement>(fixture, 'textarea') as HTMLTextAreaElement;
    expect(h.labelFor(area)).toContain(
      'This document uses nodes the block editor cannot represent'
    );
    expect(h.labelFor(area)).toContain('Body');
    expect(JSON.parse(area.value)).toEqual(complex);
    expect(h.qa(fixture, '[role="group"]')).toHaveLength(0);
  });

  it('keeps intermediate invalid JSON editable and never flattens the tree', async () => {
    const { fixture, emitted } = await openEditor(complex);
    const area = h.q<HTMLTextAreaElement>(fixture, 'textarea') as HTMLTextAreaElement;
    await h.typeInto(area, '[{"type": "para');
    expect(emitted.at(-1)).toBe('[{"type": "para');
    expect((h.q<HTMLTextAreaElement>(fixture, 'textarea') as HTMLTextAreaElement).value).toBe(
      '[{"type": "para'
    );
    await h.typeInto(area, JSON.stringify(complex));
    expect(emitted.at(-1)).toEqual(complex);
  });
});
