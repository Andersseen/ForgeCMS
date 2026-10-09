// @vitest-environment jsdom
/**
 * Spec 085 (roadmap 0.11 / U01): the real document editor + form, rendered, over a transport the test
 * settles by hand — duplicate writes, lost edits after failures, identity changes, session changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { convertToParamMap } from '@angular/router';
import type { ForgeAuthSession } from '@forge-cms/angular';
import { ForgeDocumentEditorComponent } from './document-editor.component.js';
import { ForgeContentRefresh } from './content-refresh.js';
import * as h from './reliability.test-helpers.js';

let ctx: h.Harness;
let confirmSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  ctx = h.configureHarness();
  confirmSpy = vi.fn(() => true);
  vi.stubGlobal('confirm', confirmSpy);
  window.confirm = confirmSpy as unknown as typeof window.confirm;
});

afterEach(() => {
  TestBed.resetTestingModule();
  vi.unstubAllGlobals();
});

const VALIDATION = {
  error: {
    code: 'VALIDATION_ERROR',
    message: 'Invalid',
    details: [{ field: 'title', message: 'Title is required', code: 'required' }]
  }
};

async function openEditor(
  id: string | undefined,
  doc?: Record<string, unknown>,
  user = { id: 'editor-1', role: 'editor' }
): Promise<{ fixture: ComponentFixture<ForgeDocumentEditorComponent>; session: ForgeAuthSession }> {
  const session = await h.signIn(ctx.transport, user);
  if (id !== undefined) ctx.routeParams.next(convertToParamMap({ id }));
  const fixture = TestBed.createComponent(ForgeDocumentEditorComponent);
  await h.settle();
  await h.answer(ctx.transport, '/collections', { data: [h.POSTS] });
  if (id !== undefined && doc !== undefined) {
    await h.answer(ctx.transport, `/posts/${id}`, { data: doc });
  }
  return { fixture, session };
}

const input = (fixture: ComponentFixture<unknown>, name: string): HTMLInputElement =>
  h.q<HTMLInputElement>(fixture, `input#${name}`) as HTMLInputElement;

const submitButton = (fixture: ComponentFixture<unknown>): HTMLButtonElement =>
  h.qa<HTMLButtonElement>(fixture, 'button[type="submit"]')[0] as HTMLButtonElement;

describe('save state', () => {
  it('a double submit issues exactly one write and shows Saving… while it is in flight', async () => {
    const { fixture } = await openEditor('a', { id: 'a', title: 'A', summary: 's' });
    await h.typeInto(input(fixture, 'title'), 'A2');

    h.submitForm(fixture);
    h.submitForm(fixture);
    await h.settle();

    expect(ctx.transport.to('/posts/a', 'PUT')).toHaveLength(1);
    expect(h.text(fixture)).toContain('Saving…');
    expect(submitButton(fixture).disabled).toBe(true);
    const editor = fixture.componentInstance;
    expect(editor.canDeactivate()).toBeInstanceOf(Promise); // still dirty while the write is in flight
    expect(confirmSpy).not.toHaveBeenCalled(); // spec 086: the prompt is a Forge dialog, never window.confirm

    ctx.transport.last('/posts/a', 'PUT').resolve({ data: { id: 'a', title: 'A2' } });
    await h.settle();
    expect(ctx.navigate).toHaveBeenCalledTimes(1);
    expect(TestBed.inject(ForgeContentRefresh).version()).toBe(1);
    expect(ctx.transport.to('/posts/a', 'PUT')).toHaveLength(1);
  });

  it('a successful save clears dirty before navigating, so leaving does not prompt', async () => {
    const { fixture } = await openEditor('a', { id: 'a', title: 'A' });
    await h.typeInto(input(fixture, 'title'), 'A2');
    ctx.navigate.mockImplementation(async () => fixture.componentInstance.canDeactivate());

    h.submitForm(fixture);
    await h.settle();
    ctx.transport.last('/posts/a', 'PUT').resolve({ data: { id: 'a', title: 'A2' } });
    await h.settle();

    expect(ctx.navigate).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

describe('recoverable failures keep the work', () => {
  it('a validation failure shows field errors, keeps every entered value, and a corrected retry succeeds once', async () => {
    const { fixture } = await openEditor(undefined);
    await h.typeInto(input(fixture, 'summary'), 'keep me');
    await h.typeInto(input(fixture, 'title'), '');

    h.submitForm(fixture);
    await h.settle();
    ctx.transport.last('/posts', 'POST').resolve(VALIDATION, 400);
    await h.settle();

    expect(h.text(fixture)).toContain('Title is required');
    expect(input(fixture, 'summary').value).toBe('keep me');
    expect(submitButton(fixture).disabled).toBe(false);
    expect(fixture.componentInstance.canDeactivate()).toBeInstanceOf(Promise); // still dirty → prompted
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(ctx.navigate).not.toHaveBeenCalled();

    await h.typeInto(input(fixture, 'title'), 'Fixed');
    h.submitForm(fixture);
    await h.settle();
    const retry = ctx.transport.last('/posts', 'POST');
    expect(retry.request.body).toBeDefined();
    expect(JSON.parse(String(retry.request.body))).toMatchObject({
      title: 'Fixed',
      summary: 'keep me'
    });
    retry.resolve({ data: { id: 'n', title: 'Fixed' } }, 201);
    await h.settle();

    expect(ctx.transport.to('/posts', 'POST')).toHaveLength(2);
    expect(ctx.navigate).toHaveBeenCalledTimes(1);
  });

  it('a network failure shows a mapped error, keeps values, and retries with the current values', async () => {
    const { fixture } = await openEditor('a', { id: 'a', title: 'A' });
    await h.typeInto(input(fixture, 'title'), 'Edited');

    h.submitForm(fixture);
    await h.settle();
    ctx.transport.last('/posts/a', 'PUT').fail();
    await h.settle();

    expect(h.text(fixture)).toContain("Couldn't reach the server");
    expect(input(fixture, 'title').value).toBe('Edited');
    expect(ctx.navigate).not.toHaveBeenCalled();

    await h.typeInto(input(fixture, 'summary'), 'more');
    h.submitForm(fixture);
    await h.settle();
    const retry = ctx.transport.last('/posts/a', 'PUT');
    expect(JSON.parse(String(retry.request.body))).toMatchObject({
      title: 'Edited',
      summary: 'more'
    });
    retry.resolve({ data: { id: 'a', title: 'Edited' } });
    await h.settle();
    expect(ctx.navigate).toHaveBeenCalledTimes(1);
  });

  it('a 409 conflict keeps the edits too', async () => {
    const { fixture } = await openEditor('a', { id: 'a', title: 'A' });
    await h.typeInto(input(fixture, 'title'), 'Mine');
    h.submitForm(fixture);
    await h.settle();
    ctx.transport
      .last('/posts/a', 'PUT')
      .resolve({ error: { code: 'CONFLICT', message: 'Changed elsewhere' } }, 409);
    await h.settle();
    expect(h.text(fixture)).toContain('Changed elsewhere');
    expect(input(fixture, 'title').value).toBe('Mine');
  });

  it('a same-document reload (remote refresh) does not wipe unsaved edits', async () => {
    const { fixture } = await openEditor('a', { id: 'a', title: 'A' });
    await h.typeInto(input(fixture, 'title'), 'Mine');

    (
      fixture.componentInstance as unknown as { documentRef: { reload(): void } }
    ).documentRef.reload();
    await h.settle();
    ctx.transport.last('/posts/a').resolve({ data: { id: 'a', title: 'Server changed' } });
    await h.settle();

    expect(input(fixture, 'title').value).toBe('Mine');
  });
});

describe('document identity', () => {
  it('A → B starts a clean draft: A’s edits never appear in B', async () => {
    const { fixture } = await openEditor('a', { id: 'a', title: 'A' });
    await h.typeInto(input(fixture, 'title'), 'A edited');

    ctx.routeParams.next(convertToParamMap({ id: 'b' }));
    await h.settle();
    await h.answer(ctx.transport, '/posts/b', { data: { id: 'b', title: 'B' } });

    expect(input(fixture, 'title').value).toBe('B');
    confirmSpy.mockClear();
    expect(fixture.componentInstance.canDeactivate()).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled(); // B is clean
  });

  it('edit → new starts with an empty form', async () => {
    const { fixture } = await openEditor('a', { id: 'a', title: 'A' });
    await h.typeInto(input(fixture, 'title'), 'A edited');

    ctx.routeParams.next(convertToParamMap({}));
    await h.settle();

    expect(input(fixture, 'title').value).toBe('');
  });

  it('collection X → Y starts with a clean form', async () => {
    const { fixture } = await openEditor('a', { id: 'a', title: 'A' });
    await h.typeInto(input(fixture, 'title'), 'A edited');

    ctx.parentParams.next(convertToParamMap({ collection: 'pages' }));
    await h.settle();
    await h.answer(ctx.transport, '/collections', { data: [h.POSTS, h.PAGES] });
    await h.answer(ctx.transport, '/pages/a', { data: { id: 'a', title: 'Page A' } });

    expect(input(fixture, 'title').value).toBe('Page A');
  });
});

describe('unsaved-changes guard', () => {
  it('prompts only when dirty; Stay keeps the editor and values, Leave lets go (spec 086: no window.confirm)', async () => {
    const { fixture } = await openEditor('a', { id: 'a', title: 'A' });
    expect(fixture.componentInstance.canDeactivate()).toBe(true);
    expect(
      h.q(fixture, '[role="dialog"][aria-labelledby="forge-confirm-dialog-title"]')
    ).toBeNull();

    await h.typeInto(input(fixture, 'title'), 'Mine');
    const stay = fixture.componentInstance.canDeactivate() as Promise<boolean>;
    await h.settle();
    const dialogButtons = h.qa<HTMLButtonElement>(
      fixture,
      '#forge-confirm-dialog-title ~ div button'
    );
    expect(dialogButtons.map((button) => button.textContent?.trim())).toEqual([
      'Stay',
      'Leave without saving'
    ]);
    dialogButtons[0]?.click();
    await h.settle();
    await expect(stay).resolves.toBe(false);
    expect(input(fixture, 'title').value).toBe('Mine');

    const leave = fixture.componentInstance.canDeactivate() as Promise<boolean>;
    await h.settle();
    h.qa<HTMLButtonElement>(fixture, '#forge-confirm-dialog-title ~ div button')[1]?.click();
    await h.settle();
    await expect(leave).resolves.toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

describe('session and permission changes', () => {
  it('a 401 on save keeps the form, reports expiry, writes nothing, and blocks further saves', async () => {
    const { fixture, session } = await openEditor('a', { id: 'a', title: 'A' });
    await h.typeInto(input(fixture, 'title'), 'Mine');

    h.submitForm(fixture);
    await h.settle();
    ctx.transport
      .last('/posts/a', 'PUT')
      .resolve({ error: { code: 'UNAUTHORIZED', message: 'no' } }, 401);
    await h.settle();

    expect(session.expired()).toBe(true);
    expect(h.text(fixture)).toContain('session expired');
    expect(input(fixture, 'title').value).toBe('Mine');
    expect(ctx.navigate).not.toHaveBeenCalled();
    expect(submitButton(fixture).disabled).toBe(true);

    h.submitForm(fixture);
    await h.settle();
    expect(ctx.transport.to('/posts/a', 'PUT')).toHaveLength(1);
  });

  it('a 403 reconciles the session; a demoted viewer can no longer save, edits are kept', async () => {
    const { fixture, session } = await openEditor('a', { id: 'a', title: 'A' });
    await h.typeInto(input(fixture, 'title'), 'Mine');

    h.submitForm(fixture);
    await h.settle();
    ctx.transport
      .last('/posts/a', 'PUT')
      .resolve({ error: { code: 'FORBIDDEN', message: 'no' } }, 403);
    await h.settle();

    expect(h.text(fixture)).toContain("don't have permission");
    const meCalls = ctx.transport.to('/api/auth/me');
    expect(meCalls).toHaveLength(2); // bootstrap + the reconcile
    meCalls[1]?.resolve({ data: { id: 'editor-1', role: 'viewer' } });
    await h.settle();

    expect(session.user()?.role).toBe('viewer');
    expect(input(fixture, 'title').value).toBe('Mine');
    expect(submitButton(fixture).disabled).toBe(true);
    h.submitForm(fixture);
    await h.settle();
    expect(ctx.transport.to('/posts/a', 'PUT')).toHaveLength(1);
  });

  it('a plain logout does not leave the previous user’s document in the form', async () => {
    const { fixture, session } = await openEditor('a', { id: 'a', title: 'Private' });
    const out = session.logout();
    ctx.transport.last('/logout', 'POST').resolve(undefined, 204);
    await out;
    await h.settle();
    expect(h.text(fixture)).not.toContain('Private');
    expect(input(fixture, 'title')).toBeNull();
  });
});
