import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
  signal
} from '@angular/core';

type PostStatus = 'draft' | 'published';

/**
 * Browser-owned client island: publish / unpublish one post. It receives only public props (id + current
 * status) through `[strataClient]`; the server re-checks identity, CSRF and ForgeCMS's update access rule on
 * every request. While a request is in flight the button is disabled, so one interaction = one request.
 */
@Component({
  selector: 'review-status-island',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="status" data-review-status [attr.data-status]="status()">
      Status: <strong>{{ status() === 'published' ? 'Published' : 'Draft' }}</strong>
    </p>
    <button type="button" data-review-toggle [disabled]="pending()" (click)="toggle()">
      {{ actionLabel() }}
    </button>
    <output data-review-result aria-live="polite">{{ message() }}</output>
  `
})
export class ReviewStatusIsland {
  readonly postId = input.required<string>();
  readonly initialStatus = input.required<PostStatus>();

  protected readonly status = linkedSignal(() => this.initialStatus());
  protected readonly pending = signal(false);
  protected readonly message = signal('');
  protected readonly actionLabel = computed(() =>
    this.pending() ? 'Saving…' : this.status() === 'published' ? 'Unpublish' : 'Publish'
  );

  protected async toggle(): Promise<void> {
    if (this.pending()) return;
    const next: PostStatus = this.status() === 'published' ? 'draft' : 'published';
    this.pending.set(true);
    this.message.set('');
    try {
      const response = await fetch(
        `/api/editorial/posts/${encodeURIComponent(this.postId())}/status`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: next })
        }
      );
      if (!response.ok) {
        this.message.set(`Could not update the post (${response.status}). Nothing was changed.`);
        return;
      }
      const body = (await response.json()) as { data?: { status?: PostStatus } };
      this.status.set(body.data?.status === 'published' ? 'published' : 'draft');
      this.message.set(this.status() === 'published' ? 'Published.' : 'Moved back to draft.');
    } catch {
      this.message.set('The editorial service is unreachable. Nothing was changed; try again.');
    } finally {
      this.pending.set(false);
    }
  }
}
