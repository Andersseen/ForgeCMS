// @vitest-environment jsdom
/**
 * Spec 086 (roadmap 0.11 / U02): the unsaved-changes dialog replacing `window.confirm`, modal focus
 * across nested dialogs, and focus after a real validation failure — over the real editor + form.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { convertToParamMap } from '@angular/router';
import { ForgeDocumentEditorComponent } from './document-editor.component.js';
import * as h from './reliability.test-helpers.js';

let ctx: h.Harness;
let opener: HTMLButtonElement;
let confirmSpy: ReturnType<typeof vi.fn>;

beforeAll(() => h.stubLayout());
beforeEach(() => {
  ctx = h.configureHarness();
  confirmSpy = vi.fn(() => true);
  window.confirm = confirmSpy as unknown as typeof window.confirm;
  // What the user pressed to open the editor ("New" / a row's Edit).
  opener = document.createElement('button');
  opener.textContent = 'New';
  document.body.append(opener);
});
afterEach(() => {
  opener.remove();
  TestBed.resetTestingModule();
});

async function openEditor(): Promise<ComponentFixture<ForgeDocumentEditorComponent>> {
  await h.signIn(ctx.transport, { id: 'editor-1', role: 'editor' });
  ctx.routeParams.next(convertToParamMap({ id: 'a' }));
  opener.focus();
  const fixture = TestBed.createComponent(ForgeDocumentEditorComponent);
  await h.settle();
  await h.answer(ctx.transport, '/collections', { data: [h.POSTS] });
  await h.answer(ctx.transport, '/posts/a', { data: { id: 'a', title: 'A', summary: 's' } });
  return fixture;
}

const title = (fixture: ComponentFixture<unknown>) =>
  h.q<HTMLInputElement>(fixture, 'input#title') as HTMLInputElement;
const dialogs = (fixture: ComponentFixture<unknown>) => h.qa(fixture, '[role="dialog"]');
const leaveDialog = (fixture: ComponentFixture<unknown>) =>
  h.q(fixture, '[aria-labelledby="forge-confirm-dialog-title"]') as HTMLElement;
const choice = (fixture: ComponentFixture<unknown>, name: string) =>
  Array.from(leaveDialog(fixture).querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === name
  ) as HTMLButtonElement;
const formCancel = (fixture: ComponentFixture<unknown>) =>
  h
    .qa<HTMLButtonElement>(fixture, 'form button')
    .find((b) => b.textContent?.trim() === 'Cancel') as HTMLButtonElement;

describe('unsaved changes', () => {
  it('a clean editor is left immediately with no dialog', async () => {
    const fixture = await openEditor();
    expect(fixture.componentInstance.canDeactivate()).toBe(true);
    await h.settle();
    expect(dialogs(fixture)).toHaveLength(1); // only the editor
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('a dirty editor asks in a focus-managed dialog; Stay keeps everything and returns focus', async () => {
    const fixture = await openEditor();
    await h.typeInto(title(fixture), 'Mine');
    formCancel(fixture).focus();

    const answer = fixture.componentInstance.canDeactivate() as Promise<boolean>;
    await h.settle();
    expect(dialogs(fixture)).toHaveLength(2);
    const dialog = leaveDialog(fixture);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(
      'Leave without saving?'
    );
    expect(h.active()).toBe(choice(fixture, 'Stay')); // safe choice first

    // Its own trap (the form's trap is a different, enclosing one).
    (dialog.nextElementSibling as HTMLElement).focus();
    expect(dialog.contains(h.active())).toBe(true);

    h.press(dialog, 'Escape'); // Escape == Stay
    await h.settle();
    await expect(answer).resolves.toBe(false);
    expect(leaveDialog(fixture)).toBeNull();
    expect(title(fixture).value).toBe('Mine');
    expect(h.active()).toBe(formCancel(fixture)); // whatever started the navigation
    expect(fixture.componentInstance.canDeactivate()).toBeInstanceOf(Promise); // still dirty
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('Leave resolves true; with the editor gone, focus goes back to what opened the editor', async () => {
    const fixture = await openEditor();
    await h.typeInto(title(fixture), 'Mine');
    formCancel(fixture).focus();
    const answer = fixture.componentInstance.canDeactivate() as Promise<boolean>;
    await h.settle();

    choice(fixture, 'Leave without saving').click();
    await h.settle();
    await expect(answer).resolves.toBe(true);

    fixture.destroy(); // the router drops the editor once the guard allows it …
    (fixture.nativeElement as HTMLElement).remove(); // … and its DOM with it
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.active()).toBe(opener);
  });

  it('repeated attempts share one dialog and one answer', async () => {
    const fixture = await openEditor();
    await h.typeInto(title(fixture), 'Mine');
    const first = fixture.componentInstance.canDeactivate() as Promise<boolean>;
    const second = fixture.componentInstance.canDeactivate() as Promise<boolean>;
    await h.settle();
    expect(second).toBe(first);
    expect(h.qa(fixture, '[aria-labelledby="forge-confirm-dialog-title"]')).toHaveLength(1);
    choice(fixture, 'Stay').click();
    await h.settle();
    await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
  });

  it('a saved editor is clean: no dialog after the write succeeds', async () => {
    const fixture = await openEditor();
    await h.typeInto(title(fixture), 'Saved');
    h.submitForm(fixture);
    await h.settle();
    ctx.transport.last('/posts/a', 'PUT').resolve({ data: { id: 'a', title: 'Saved' } });
    await h.settle();
    expect(fixture.componentInstance.canDeactivate()).toBe(true);
  });
});

describe('failures and focus', () => {
  it('a real validation error focuses the first invalid field and keeps what was typed', async () => {
    const fixture = await openEditor();
    await h.typeInto(
      h.q<HTMLInputElement>(fixture, 'input#summary') as HTMLInputElement,
      'keep me'
    );
    await h.typeInto(title(fixture), '');
    (h.q<HTMLButtonElement>(fixture, 'button[type="submit"]') as HTMLButtonElement).focus();

    h.submitForm(fixture);
    await h.settle();
    ctx.transport.last('/posts/a', 'PUT').resolve(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid',
          details: [{ field: 'title', message: 'Title is required', code: 'required' }]
        }
      },
      400
    );
    await h.settle();

    expect(h.active()).toBe(title(fixture));
    expect(title(fixture).getAttribute('aria-invalid')).toBe('true');
    expect(h.describedBy(title(fixture))).toBe('Title is required');
    expect((h.q<HTMLInputElement>(fixture, 'input#summary') as HTMLInputElement).value).toBe(
      'keep me'
    );
    expect(h.q(fixture, '[role="alert"]')?.textContent).toBe(
      'Fix the highlighted fields and try again.'
    );
  });

  it('a network failure announces an alert and keeps focus off the fields', async () => {
    const fixture = await openEditor();
    await h.typeInto(title(fixture), 'Mine');
    const save = h.q<HTMLButtonElement>(fixture, 'button[type="submit"]') as HTMLButtonElement;
    save.focus();
    h.submitForm(fixture);
    await h.settle();
    save.blur(); // the browser drops focus from a button that became disabled
    ctx.transport.last('/posts/a', 'PUT').fail();
    await h.settle();

    expect(h.q(fixture, '[role="alert"]')?.textContent).toContain("Couldn't reach the server");
    expect(h.active()).toBe(save);
    expect(title(fixture).getAttribute('aria-invalid')).toBeNull();
  });
});
