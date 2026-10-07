import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { collectionResource } from '@forge-cms/angular';

/** One published post by slug, author populated (`depth: 1`) — SSR-safe like the home page. */
@Component({
  selector: 'tiny-post-detail-page',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="tiny-nav">
      <a routerLink="/">Home</a>
      <a routerLink="/admin">Admin</a>
    </nav>

    @if (result.error(); as error) {
      <p class="tiny-error">{{ error.message }}</p>
    } @else if (result.value()) {
      @if (post(); as p) {
        <h1>{{ p['title'] }}</h1>
        @if (authorLabel(); as author) {
          <p>
            <em>By {{ author }}</em>
          </p>
        }
      } @else {
        <p class="tiny-error">Not found</p>
      }
    } @else {
      <p>Loading…</p>
    }
  `
})
export class PostDetailPage {
  readonly slug = input.required<string>();

  protected readonly result = collectionResource(
    () => ({
      collection: 'posts',
      where: { slug: this.slug() },
      limit: 1,
      depth: 1 as const
    }),
    { transfer: 'public' }
  );

  protected readonly post = computed(() => this.result.value()?.docs[0] ?? null);

  protected readonly authorLabel = computed(() => {
    const author = this.post()?.['author'] as
      | { name?: string; email?: string }
      | string
      | null
      | undefined;
    if (!author) return null;
    if (typeof author === 'string') return author;
    // `name` is optional and stored as `''` (not absent) when never set — `||` falls through an
    // empty string to `email`, unlike `??`, which only falls through null/undefined.
    return author.name || author.email || null;
  });
}
