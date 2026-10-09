// @vitest-environment jsdom
/**
 * Spec 086 (roadmap 0.11 / U02): composite fields, dates and locales through the real form —
 * identities, composite errors, minRows/maxRows, unknown stored blocks, and what is submitted.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import type { FieldMeta } from '@forge-cms/angular';
import { ForgeCollectionFormComponent } from './collection-form.component.js';
import * as h from './reliability.test-helpers.js';

const STEP: FieldMeta[] = [{ name: 'label', kind: 'text', label: 'Label', required: false }];

const FIELDS: FieldMeta[] = [
  {
    name: 'steps',
    kind: 'array',
    label: 'Steps',
    required: false,
    minRows: 1,
    maxRows: 2,
    fields: STEP
  },
  {
    name: 'sections',
    kind: 'blocks',
    label: 'Sections',
    required: false,
    minRows: 1,
    maxRows: 2,
    blocks: [
      {
        slug: 'hero',
        label: 'Hero',
        fields: [{ name: 'heading', kind: 'text', label: 'Heading', required: false }]
      },
      {
        slug: 'cta',
        label: 'Call to action',
        fields: [{ name: 'text', kind: 'text', label: 'Text', required: false }]
      }
    ]
  },
  { name: 'when', kind: 'date', label: 'Day', required: false },
  { name: 'startsAt', kind: 'date', label: 'Starts at', required: false, withTime: true },
  { name: 'headline', kind: 'text', label: 'Headline', required: false, localized: true },
  { name: 'abstract', kind: 'textarea', label: 'Abstract', required: false, localized: true }
];

let saved: Record<string, unknown> | undefined;
beforeAll(() => h.stubLayout());
beforeEach(() => {
  h.configureHarness();
  saved = undefined;
});
afterEach(() => TestBed.resetTestingModule());

async function openForm(
  initialValue: Record<string, unknown>
): Promise<ComponentFixture<ForgeCollectionFormComponent>> {
  const fixture = TestBed.createComponent(ForgeCollectionFormComponent);
  fixture.componentRef.setInput('fields', FIELDS);
  fixture.componentRef.setInput('initialValue', initialValue);
  fixture.componentRef.setInput('locales', ['en', 'es']);
  fixture.componentInstance.save.subscribe((value) => (saved = value));
  await h.settle();
  return fixture;
}

const submit = async (fixture: ComponentFixture<unknown>): Promise<Record<string, unknown>> => {
  h.submitForm(fixture);
  await h.settle();
  if (saved === undefined) throw new Error('nothing was submitted');
  return saved;
};

const button = (fixture: ComponentFixture<unknown>, name: RegExp): HTMLButtonElement =>
  h
    .qa<HTMLButtonElement>(fixture, 'button')
    .find((b) => name.test((b.textContent ?? '').trim())) as HTMLButtonElement;
const buttons = (fixture: ComponentFixture<unknown>, name: RegExp): HTMLButtonElement[] =>
  h.qa<HTMLButtonElement>(fixture, 'button').filter((b) => name.test((b.textContent ?? '').trim()));
const control = (fixture: ComponentFixture<unknown>, id: string): HTMLElement =>
  h.q(fixture, `[id="${id}"]`) as HTMLElement;

describe('arrays and blocks expose identity', () => {
  it('each row is a named group with its position, and its Remove names the row', async () => {
    const fixture = await openForm({
      steps: [{ label: 'a' }, { label: 'b' }],
      sections: [{ blockType: 'hero', heading: 'H' }]
    });
    const groups = h
      .qa(fixture, '[role="group"][aria-label]')
      .map((g) => g.getAttribute('aria-label'));
    expect(groups).toContain('Steps row 1 of 2');
    expect(groups).toContain('Steps row 2 of 2');
    expect(groups).toContain('Hero block 1 of 1');
    expect(buttons(fixture, /^Remove Steps row 2 of 2$/)).toHaveLength(1);
    expect(buttons(fixture, /^Remove Hero block 1 of 1$/)).toHaveLength(1);
    // Add controls are tied to their composite, and the block-type picker is named.
    expect(buttons(fixture, /^Add row to Steps$/)).toHaveLength(1);
    expect(buttons(fixture, /^Add block to Sections$/)).toHaveLength(1);
    expect(h.q(fixture, 'select[aria-label="Block type to add to Sections"]')).not.toBeNull();
  });

  it('renders a composite-level error with its fieldset, once, associated programmatically', async () => {
    const fixture = await openForm({ steps: [{ label: 'a' }], sections: [{ blockType: 'hero' }] });
    fixture.componentRef.setInput('fieldErrors', {
      steps: 'Add at least one step',
      sections: 'Needs a hero'
    });
    await h.settle();
    for (const [id, message] of [
      ['steps', 'Add at least one step'],
      ['sections', 'Needs a hero']
    ] as const) {
      const group = control(fixture, id);
      expect(group.tagName).toBe('FIELDSET');
      expect(h.describedBy(group)).toBe(message);
      expect((group.textContent ?? '').split(message)).toHaveLength(2); // shown exactly once
    }
    expect(h.text(fixture)).not.toContain('undefined');
  });
});

describe('rows address themselves, not their first field', () => {
  it('editing the second row changes the second row, under its own path and id', async () => {
    const fixture = await openForm({
      steps: [{ label: 'a' }, { label: 'b' }],
      sections: [
        { blockType: 'hero', heading: 'H1' },
        { blockType: 'cta', text: 'T2' }
      ]
    });
    expect(control(fixture, 'steps.1.label')).not.toBeNull();
    expect(control(fixture, 'sections.1.text')).not.toBeNull();
    const ids = h.qa(fixture, '[id]').map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);

    await h.typeInto(control(fixture, 'steps.1.label') as HTMLInputElement, 'B!');
    await h.typeInto(control(fixture, 'sections.1.text') as HTMLInputElement, 'T2!');
    const payload = await submit(fixture);
    expect(payload['steps']).toEqual([{ label: 'a' }, { label: 'B!' }]);
    expect(payload['sections']).toEqual([
      { blockType: 'hero', heading: 'H1' },
      { blockType: 'cta', text: 'T2!' }
    ]);
  });

  it('a nested error reaches the right row', async () => {
    const fixture = await openForm({
      steps: [{ label: 'a' }, { label: 'b' }],
      sections: [{ blockType: 'hero' }]
    });
    fixture.componentRef.setInput('fieldErrors', { 'steps.1.label': 'Too short' });
    await h.settle();
    expect(control(fixture, 'steps.1.label').getAttribute('aria-invalid')).toBe('true');
    expect(control(fixture, 'steps.0.label').getAttribute('aria-invalid')).toBeNull();
    expect(h.active()).toBe(control(fixture, 'steps.1.label'));
  });
});

describe('minRows / maxRows', () => {
  it('at minRows nothing is removable; above it removal works; the payload follows', async () => {
    const fixture = await openForm({
      steps: [{ label: 'a' }, { label: 'b' }],
      sections: [{ blockType: 'hero' }, { blockType: 'cta' }]
    });
    expect(buttons(fixture, /^Remove Steps/).every((b) => !b.disabled)).toBe(true);
    buttons(fixture, /^Remove Steps row 1 of 2$/)[0]?.click();
    await h.settle();

    // One row left == minRows: the remaining Remove is unavailable, and the reason is on screen.
    const [onlyRemove] = buttons(fixture, /^Remove Steps/);
    expect(onlyRemove?.disabled).toBe(true);
    expect(h.text(fixture)).toContain('At least 1 row required.');
    onlyRemove?.click();
    await h.settle();
    expect((await submit(fixture))['steps']).toEqual([{ label: 'b' }]);
  });

  it('blocks honour minRows too', async () => {
    const fixture = await openForm({
      steps: [{ label: 'a' }],
      sections: [{ blockType: 'hero', heading: 'x' }]
    });
    const remove = buttons(fixture, /^Remove Hero/)[0] as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    remove.click();
    await h.settle();
    expect(((await submit(fixture))['sections'] as unknown[]).length).toBe(1);
  });

  it('Add is unavailable at maxRows (and says why) and returns after a removal', async () => {
    const fixture = await openForm({
      steps: [{ label: 'a' }, { label: 'b' }],
      sections: [{ blockType: 'hero' }]
    });
    expect(button(fixture, /^Add row to Steps$/).disabled).toBe(true);
    expect(h.text(fixture)).toContain('Maximum of 2 rows reached.');
    buttons(fixture, /^Remove Steps row 2 of 2$/)[0]?.click();
    await h.settle();
    expect(button(fixture, /^Add row to Steps$/).disabled).toBe(false);
    button(fixture, /^Add row to Steps$/).click();
    await h.settle();
    expect(h.qa(fixture, '[role="group"][aria-label^="Steps row"]')).toHaveLength(2);
  });
});

describe('focus after structural changes', () => {
  it('adding a row focuses its first control; removing focuses the row that took its place', async () => {
    const fixture = await openForm({ steps: [{ label: 'a' }], sections: [{ blockType: 'hero' }] });
    button(fixture, /^Add row to Steps$/).click();
    await h.settle();
    expect(h.active()).toBe(control(fixture, 'steps.1.label')); // first control of the new row

    buttons(fixture, /^Remove Steps row 1 of 2$/)[0]?.click();
    await h.settle();
    const rows = h.qa(fixture, '[role="group"][aria-label^="Steps row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.contains(h.active())).toBe(true);
  });
});

describe('unknown stored block types', () => {
  it('are named as unknown, kept untouched in the payload, and only removed deliberately', async () => {
    const stored = { blockType: 'legacy-gallery', images: ['x', 'y'], layout: { cols: 3 } };
    const fixture = await openForm({
      steps: [{ label: 'a' }],
      sections: [{ blockType: 'hero', heading: 'Hi' }, stored]
    });
    expect(h.text(fixture)).toContain('Unknown block type “legacy-gallery”');
    expect(h.text(fixture)).toContain('its stored content is kept as it is');

    await h.typeInto(control(fixture, 'sections.0.heading') as HTMLInputElement, 'Edited');
    const payload = await submit(fixture);
    expect(payload['sections']).toEqual([{ blockType: 'hero', heading: 'Edited' }, stored]);

    saved = undefined;
    buttons(fixture, /^Remove legacy-gallery block 2 of 2$/)[0]?.click();
    await h.settle();
    expect((await submit(fixture))['sections']).toEqual([{ blockType: 'hero', heading: 'Edited' }]);
  });
});

describe('dates', () => {
  it('shows a canonical ISO date in the native date control and submits a day', async () => {
    const fixture = await openForm({
      when: '2026-10-08T00:00:00.000Z',
      steps: [{ label: 'a' }],
      sections: [{ blockType: 'hero' }]
    });
    const day = control(fixture, 'when') as HTMLInputElement;
    expect(day.type).toBe('date');
    expect(day.value).toBe('2026-10-08');
    await h.typeInto(day, '2026-11-02');
    expect((await submit(fixture))['when']).toBe('2026-11-02');
  });

  it('withTime uses datetime-local, shows local wall-clock time, and submits a canonical instant', async () => {
    const instant = new Date(2026, 9, 8, 12, 30);
    const fixture = await openForm({
      startsAt: instant.toISOString(),
      steps: [{ label: 'a' }],
      sections: [{ blockType: 'hero' }]
    });
    const starts = control(fixture, 'startsAt') as HTMLInputElement;
    expect(starts.type).toBe('datetime-local');
    expect(starts.value).toBe('2026-10-08T12:30');

    await h.typeInto(starts, '2026-10-09T08:15');
    expect((await submit(fixture))['startsAt']).toBe(new Date(2026, 9, 9, 8, 15).toISOString());
  });
});

describe('locale selector', () => {
  it('is a labelled group of toggle buttons that exposes the selected locale', async () => {
    const fixture = await openForm({
      headline: { en: 'Hello', es: 'Hola' },
      steps: [{ label: 'a' }],
      sections: [{ blockType: 'hero' }]
    });
    const group = h
      .qa(fixture, '[role="group"]')
      .find((g) => g.getAttribute('aria-label') === 'Headline language');
    expect(group).toBeDefined();
    const [en, es] = Array.from(group?.querySelectorAll('button') ?? []) as HTMLButtonElement[];
    expect([en?.getAttribute('aria-pressed'), es?.getAttribute('aria-pressed')]).toEqual([
      'true',
      'false'
    ]);
    expect(en?.type).toBe('button');
    expect((control(fixture, 'headline') as HTMLInputElement).value).toBe('Hello');

    es?.focus();
    es?.click(); // Enter/Space on a button is a click
    await h.settle();
    expect([en?.getAttribute('aria-pressed'), es?.getAttribute('aria-pressed')]).toEqual([
      'false',
      'true'
    ]);
    expect(h.active()).toBe(es);
    expect((control(fixture, 'headline') as HTMLInputElement).value).toBe('Hola');
  });

  it('switching locales never overwrites the other locale’s value', async () => {
    const fixture = await openForm({
      headline: { en: 'Hello', es: 'Hola' },
      steps: [{ label: 'a' }],
      sections: [{ blockType: 'hero' }]
    });
    const toggles = h.qa<HTMLButtonElement>(fixture, '[aria-label="Headline language"] button');
    toggles[1]?.click();
    await h.settle();
    await h.typeInto(control(fixture, 'headline') as HTMLInputElement, 'Buenas');
    toggles[0]?.click();
    await h.settle();
    expect((control(fixture, 'headline') as HTMLInputElement).value).toBe('Hello');
    expect((await submit(fixture))['headline']).toEqual({ en: 'Hello', es: 'Buenas' });
  });

  it('a localized field’s error stays on its single input', async () => {
    const fixture = await openForm({ steps: [{ label: 'a' }], sections: [{ blockType: 'hero' }] });
    fixture.componentRef.setInput('fieldErrors', { abstract: 'Abstract is too short' });
    await h.settle();
    const area = control(fixture, 'abstract');
    expect(area.getAttribute('aria-invalid')).toBe('true');
    expect(h.describedBy(area)).toBe('Abstract is too short');
    expect(h.active()).toBe(area);
  });
});

describe('does not regress', () => {
  it('Enter in a text field submits once through the form', async () => {
    const fixture = await openForm({ steps: [{ label: 'a' }], sections: [{ blockType: 'hero' }] });
    const onSave = vi.fn();
    fixture.componentInstance.save.subscribe(onSave);
    h.submitForm(fixture);
    await h.settle();
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
