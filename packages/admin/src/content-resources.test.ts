// @vitest-environment jsdom
/**
 * The admin as a consumer of `collectionResource`/`documentResource` and `ForgeAuthSession` (spec 077,
 * roadmap C03): the real workspace and editor components, white-box, over a transport whose responses
 * the test settles by hand. Templates are not rendered — the assertions read the same signals the
 * templates bind to.
 */
import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import type { Signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import type { ParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { ForgeAuthSession, provideForgeCms } from '@forge-cms/angular';
import type {
  CollectionMeta,
  ForgeResource,
  ForgeTransport,
  ForgeTransportRequest,
  PaginatedDocuments
} from '@forge-cms/angular';
import { ForgeCollectionWorkspaceComponent } from './collection-workspace.component.js';
import { ForgeDocumentEditorComponent } from './document-editor.component.js';
import { ForgeContentRefresh } from './content-refresh.js';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

interface PendingCall {
  request: ForgeTransportRequest;
  url: string;
  resolve(body: unknown, status?: number): void;
}

/** Never answers on its own and ignores the abort signal — the worst case for staleness. */
class ControlledTransport {
  readonly calls: PendingCall[] = [];

  readonly transport: ForgeTransport = (request) =>
    new Promise<Response>((resolve) => {
      this.calls.push({
        request,
        url: request.url,
        resolve: (body, status = 200) =>
          resolve(
            new Response(body === undefined ? null : JSON.stringify(body), {
              status,
              headers: { 'content-type': 'application/json' }
            })
          )
      });
    });

  to(fragment: string, method = 'GET'): PendingCall[] {
    return this.calls.filter(
      (call) => call.url.includes(fragment) && call.request.method === method
    );
  }

  last(fragment: string, method = 'GET'): PendingCall {
    const call = this.to(fragment, method).at(-1);
    if (call === undefined) throw new Error(`no ${method} request to ${fragment}`);
    return call;
  }
}

const POSTS: CollectionMeta = {
  slug: 'posts',
  name: 'Posts',
  description: '',
  drafts: true,
  useAsTitle: 'title',
  fieldDefinitions: [{ name: 'title', kind: 'text', label: 'Title', required: true }]
};

function page(docs: Record<string, unknown>[]): unknown {
  return {
    data: docs,
    meta: {
      collection: 'posts',
      count: docs.length,
      totalDocs: docs.length,
      page: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPrevPage: false
    }
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  TestBed.tick();
}

let transport: ControlledTransport;
let routeParams: BehaviorSubject<ParamMap>;
let navigate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  transport = new ControlledTransport();
  routeParams = new BehaviorSubject(convertToParamMap({ collection: 'posts' }));
  navigate = vi.fn(async () => true);
  const parentParams = new BehaviorSubject(convertToParamMap({ collection: 'posts' }));
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideForgeCms({ transport: transport.transport }),
      ForgeContentRefresh,
      { provide: Router, useValue: { navigate } },
      {
        provide: ActivatedRoute,
        useValue: { paramMap: routeParams, parent: { paramMap: parentParams } }
      }
    ]
  });
});

afterEach(() => TestBed.resetTestingModule());

/** A signed-in session as `user`, with the bootstrap `/me` answered. */
async function signIn(user: { id: string; role: string }): Promise<ForgeAuthSession> {
  const session = TestBed.inject(ForgeAuthSession);
  transport.last('/api/auth/me').resolve({ data: user });
  await session.ready();
  return session;
}

/** Answers the collection-metadata request every workspace/editor makes first. */
async function answerMeta(): Promise<void> {
  transport.last('/collections').resolve({ data: [POSTS] });
  await settle();
}

interface WorkspaceView {
  documentsResource: ForgeResource<PaginatedDocuments<Record<string, unknown>> | undefined>;
  page: WritableSignal<number>;
  status: WritableSignal<'all' | 'draft' | 'published'>;
  sort: WritableSignal<{ field: string; order: 'asc' | 'desc' } | null>;
  onSearchInput(term: string): void;
}

