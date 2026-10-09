// @vitest-environment jsdom
/**
 * Spec 086 (roadmap 0.11 / U02): the users workspace by keyboard — a real form, labelled fields, a
 * sole-admin restriction whose reason a keyboard user can reach, and focus that never lands on a
 * node that is gone. The U01 reliability suite stays authoritative for the write semantics.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ForgeUsersWorkspaceComponent } from './users-workspace.component.js';
import * as h from './reliability.test-helpers.js';

let ctx: h.Harness;
beforeAll(() => h.stubLayout());
beforeEach(() => {
  ctx = h.configureHarness();
});
afterEach(() => TestBed.resetTestingModule());

const ADMIN = { id: 'u-admin', email: 'admin@example.com', name: 'Ada', role: 'admin' };
const ED = { id: 'u-ed', email: 'ed@example.com', name: 'Ed', role: 'editor' };

async function open(): Promise<ComponentFixture<ForgeUsersWorkspaceComponent>> {
  await h.signIn(ctx.transport, ADMIN);
  const fixture = TestBed.createComponent(ForgeUsersWorkspaceComponent);
  await h.settle();
  await h.answer(ctx.transport, '/api/auth/users', { data: [ADMIN, ED] });
  return fixture;
}

const btn = (fixture: ComponentFixture<unknown>, label: RegExp): HTMLButtonElement =>
  h
    .qa<HTMLButtonElement>(fixture, 'button')
    .find((b) =>
      label.test((b.textContent ?? '').replace(/\s+/g, ' ').trim())
    ) as HTMLButtonElement;

async function startCreate(fixture: ComponentFixture<unknown>): Promise<void> {
  btn(fixture, /New User/).click();
  await h.settle();
}

describe('user form', () => {
  it('is a real form with labelled fields; opening it focuses the first field', async () => {
    const fixture = await open();
    await startCreate(fixture);
    expect(h.active()).toBe(h.q(fixture, 'input#forge-user-name'));
    const form = h.q(fixture, 'form') as HTMLFormElement;
    for (const [id, name] of [
      ['forge-user-name', 'Name'],
      ['forge-user-email', 'Email'],
      ['forge-user-role', 'Role'],
      ['forge-user-password', 'Password']
    ] as const) {
      const control = h.q(fixture, `[id="${id}"]`) as HTMLElement;
      expect(form.contains(control)).toBe(true);
      expect(h.labelFor(control), id).toContain(name);
    }
    const ids = h.qa(fixture, '[id]').map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('submitting the form (Enter) sends exactly one request, however many times it fires', async () => {
    const fixture = await open();
    await startCreate(fixture);
    await h.typeInto(
      h.q<HTMLInputElement>(fixture, 'input#forge-user-email') as HTMLInputElement,
      'n@example.com'
    );
    await h.typeInto(
      h.q<HTMLInputElement>(fixture, 'input#forge-user-password') as HTMLInputElement,
      'correct horse'
    );
    h.submitForm(fixture);
    h.submitForm(fixture);
    await h.settle();
    expect(ctx.transport.to('/api/auth/users', 'POST')).toHaveLength(1);
  });

  it('Escape does not discard a half-typed form', async () => {
    const fixture = await open();
    await startCreate(fixture);
    const name = h.q<HTMLInputElement>(fixture, 'input#forge-user-name') as HTMLInputElement;
    await h.typeInto(name, 'Half typed');
    h.press(name, 'Escape');
    await h.settle();
    expect(
      (h.q<HTMLInputElement>(fixture, 'input#forge-user-name') as HTMLInputElement).value
    ).toBe('Half typed');
  });

  it('Cancel closes the form and focus returns to New User', async () => {
    const fixture = await open();
    await startCreate(fixture);
    btn(fixture, /^Cancel$/).click();
    await h.settle();
    expect(h.q(fixture, 'form')).toBeNull();
    expect(h.active()?.textContent).toContain('New User');
  });

  it('a failed save shows an alert and keeps the form', async () => {
    const fixture = await open();
    await startCreate(fixture);
    await h.typeInto(
      h.q<HTMLInputElement>(fixture, 'input#forge-user-email') as HTMLInputElement,
      'n@example.com'
    );
    await h.typeInto(
      h.q<HTMLInputElement>(fixture, 'input#forge-user-password') as HTMLInputElement,
      'x'
    );
    h.submitForm(fixture);
    await h.settle();
    ctx.transport.last('/api/auth/users', 'POST').fail();
    await h.settle();
    expect(h.q(fixture, 'form [role="alert"]')?.textContent).toContain("Couldn't reach the server");
    expect(
      (h.q<HTMLInputElement>(fixture, 'input#forge-user-email') as HTMLInputElement).value
    ).toBe('n@example.com');
  });
});

describe('the sole admin', () => {
  it('delete stays focusable, says why, and does nothing', async () => {
    const fixture = await open();
    const del = btn(fixture, /^Delete Ada$/);
    expect(del.disabled).toBe(false); // a disabled button could not be reached by keyboard
    expect(del.getAttribute('aria-disabled')).toBe('true');
    expect(h.describedBy(del)).toContain("The only admin can't be deleted");
    del.focus();
    expect(h.active()).toBe(del);
    del.click();
    await h.settle();
    expect(h.q(fixture, '[role="dialog"]')).toBeNull();

    // Another user is deletable as usual.
    expect(btn(fixture, /^Delete Ed$/).getAttribute('aria-disabled')).toBeNull();
  });

  it('the role select explains itself and cannot be changed', async () => {
    const fixture = await open();
    btn(fixture, /^Edit Ada$/).click();
    await h.settle();
    const role = h.q<HTMLSelectElement>(fixture, 'select#forge-user-role') as HTMLSelectElement;
    expect(role.disabled).toBe(false);
    expect(role.getAttribute('aria-disabled')).toBe('true');
    expect(h.describedBy(role)).toContain('only admin');
    await h.choose(role, 'viewer');
    expect(role.value).toBe('admin');
  });
});

describe('deleting a user', () => {
  it('opens the shared dialog, and success lands on the Users heading, not on a removed row', async () => {
    const fixture = await open();
    const del = btn(fixture, /^Delete Ed$/);
    del.focus();
    del.click();
    await h.settle();
    const dialog = h.q(fixture, '[role="dialog"]') as HTMLElement;
    expect(h.active()?.textContent?.trim()).toBe('Cancel');
    expect(dialog.contains(h.active())).toBe(true);

    Array.from(dialog.querySelectorAll('button'))
      .find((b) => (b.textContent?.trim() ?? '').startsWith('Delete'))
      ?.click();
    await h.settle();
    ctx.transport.last('/api/auth/users/u-ed', 'DELETE').resolve(undefined, 204);
    await h.settle();
    await h.answer(ctx.transport, '/api/auth/users', { data: [ADMIN] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.active()?.tagName).toBe('H1');
    expect(h.active()?.textContent).toContain('Users');
  });
});
