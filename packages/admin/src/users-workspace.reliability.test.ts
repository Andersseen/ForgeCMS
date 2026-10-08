// @vitest-environment jsdom
/**
 * Spec 085 (roadmap 0.11 / U01): the real users workspace, rendered — latest-wins loading, single
 * writes, form retention on failure, outcome-safe delete, and server-driven permission loss.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import type { ForgeAuthSession } from '@forge-cms/angular';
import { ForgeUsersWorkspaceComponent } from './users-workspace.component.js';
import * as h from './reliability.test-helpers.js';

let ctx: h.Harness;
beforeEach(() => {
  ctx = h.configureHarness();
});
afterEach(() => TestBed.resetTestingModule());

const ADMIN = { id: 'u-admin', email: 'admin@example.com', name: 'Ada', role: 'admin' };
const ED = { id: 'u-ed', email: 'ed@example.com', name: 'Ed', role: 'editor' };

async function open(): Promise<{
  fixture: ComponentFixture<ForgeUsersWorkspaceComponent>;
  session: ForgeAuthSession;
}> {
  const session = await h.signIn(ctx.transport, ADMIN);
  const fixture = TestBed.createComponent(ForgeUsersWorkspaceComponent);
  await h.settle();
  await h.answer(ctx.transport, '/api/auth/users', { data: [ADMIN, ED] });
  return { fixture, session };
}

const usersGets = (): number => ctx.transport.to('/api/auth/users').length;

function btn(fixture: ComponentFixture<unknown>, label: string | RegExp): HTMLButtonElement {
  const el = h.qa<HTMLButtonElement>(fixture, 'button').find((b) => {
    const t = (b.textContent ?? '').trim();
    return typeof label === 'string' ? t === label : label.test(t);
  });
  if (el === undefined) throw new Error(`no button ${String(label)}`);
  return el;
}

async function click(el: HTMLElement): Promise<void> {
  el.click();
  await h.settle();
}

async function fillCreateForm(fixture: ComponentFixture<unknown>): Promise<void> {
  await click(btn(fixture, /New User/));
  await h.typeInto(
    h.q<HTMLInputElement>(fixture, '#forge-user-name input') as HTMLInputElement,
    'New'
  );
  await h.typeInto(
    h.q<HTMLInputElement>(fixture, '#forge-user-email input') as HTMLInputElement,
    'new@example.com'
  );
  await h.typeInto(
    h.q<HTMLInputElement>(fixture, '#forge-user-password input') as HTMLInputElement,
    'correct horse'
  );
}

describe('loading', () => {
  it('an older load response cannot overwrite a newer one', async () => {
    const { fixture } = await open();
    const view = fixture.componentInstance;

    void view.load();
    const older = ctx.transport.last('/api/auth/users');
    void view.load();
    const newer = ctx.transport.last('/api/auth/users');
    newer.resolve({ data: [ADMIN] });
    await h.settle();
    older.resolve({ data: [ADMIN, ED, { id: 'x', email: 'stale@example.com', role: 'viewer' }] });
    await h.settle();

    expect(view.users()).toEqual([ADMIN]);
    expect(h.text(fixture)).not.toContain('stale@example.com');
    expect(view.loading()).toBe(false);
  });
});

describe('create / update', () => {
  it('a double submit sends one request and shows Saving…', async () => {
    const { fixture } = await open();
    await fillCreateForm(fixture);
    const create = btn(fixture, 'Create');
    create.click();
    create.click();
    await h.settle();

    expect(ctx.transport.to('/api/auth/users', 'POST')).toHaveLength(1);
    expect(h.text(fixture)).toContain('Saving…');
  });

  it('a failure keeps every entered value with a friendly error, and a retry succeeds and reloads once', async () => {
    const { fixture } = await open();
    await fillCreateForm(fixture);
    await click(btn(fixture, 'Create'));
    ctx.transport
      .last('/api/auth/users', 'POST')
      .resolve({ error: { code: 'BOOM', message: 'SQLITE_CONSTRAINT: users.email' } }, 500);
    await h.settle();

    expect(h.text(fixture)).toContain('Something went wrong on the server');
    expect(h.text(fixture)).not.toContain('SQLITE');
    expect((h.q(fixture, '#forge-user-email input') as HTMLInputElement).value).toBe(
      'new@example.com'
    );
    expect((h.q(fixture, '#forge-user-name input') as HTMLInputElement).value).toBe('New');

    const before = usersGets();
    await click(btn(fixture, 'Create'));
    ctx.transport
      .last('/api/auth/users', 'POST')
      .resolve({ data: { id: 'n', email: 'new@example.com' } }, 201);
    await h.settle();

    expect(ctx.transport.to('/api/auth/users', 'POST')).toHaveLength(2);
    expect(h.q(fixture, '#forge-user-email')).toBeNull(); // form closed
    expect(usersGets()).toBe(before + 1);
  });

  it('keeps a server-controlled 409 message such as the last-admin rule', async () => {
    const { fixture } = await open();
    await click(
      h
        .qa<HTMLButtonElement>(fixture, 'button')
        .find((b) => /Edit Ada/.test(b.textContent ?? '')) as HTMLElement
    );
    await click(btn(fixture, 'Save'));
    ctx.transport
      .last('/api/auth/users/u-admin', 'PUT')
      .resolve({ error: { code: 'CONFLICT', message: 'Cannot demote the last admin.' } }, 409);
    await h.settle();
    expect(h.text(fixture)).toContain('Cannot demote the last admin.');
  });
});

describe('self edits', () => {
  it('saving the signed-in user re-reads the session so the role shown is the server’s', async () => {
    const { fixture, session } = await open();
    await click(
      h
        .qa<HTMLButtonElement>(fixture, 'button')
        .find((b) => /Edit Ada/.test(b.textContent ?? '')) as HTMLElement
    );
    await click(btn(fixture, 'Save'));
    ctx.transport.last('/api/auth/users/u-admin', 'PUT').resolve({ data: ADMIN });
    await h.settle();

    const me = ctx.transport.to('/api/auth/me');
    expect(me).toHaveLength(2);
    me[1]?.resolve({ data: { ...ADMIN, role: 'editor' } });
    await h.settle();
    expect(session.user()?.role).toBe('editor');
  });
});

describe('delete', () => {
  const deleteEd = (fixture: ComponentFixture<unknown>): HTMLElement =>
    h
      .qa<HTMLButtonElement>(fixture, 'button')
      .find((b) => /Delete Ed/.test(b.textContent ?? '')) as HTMLElement;
  const confirm = (fixture: ComponentFixture<unknown>): HTMLButtonElement =>
    h
      .qa<HTMLButtonElement>(fixture, '[role="dialog"] button')
      .find((b) => /^(Delete|Deleting…)$/.test((b.textContent ?? '').trim())) as HTMLButtonElement;

  it('Cancel sends nothing; Confirm sends one DELETE; failure keeps the dialog for retry; success reloads once', async () => {
    const { fixture } = await open();
    await click(deleteEd(fixture));
    await click(
      h
        .qa<HTMLButtonElement>(fixture, '[role="dialog"] button')
        .find((b) => (b.textContent ?? '').trim() === 'Cancel') as HTMLElement
    );
    expect(ctx.transport.to('/api/auth/users/u-ed', 'DELETE')).toHaveLength(0);

    await click(deleteEd(fixture));
    const c = confirm(fixture);
    c.click();
    c.click();
    await h.settle();
    expect(ctx.transport.to('/api/auth/users/u-ed', 'DELETE')).toHaveLength(1);
    expect(h.text(fixture)).toContain('ed@example.com');

    ctx.transport
      .last('/api/auth/users/u-ed', 'DELETE')
      .resolve({ error: { code: 'BOOM', message: 'x' } }, 500);
    await h.settle();
    expect(h.q(fixture, '[role="dialog"]')).not.toBeNull();
    expect(h.text(fixture)).toContain('Something went wrong on the server');
    expect(h.text(fixture)).toContain('ed@example.com'); // still listed, not an error page

    const before = usersGets();
    await click(confirm(fixture));
    ctx.transport.last('/api/auth/users/u-ed', 'DELETE').resolve(undefined, 204);
    await h.settle();
    expect(h.q(fixture, '[role="dialog"]')).toBeNull();
    expect(usersGets()).toBe(before + 1);
  });
});

describe('session and permission changes', () => {
  it('losing admin (server says viewer) removes the actionable table and controls', async () => {
    const { fixture, session } = await open();
    expect(h.text(fixture)).toContain('ed@example.com');

    const refresh = session.refresh();
    ctx.transport
      .to('/api/auth/me')
      .at(-1)
      ?.resolve({ data: { ...ADMIN, role: 'viewer' } });
    await refresh;
    await h.settle();

    expect(h.text(fixture)).toContain('Access denied');
    expect(h.text(fixture)).not.toContain('ed@example.com');
    expect(fixture.componentInstance.users()).toEqual([]);
  });

  it('a 403 on save reconciles the session role from the server', async () => {
    const { fixture, session } = await open();
    await fillCreateForm(fixture);
    await click(btn(fixture, 'Create'));
    ctx.transport
      .last('/api/auth/users', 'POST')
      .resolve({ error: { code: 'FORBIDDEN', message: 'no' } }, 403);
    await h.settle();

    expect(h.text(fixture)).toContain("don't have permission");
    const me = ctx.transport.to('/api/auth/me');
    expect(me).toHaveLength(2);
    me[1]?.resolve({ data: { ...ADMIN, role: 'editor' } });
    await h.settle();
    expect(session.user()?.role).toBe('editor');
    expect(h.text(fixture)).toContain('Access denied');
  });

  it('a 401 during save keeps the form and reports the expired session', async () => {
    const { fixture, session } = await open();
    await fillCreateForm(fixture);
    await click(btn(fixture, 'Create'));
    ctx.transport
      .last('/api/auth/users', 'POST')
      .resolve({ error: { code: 'UNAUTHORIZED', message: 'no' } }, 401);
    await h.settle();

    expect(session.expired()).toBe(true);
    expect((h.q(fixture, '#forge-user-email input') as HTMLInputElement | null)?.value).toBe(
      'new@example.com'
    );
    expect(h.text(fixture)).toContain('session expired');
  });
});
