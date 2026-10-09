// @vitest-environment jsdom
/**
 * Spec 086 (roadmap 0.11 / U02): the upload picker's keyboard behaviour, announced state, in-flight
 * guard and safe error text — over the real `CmsApiService` and a hand-settled transport.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ForgeUploadPickerComponent } from './upload-picker.component.js';
import * as h from './reliability.test-helpers.js';

const PHOTO = {
  id: 'media-photo-0000001',
  filename: 'photo.png',
  url: '/files/photo.png',
  contentType: 'image/png'
};
const DOC = {
  id: 'media-doc-000000002',
  filename: 'brief.pdf',
  url: '/files/brief.pdf',
  contentType: 'application/pdf'
};

let ctx: h.Harness;
beforeAll(() => h.stubLayout());
beforeEach(() => {
  ctx = h.configureHarness();
});
afterEach(() => TestBed.resetTestingModule());

async function openPicker(
  value?: unknown
): Promise<{ fixture: ComponentFixture<ForgeUploadPickerComponent>; emitted: string[] }> {
  const fixture = TestBed.createComponent(ForgeUploadPickerComponent);
  const emitted: string[] = [];
  fixture.componentRef.setInput('collection', 'media');
  fixture.componentRef.setInput('inputId', 'cover');
  fixture.componentRef.setInput('label', 'Cover');
  if (value !== undefined) fixture.componentRef.setInput('value', value);
  fixture.componentInstance.valueChange.subscribe((id) => {
    emitted.push(id);
    fixture.componentRef.setInput('value', id);
  });
  await h.settle();
  return { fixture, emitted };
}

const toggle = (fixture: ComponentFixture<unknown>) =>
  h.q<HTMLButtonElement>(fixture, '[data-forge-library-toggle]') as HTMLButtonElement;
const fileInput = (fixture: ComponentFixture<unknown>) =>
  h.q<HTMLInputElement>(fixture, 'input[type="file"]') as HTMLInputElement;
const status = (fixture: ComponentFixture<unknown>) =>
  h.q(fixture, '[role="status"]')?.textContent?.trim();

async function chooseFile(fixture: ComponentFixture<unknown>, name: string): Promise<void> {
  const input = fileInput(fixture);
  const file = new File(['x'], name, { type: 'image/png' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await h.settle();
}

describe('upload picker, keyboard only', () => {
  it('exposes the file input (for the field label) and the library toggle’s state', async () => {
    const { fixture } = await openPicker();
    expect(fileInput(fixture).id).toBe('cover');
    expect(toggle(fixture).getAttribute('aria-expanded')).toBe('false');

    toggle(fixture).focus();
    toggle(fixture).click(); // Enter / Space
    await h.settle();
    expect(toggle(fixture).getAttribute('aria-expanded')).toBe('true');
    expect(status(fixture)).toBe('Loading library…');
    expect(
      h.q(fixture, `#${toggle(fixture).getAttribute('aria-controls')}`)?.getAttribute('aria-label')
    ).toBe('Media library');

    await h.answer(ctx.transport, '/media?', h.listPage('media', [PHOTO, DOC]));
    expect(status(fixture)).toBe('');
    const items = h.qa<HTMLButtonElement>(
      fixture,
      '[role="group"][aria-label="Media library"] button'
    );
    expect(items.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Select photo.png',
      'Select brief.pdf'
    ]);
  });

  it('selects by keyboard, hides the library, and focus lands on the toggle', async () => {
    const { fixture, emitted } = await openPicker();
    toggle(fixture).click();
    await h.settle();
    await h.answer(ctx.transport, '/media?', h.listPage('media', [PHOTO]));
    const item = h.q<HTMLButtonElement>(
      fixture,
      '[aria-label="Select photo.png"]'
    ) as HTMLButtonElement;
    item.focus();
    item.click();
    await h.settle();
    expect(emitted).toEqual([PHOTO.id]);
    expect(toggle(fixture).getAttribute('aria-expanded')).toBe('false');
    expect(h.active()).toBe(toggle(fixture));
  });

  it('Remove names its target and focus returns to the file input', async () => {
    const { fixture, emitted } = await openPicker({ ...PHOTO });
    const remove = h.q<HTMLButtonElement>(
      fixture,
      '[data-forge-remove] button'
    ) as HTMLButtonElement;
    expect(remove.textContent?.replace(/\s+/g, ' ').trim()).toBe('Remove photo.png');
    remove.focus();
    remove.click();
    await h.settle();
    expect(emitted).toEqual(['']);
    expect(h.active()).toBe(fileInput(fixture));
  });
});

describe('upload picker in flight and on failure', () => {
  it('one upload at a time: a second file chosen while uploading sends nothing more', async () => {
    const { fixture, emitted } = await openPicker();
    await chooseFile(fixture, 'a.png');
    expect(status(fixture)).toBe('Uploading…');
    expect(fileInput(fixture).disabled).toBe(true);

    await chooseFile(fixture, 'b.png'); // however the second one got through
    expect(ctx.transport.to('/media', 'POST')).toHaveLength(1);

    ctx.transport.last('/media', 'POST').resolve({ data: PHOTO }, 201);
    await h.settle();
    expect(emitted).toEqual([PHOTO.id]);
    expect(status(fixture)).toBe('');
    expect(fileInput(fixture).disabled).toBe(false);
    expect(h.active()).toBe(fileInput(fixture)); // focus was lost while disabled; handed back
  });

  it('an upload that finishes after the picker was destroyed does not throw', async () => {
    const { fixture } = await openPicker();
    await chooseFile(fixture, 'a.png');
    fixture.destroy();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    ctx.transport.last('/media', 'POST').resolve({ data: PHOTO }, 201);
    await h.settle();
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('maps a failed upload to a safe message and re-enables the control', async () => {
    const { fixture } = await openPicker();
    await chooseFile(fixture, 'a.png');
    ctx.transport.last('/media', 'POST').resolve(
      {
        error: { code: 'STORAGE', message: 'R2 PutObject failed: AccessDenied key=prod/secret' }
      },
      500
    );
    await h.settle();
    expect(h.q(fixture, '[role="alert"]')?.textContent).toBe(
      'Something went wrong on the server. Please try again.'
    );
    expect(h.text(fixture)).not.toContain('R2');
    expect(fileInput(fixture).disabled).toBe(false);
  });

  it('maps a failed library load to a safe message', async () => {
    const { fixture } = await openPicker();
    toggle(fixture).click();
    await h.settle();
    ctx.transport.last('/media?').fail();
    await h.settle();
    expect(h.q(fixture, '[role="alert"]')?.textContent).toBe(
      "Couldn't reach the server. Check your connection and try again."
    );
    expect(status(fixture)).toBe('');
  });
});
