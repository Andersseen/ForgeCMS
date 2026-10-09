// @vitest-environment jsdom
/**
 * Spec 086 (roadmap 0.11 / U02): the confirmation dialog's focus contract, observed on the rendered DOM.
 * jsdom does not Tab; the trap is proven by the anchors CDK puts around the dialog and by what they do
 * when focus lands on them (which is exactly what a real Tab from the last/first control does) — the
 * real-Tab behaviour is covered by the Playwright journey.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ForgeConfirmDialogComponent } from './confirm-dialog.component.js';
import * as h from './reliability.test-helpers.js';

@Component({
  selector: 'forge-test-host',
  standalone: true,
  imports: [ForgeConfirmDialogComponent],
  template: `
    <h1>Posts</h1>
    <button id="opener" type="button" (click)="open.set(true)">Open</button>
    <button id="after" type="button">After</button>
    <forge-confirm-dialog
      [open]="open()"
      title="Delete this?"
      [pending]="pending()"
      (confirm)="confirmed = confirmed + 1"
      (cancel)="open.set(false)"
    />
  `
})
class HostComponent {
  open = signal(false);
  pending = signal(false);
  confirmed = 0;
}

beforeAll(() => h.stubLayout());
beforeEach(() => {
  h.configureHarness();
});
afterEach(() => TestBed.resetTestingModule());

async function openDialog() {
  const fixture = TestBed.createComponent(HostComponent);
  await h.settle();
  const opener = h.q<HTMLButtonElement>(fixture, '#opener') as HTMLButtonElement;
  opener.focus();
  opener.click();
  await h.settle();
  return { fixture, opener };
}

const dialog = (fixture: Parameters<typeof h.q>[0]) =>
  h.q(fixture, '[role="dialog"]') as HTMLElement;
const label = (el: Element | null) => (el?.textContent ?? '').trim();

describe('confirmation dialog focus', () => {
  it('moves focus to the safe choice (Cancel) when it opens', async () => {
    const { fixture } = await openDialog();
    expect(label(h.active())).toBe('Cancel');
    expect(dialog(fixture).contains(h.active())).toBe(true);
  });

  it('is named and described, and traps Tab in both directions', async () => {
    const { fixture } = await openDialog();
    const root = dialog(fixture);
    expect(root.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(root.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(
      'Delete this?'
    );
    expect(document.getElementById(root.getAttribute('aria-describedby') ?? '')).not.toBeNull();

    // The anchors sit directly around the dialog, so a real Tab off either end lands on one.
    const start = root.previousElementSibling as HTMLElement;
    const end = root.nextElementSibling as HTMLElement;
    expect(start.classList.contains('cdk-focus-trap-anchor')).toBe(true);
    expect(end.classList.contains('cdk-focus-trap-anchor')).toBe(true);

    const [cancel, confirm] = h.focusables(root);
    end.focus(); // Tab past Delete …
    expect(h.active()).toBe(cancel); // … wraps to the first control
    start.focus(); // Shift+Tab before Cancel …
    expect(h.active()).toBe(confirm); // … wraps to the last
  });

  it('Escape cancels, and focus returns to the control that opened it', async () => {
    const { fixture, opener } = await openDialog();
    h.press(dialog(fixture), 'Escape');
    await h.settle();
    expect(h.q(fixture, '[role="dialog"]')).toBeNull();
    expect(h.active()).toBe(opener);
  });

  it('cannot be dismissed while the action is pending, and says so politely', async () => {
    const { fixture } = await openDialog();
    fixture.componentInstance.pending.set(true);
    await h.settle();
    h.press(dialog(fixture), 'Escape');
    (h.q(fixture, 'forge-confirm-dialog') as HTMLElement)
      .querySelectorAll('button')
      .forEach((button) => button.click());
    await h.settle();
    expect(h.q(fixture, '[role="dialog"]')).not.toBeNull();
    expect(fixture.componentInstance.confirmed).toBe(0);
    expect(label(h.q(fixture, '[role="status"]'))).toBe('Deleting…');
  });

  it('falls back to the page heading when the opener was removed, never to a detached node', async () => {
    const { fixture, opener } = await openDialog();
    opener.remove();
    h.press(dialog(fixture), 'Escape');
    await h.settle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.active()?.tagName).toBe('H1');
    expect(h.active()?.isConnected).toBe(true);
  });
});