function workspace(): WorkspaceView {
  const component = TestBed.runInInjectionContext(() => new ForgeCollectionWorkspaceComponent());
  TestBed.tick();
  return component as unknown as WorkspaceView;
}

interface EditorView {
  documentRef: ForgeResource<Record<string, unknown> | undefined>;
  initialValue: Signal<Record<string, unknown>>;
  isCreate: Signal<boolean>;
  dirty: WritableSignal<boolean>;
  saveError: Signal<string | null>;
  fieldErrors: Signal<Record<string, string>>;
  onSave(data: Record<string, unknown>): Promise<void>;
}

function editor(): EditorView {
  const component = TestBed.runInInjectionContext(() => new ForgeDocumentEditorComponent());
  TestBed.tick();
  return component as unknown as EditorView;
}

describe('ForgeCollectionWorkspaceComponent', () => {
  it('fast query changes: only the last query can ever be shown', async () => {
    await signIn({ id: 'editor-1', role: 'editor' });
    const view = workspace();
    await answerMeta();

    const first = transport.last('/posts?');
    view.status.set('published');
    TestBed.tick();
    const second = transport.last('/posts?');
    view.sort.set({ field: 'title', order: 'desc' });
    view.page.set(3);
    TestBed.tick();
    const last = transport.last('/posts?');
    expect(last.url).toContain('status=published');
    expect(last.url).toContain('sort=title&order=desc');
    expect(first.request.signal?.aborted).toBe(true);
    expect(second.request.signal?.aborted).toBe(true);

    last.resolve(page([{ id: 'current', title: 'Current' }]));
    first.resolve(page([{ id: 'stale-1', title: 'Old' }]));
    second.resolve(page([{ id: 'stale-2', title: 'Old' }]));
    await settle();

    expect(view.documentsResource.value()?.docs).toEqual([{ id: 'current', title: 'Current' }]);
    expect(view.documentsResource.error()).toBeNull();
  });

  it('a new query never displays the previous query’s rows while it loads', async () => {
    await signIn({ id: 'editor-1', role: 'editor' });
    const view = workspace();
    await answerMeta();
    transport.last('/posts?').resolve(page([{ id: 'a', title: 'A' }]));
    await settle();
    expect(view.documentsResource.value()?.docs).toHaveLength(1);

    view.status.set('draft');
    TestBed.tick();
    expect(view.documentsResource.value()).toBeUndefined();
    expect(view.documentsResource.isLoading()).toBe(true);
  });

  it('logout drops the previous user’s rows immediately; login as another user reloads as them', async () => {
    const session = await signIn({ id: 'editor-1', role: 'editor' });
    const view = workspace();
    await answerMeta();
    transport.last('/posts?').resolve(page([{ id: 'private-1', title: 'Of editor 1' }]));
    await settle();

    const logout = session.logout();
    transport.last('/logout', 'POST').resolve(undefined, 204);
    await logout;
    expect(view.documentsResource.value()).toBeUndefined();

    const login = session.login('two@example.com', 'pw');
    transport
      .last('/login', 'POST')
      .resolve({ data: { token: 't', user: { id: 'editor-2', role: 'editor' } } });
    await login;
    TestBed.tick();

    // Every list request issued before editor 2 signed in answers late — none may show.
    const requests = transport.to('/posts?');
    const current = requests.at(-1);
    for (const stale of requests.slice(0, -1)) {
      stale.resolve(page([{ id: 'private-1', title: 'Of editor 1' }]));
    }
    current?.resolve(page([{ id: 'private-2', title: 'Of editor 2' }]));
    await settle();
    expect(view.documentsResource.value()?.docs).toEqual([
      { id: 'private-2', title: 'Of editor 2' }
    ]);
  });
});

