// @vitest-environment jsdom
/**
 * Spec 086 (roadmap 0.11 / U02): the editor modal and its fields, observed on the rendered DOM —
 * dialog focus, real label/required/invalid/error association on the native controls, and focus
 * moving to the first invalid field after a *server* validation error.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import type { FieldMeta } from '@forge-cms/angular';
import { ForgeCollectionFormComponent } from './collection-form.component.js';
import * as h from './reliability.test-helpers.js';

const FIELDS: FieldMeta[] = [
  { name: 'title', kind: 'text', label: 'Title', required: true },
  { name: 'summary', kind: 'textarea', label: 'Summary', required: false },
  { name: 'rating', kind: 'number', label: 'Rating', required: true },
  { name: 'contact', kind: 'email', label: 'Contact', required: false },
  { name: 'kind', kind: 'select', label: 'Kind', required: true, options: ['news', 'guide'] },
  { name: 'featured', kind: 'boolean', label: 'Featured', required: false },
  { name: 'day', kind: 'date', label: 'Day', required: false },
  { name: 'meta', kind: 'json', label: 'Meta', required: false },
  {
    name: 'seo',
    kind: 'group',
    label: 'SEO',
    required: false,
    fields: [{ name: 'metaTitle', kind: 'text', label: 'Meta title', required: true }]
  },
  {
    name: 'steps',
    kind: 'array',
    label: 'Steps',
    required: false,
    minRows: 1,
    fields: [{ name: 'label', kind: 'text', label: 'Label', required: true }]
  },
  { name: 'body', kind: 'richtext', label: 'Body', required: false },
  {
    name: 'author',
    kind: 'relation',
    label: 'Author',
    required: true,
    relation: { collection: 'users', many: false }
  },
  {
    name: 'cover',
    kind: 'upload',
    label: 'Cover',
    required: false,
    relation: { collection: 'media', many: false }
  }
];

beforeAll(() => h.stubLayout());
beforeEach(() => {
  h.configureHarness();
});
afterEach(() => TestBed.resetTestingModule());

async function openForm(
  inputs: Record<string, unknown> = {}
): Promise<ComponentFixture<ForgeCollectionFormComponent>> {
  const fixture = TestBed.createComponent(ForgeCollectionFormComponent);
  fixture.componentRef.setInput('fields', FIELDS);
  fixture.componentRef.setInput('initialValue', { steps: [{ label: 'one' }] });
  for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
  await h.settle();
  return fixture;
}

const control = (fixture: ComponentFixture<unknown>, id: string): HTMLElement =>
  h.q(fixture, `[id="${id}"]`) as HTMLElement;

describe('editor modal focus', () => {
  it('opens with focus on the first field, inside a named modal, with the trap anchors around it', async () => {
    const fixture = await openForm();
    const dialog = h.q(fixture, '[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(
      document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent
    ).toMatch(/document/i);
    expect(h.active()).toBe(control(fixture, 'title'));
    expect(dialog.previousElementSibling?.classList.contains('cdk-focus-trap-anchor')).toBe(true);
    expect(dialog.nextElementSibling?.classList.contains('cdk-focus-trap-anchor')).toBe(true);

    // Focus that lands on an anchor (Tab off either end) is sent back inside.
    (dialog.nextElementSibling as HTMLElement).focus();
    expect(dialog.contains(h.active())).toBe(true);
    (dialog.previousElementSibling as HTMLElement).focus();
    expect(dialog.contains(h.active())).toBe(true);
  });

  it('Escape cancels, but not while a save is in flight', async () => {
    const fixture = await openForm();
    const cancelled = vi.fn();
    fixture.componentInstance.cancel.subscribe(cancelled);
    const dialog = h.q(fixture, '[role="dialog"]') as HTMLElement;

    fixture.componentRef.setInput('submitting', true);
    await h.settle();
    h.press(dialog, 'Escape');
    expect(cancelled).not.toHaveBeenCalled();
    expect(h.text(fixture)).toContain('Saving…');

    fixture.componentRef.setInput('submitting', false);
    await h.settle();
    h.press(dialog, 'Escape');
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it('keeps the title and the action row outside the scrolling region (mobile reachability)', async () => {
    const fixture = await openForm();
    const form = h.q(fixture, 'form') as HTMLElement;
    const [header, scroller, footer] = Array.from(form.children) as HTMLElement[];
    expect(header?.querySelector('h2')).not.toBeNull();
    expect(scroller?.className).toContain('overflow-y-auto');
    expect(scroller?.contains(control(fixture, 'title'))).toBe(true);
    expect(footer?.className).toContain('shrink-0');
    const buttons = Array.from(footer?.querySelectorAll('button') ?? []).map((b) =>
      b.textContent?.trim()
    );
    expect(buttons).toEqual(['Cancel', 'Save']);
    expect(h.q(fixture, '[role="dialog"] volt-card')?.className).toContain('100dvh');
  });
});

describe('rendered controls carry their own name, required and invalid state', () => {
  it('every editable control has a real <label for>, and required fields are natively required', async () => {
    const fixture = await openForm();
    const expectations: [string, string][] = [
      ['title', 'Title'],
      ['summary', 'Summary'],
      ['rating', 'Rating'],
      ['contact', 'Contact'],
      ['kind', 'Kind'],
      ['day', 'Day'],
      ['meta', 'Meta'],
      ['seo.metaTitle', 'Meta title'],
      ['steps.0.label', 'Label'],
      ['author', 'Author'],
      ['cover', 'Cover']
    ];
    for (const [id, name] of expectations) {
      expect(h.labelFor(control(fixture, id)), id).toContain(name);
    }
    for (const id of ['title', 'rating', 'kind', 'seo.metaTitle', 'steps.0.label']) {
      expect((control(fixture, id) as HTMLInputElement).required, id).toBe(true);
    }
    expect((control(fixture, 'summary') as HTMLTextAreaElement).required).toBe(false);
    // The switch has no <label for> that reaches its inner button, so it is named directly.
    expect(control(fixture, 'featured').getAttribute('aria-label')).toBe('Featured');
    // Exactly one element per id — the host and its inner input must not share one.
    const ids = Array.from(fixture.nativeElement.querySelectorAll('[id]')).map(
      (el) => (el as Element).id
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a server validation error marks the real control invalid and described by its message', async () => {
    const fixture = await openForm();
    fixture.componentRef.setInput('fieldErrors', {
      title: 'Title is required',
      rating: 'Rating must be a number',
      kind: 'Pick a kind',
      summary: 'Too long',
      'seo.metaTitle': 'Meta title is required',
      author: 'Author is required'
    });
    await h.settle();

    for (const [id, message] of [
      ['title', 'Title is required'],
      ['rating', 'Rating must be a number'],
      ['kind', 'Pick a kind'],
      ['summary', 'Too long'],
      ['seo.metaTitle', 'Meta title is required'],
      ['author', 'Author is required']
    ] as const) {
      const el = control(fixture, id);
      expect(el.getAttribute('aria-invalid'), id).toBe('true');
      expect(h.describedBy(el), id).toBe(message);
    }
    // A control with no error says nothing about it.
    expect(control(fixture, 'contact').getAttribute('aria-invalid')).toBeNull();
    expect(control(fixture, 'contact').getAttribute('aria-describedby')).toBeNull();

    // Clearing the error clears the state.
    fixture.componentRef.setInput('fieldErrors', {});
    await h.settle();
    expect(control(fixture, 'title').getAttribute('aria-invalid')).toBeNull();
    expect(control(fixture, 'title').getAttribute('aria-describedby')).toBeNull();
  });

  it('a chosen single relation with a server error is described on its group', async () => {
    const fixture = await openForm({ initialValue: { author: 'user-1', steps: [{ label: 'a' }] } });
    fixture.componentRef.setInput('fieldErrors', { author: 'Author no longer exists' });
    await h.settle();
    const group = h
      .qa(fixture, '[role="group"]')
      .find((el) => el.getAttribute('data-forge-path') === 'author');
    expect(h.describedBy(group as Element)).toBe('Author no longer exists');
  });

  it('widgets without one native control are labelled groups', async () => {
    const fixture = await openForm();
    for (const [id, name] of [
      ['body', 'Body'],
      ['author', 'Author'],
      ['cover', 'Cover']
    ] as const) {
      const wrapper = h
        .qa(fixture, '[role="group"]')
        .find((el) => el.getAttribute('data-forge-path') === id);
      const labelId = wrapper?.getAttribute('aria-labelledby') ?? '';
      expect(document.getElementById(labelId)?.textContent, id).toContain(name);
    }
  });
});

describe('first invalid field recovery', () => {
  it('a server validation error moves focus to the first invalid control and keeps the typed values', async () => {
    const fixture = await openForm();
    await h.typeInto(control(fixture, 'contact') as HTMLInputElement, 'typed@example.test');
    (control(fixture, 'kind') as HTMLElement).focus();

    fixture.componentRef.setInput('error', 'Fix the highlighted fields and try again.');
    fixture.componentRef.setInput('fieldErrors', {
      kind: 'Pick a kind',
      title: 'Title is required'
    });
    await h.settle();

    expect(h.active()).toBe(control(fixture, 'title')); // document order, not error order
    expect((control(fixture, 'contact') as HTMLInputElement).value).toBe('typed@example.test');
    expect(h.text(fixture)).toContain('Fix the highlighted fields and try again.');
    expect(h.q(fixture, '[role="alert"]')?.textContent).toContain('Fix the highlighted fields');
  });

  it('reaches a nested field by its dotted path without treating the path as a selector', async () => {
    const fixture = await openForm();
    fixture.componentRef.setInput('fieldErrors', { 'steps.0.label': 'Label is required' });
    await h.settle();
    expect(h.active()).toBe(control(fixture, 'steps.0.label'));

    fixture.componentRef.setInput('fieldErrors', { 'seo.metaTitle': 'Required' });
    await h.settle();
    expect(h.active()).toBe(control(fixture, 'seo.metaTitle'));
  });

  it('prefers the invalid child over its container, and focuses inside a container with only its own error', async () => {
    const fixture = await openForm();
    fixture.componentRef.setInput('fieldErrors', {
      steps: 'At least one step',
      'steps.0.label': 'x'
    });
    await h.settle();
    expect(h.active()).toBe(control(fixture, 'steps.0.label'));

    fixture.componentRef.setInput('fieldErrors', { steps: 'At least one step' });
    await h.settle();
    const group = control(fixture, 'steps');
    expect(group.tagName).toBe('FIELDSET');
    expect(group.contains(h.active())).toBe(true);
    expect(h.describedBy(group)).toBe('At least one step');
  });

  it('does not steal focus for a failure that points at no field (network, 5xx, conflict)', async () => {
    const fixture = await openForm();
    (control(fixture, 'contact') as HTMLElement).focus();
    fixture.componentRef.setInput(
      'error',
      "Couldn't reach the server. Check your connection and try again."
    );
    await h.settle();
    expect(h.active()).toBe(control(fixture, 'contact'));
    expect(h.q(fixture, '[role="alert"]')?.textContent).toContain("Couldn't reach the server");
  });

  it('after a failed save with no field to blame, focus comes back to Save', async () => {
    const fixture = await openForm();
    const save = h.q<HTMLButtonElement>(fixture, 'button[type="submit"]') as HTMLButtonElement;
    save.focus();
    fixture.componentRef.setInput('submitting', true);
    await h.settle();
    // The browser drops focus from a button that just became disabled.
    save.blur();
    fixture.componentRef.setInput('submitting', false);
    fixture.componentRef.setInput('error', 'Something went wrong on the server. Please try again.');
    await h.settle();
    expect(h.active()).toBe(save);
  });
});
