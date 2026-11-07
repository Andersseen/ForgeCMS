import '@strata-sc/server-components/server-only';

import {
  ChangeDetectionStrategy,
  Component,
  ErrorHandler,
  PendingTasks,
  REQUEST_CONTEXT,
  inject,
  input,
  signal
} from '@angular/core';
import type { OnInit } from '@angular/core';
import { RESPONSE } from '@analogjs/router/tokens';
import type { ServerResponse } from '@analogjs/router/tokens';
import { ServerComponent, StrataClientBoundary } from '@strata-sc/server-components';

import { EditorialService } from '../cms/editorial.service';
import type { PostView } from '../cms/editorial.service';
import type { EditorialRequestContext } from '../cms/request-context';
import { getEditorialRuntime } from '../cms/runtime';
import { ReadingSizeIsland } from './reading-size.island';
import { ReviewStatusIsland } from './review-status.island';

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'found'; readonly post: PostView; readonly signedIn: boolean }
  | { readonly kind: 'not-found' };

/**
 * Server-owned rendering of one post. Its implementation, the ForgeCMS runtime and every server-only module
 * it imports stay out of the browser (the client build gets Strata's empty surrogate); the browser receives
 * HTML plus the two islands' public props.
 *
 *  - Identity: ForgeCMS's session adapter, from THIS render's `REQUEST_CONTEXT` headers.
 *  - Visibility: ForgeCMS's collection access rules (Local API, `overrideAccess: false`).
 *  - Not visible (missing, or somebody else's draft): HTTP 404, same page either way.
 *  - Unexpected failure (database down…): reported to Angular's `ErrorHandler`, which the opt-in Strata
 *    `/ssr` contract turns into a generic HTTP 500 document. Never a 200 with half a page.
 *  - Caching: a document rendered for a signed-in caller is `private, no-store`; only the anonymous
 *    rendering of a published post may be stored by a shared cache, always revalidated, varying on the cookie.
 */
@ServerComponent()
@Component({
  selector: 'post-document',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReviewStatusIsland, ReadingSizeIsland, StrataClientBoundary],
  template: `
    @switch (state().kind) {
      @case ('found') {
        @if (found(); as view) {
          <article id="post" [attr.data-post-status]="view.post.status">
            <header>
              @if (view.post.status === 'draft') {
                <p class="badge" data-draft-badge>Draft: visible to you only</p>
              }
              <h1>{{ view.post.title }}</h1>
              <p class="byline" data-byline>By {{ view.post.byline }}</p>
              @if (view.post.summary) {
                <p class="summary">{{ view.post.summary }}</p>
              }
            </header>
            @for (paragraph of view.post.paragraphs; track $index) {
              <p>{{ paragraph }}</p>
            }
            <aside class="tools">
              <reading-size-island
                [articleTitle]="view.post.title"
                [strataClient]="{ articleTitle: view.post.title }"
              />
              @if (view.post.canChangeStatus) {
                <review-status-island
                  [postId]="view.post.id"
                  [initialStatus]="view.post.status"
                  [strataClient]="{ postId: view.post.id, initialStatus: view.post.status }"
                />
              }
            </aside>
          </article>
        }
      }
      @case ('not-found') {
        <main id="post-not-found">
          <h1>Post not found</h1>
          <p>This post does not exist or is not available to you.</p>
        </main>
      }
    }
  `
})
export class PostDocumentServerComponent implements OnInit {
  readonly slug = input.required<string>();

  private readonly context = inject(REQUEST_CONTEXT, {
    optional: true
  }) as EditorialRequestContext | null;
  private readonly response = inject(RESPONSE, { optional: true }) as ServerResponse | null;
  private readonly tasks = inject(PendingTasks);
  private readonly errors = inject(ErrorHandler);

  protected readonly state = signal<State>({ kind: 'loading' });
  protected found(): Extract<State, { kind: 'found' }> | null {
    const state = this.state();
    return state.kind === 'found' ? state : null;
  }

  ngOnInit(): void {
    // Buffered SSR waits for this task before serializing the document.
    void this.tasks.run(() => this.load());
  }

  private async load(): Promise<void> {
    this.setHeader('cache-control', 'private, no-store');
    this.setHeader('vary', 'Cookie, Authorization');
    if (!this.context) {
      // No server request context (should not happen under SSR): render nothing private.
      this.notFound();
      return;
    }
    try {
      const service = new EditorialService(await getEditorialRuntime(this.context.env));
      const editor = await service.resolveEditor(this.context.headers);
      const post = await service.readBySlug(this.slug(), editor);
      if (!post) {
        this.notFound();
        return;
      }
      if (!editor && post.status === 'published') {
        // Storable by a shared cache, but ALWAYS revalidated: an unpublished (retracted) post must disappear
        // at once, not after a TTL. (A max-age here kept a retracted post visible; see the adoption report.)
        this.setHeader('cache-control', 'public, no-cache');
      }
      this.state.set({ kind: 'found', post, signedIn: editor !== null });
    } catch (error) {
      // Unexpected: the /ssr failure contract answers a generic 500 for this request.
      this.errors.handleError(error);
    }
  }

  private notFound(): void {
    if (this.response) this.response.statusCode = 404;
    this.state.set({ kind: 'not-found' });
  }

  private setHeader(name: string, value: string): void {
    if (this.response && !this.response.headersSent) this.response.setHeader(name, value);
  }
}