describe('ForgeDocumentEditorComponent', () => {
  it('A → B: A cannot overwrite B and the editor never shows A while B loads', async () => {
    await signIn({ id: 'editor-1', role: 'editor' });
    routeParams.next(convertToParamMap({ id: 'a' }));
    const view = editor();
    await answerMeta();
    transport.last('/posts/a').resolve({ data: { id: 'a', title: 'A' } });
    await settle();
    expect(view.initialValue()).toEqual({ id: 'a', title: 'A' });
    view.dirty.set(true);

    routeParams.next(convertToParamMap({ id: 'b' }));
    TestBed.tick();
    expect(view.documentRef.value()).toBeUndefined();
    expect(view.initialValue()).toEqual({});
    expect(view.dirty()).toBe(false);

    routeParams.next(convertToParamMap({ id: 'a' }));
    TestBed.tick();
    const aAgain = transport.last('/posts/a');
    routeParams.next(convertToParamMap({ id: 'b' }));
    TestBed.tick();
    transport.last('/posts/b').resolve({ data: { id: 'b', title: 'B' } });
    aAgain.resolve({ data: { id: 'a', title: 'A' } });
    await settle();
    expect(view.initialValue()).toEqual({ id: 'b', title: 'B' });
  });

  it('edit → new: the old document request never refills the create form', async () => {
    await signIn({ id: 'editor-1', role: 'editor' });
    routeParams.next(convertToParamMap({ id: 'a' }));
    const view = editor();
    await answerMeta();
    const a = transport.last('/posts/a');

    routeParams.next(convertToParamMap({}));
    TestBed.tick();
    expect(view.isCreate()).toBe(true);
    a.resolve({ data: { id: 'a', title: 'A' } });
    await settle();
    expect(view.initialValue()).toEqual({});
    expect(view.documentRef.isLoading()).toBe(false);
  });

  it('a failed update is not a successful save', async () => {
    await signIn({ id: 'editor-1', role: 'editor' });
    routeParams.next(convertToParamMap({ id: 'a' }));
    const view = editor();
    await answerMeta();
    transport.last('/posts/a').resolve({ data: { id: 'a', title: 'A' } });
    await settle();
    const refresh = TestBed.inject(ForgeContentRefresh);
    const before = refresh.version();
    view.dirty.set(true);

    const save = view.onSave({ title: '' });
    transport.last('/posts/a', 'PUT').resolve(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid',
          details: [{ field: 'title', message: 'Required', code: 'required' }]
        }
      },
      400
    );
    await save;

    expect(navigate).not.toHaveBeenCalled();
    expect(view.dirty()).toBe(true);
    expect(view.fieldErrors()).toEqual({ title: 'Required' });
    expect(view.saveError()).not.toBeNull();
    expect(refresh.version()).toBe(before);
  });

  it('a failed create (server outage) is not a successful save either', async () => {
    await signIn({ id: 'editor-1', role: 'editor' });
    const view = editor();
    await answerMeta();
    view.dirty.set(true);

    const save = view.onSave({ title: 'New' });
    transport.last('/posts', 'POST').resolve({ error: { code: 'BOOM', message: 'down' } }, 500);
    await save;

    expect(navigate).not.toHaveBeenCalled();
    expect(view.dirty()).toBe(true);
    expect(view.saveError()).not.toBeNull();
  });

  it('a successful save waits for the write before clearing dirty and navigating', async () => {
    await signIn({ id: 'editor-1', role: 'editor' });
    routeParams.next(convertToParamMap({ id: 'a' }));
    const view = editor();
    await answerMeta();
    transport.last('/posts/a').resolve({ data: { id: 'a', title: 'A' } });
    await settle();
    view.dirty.set(true);

    const save = view.onSave({ title: 'A2' });
    await settle();
    expect(navigate).not.toHaveBeenCalled();
    expect(view.dirty()).toBe(true);

    transport.last('/posts/a', 'PUT').resolve({ data: { id: 'a', title: 'A2' } });
    await save;
    expect(view.dirty()).toBe(false);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(view.saveError()).toBeNull();
  });
});
