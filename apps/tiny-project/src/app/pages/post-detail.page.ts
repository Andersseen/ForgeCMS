import { ChangeDetectionStrategy, Component, effect, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

interface PublicPost {
  id: string;
  title: string;
  slug: string;
  body?: unknown;
  author?: { name?: string; email?: string } | string | null;
}

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

    @if (loading()) {
      <p>Loading…</p>
    } @else if (error(); as message) {
      <p class="tiny-error">{{ message }}</p>
    } @else if (post(); as p) {
      <h1>{{ p.title }}</h1>
      @if (authorLabel(); as author) {
        <p>
          <em>By {{ author }}</em>
        </p>
      }
    }
  `
})
export class PostDetailPage {
  readonly slug = input.required<string>();

  protected readonly post = signal<PublicPost | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  constructor() {
    // A required `input()` signal has no value until Angular assigns it after construction —
    // reading it synchronously in the constructor body throws. `effect()` defers until inputs are
    // actually set, matching the pattern apps/demo-aesthetics's own post-detail page already uses.
    effect(() => {
      const slug = this.slug();
      fetch(`/api/site/posts/${encodeURIComponent(slug)}`)
        .then((res) => {
          if (!res.ok)
            throw new Error(res.status === 404 ? 'Not found' : `Request failed: ${res.status}`);
          return res.json() as Promise<{ data: PublicPost }>;
        })
        .then((body) => this.post.set(body.data))
        .catch((err: unknown) =>
          this.error.set(err instanceof Error ? err.message : 'Unknown error')
        )
        .finally(() => this.loading.set(false));
    });
  }

  protected authorLabel(): string | null {
    const author = this.post()?.author;
    if (!author) return null;
    if (typeof author === 'string') return author;
    // `name` is optional and stored as `''` (not absent) when never set — `||` falls through an
    // empty string to `email`, unlike `??`, which only falls through null/undefined.
    return author.name || author.email || null;
  }
}
