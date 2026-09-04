import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

interface PublicPost {
  id: string;
  title: string;
  slug: string;
  author?: { name?: string; email?: string } | string | null;
}

/**
 * The whole public site: one list of published posts, fetched from the app-local
 * `/api/site/posts` route (Local API, `overrideAccess: false`) — not `@forge-cms/angular`'s
 * `CmsApiService`, which talks to the authenticated `/api/v1/*` surface. Deliberately no styling
 * framework: this fixture proves integration, not design.
 */
@Component({
  selector: 'tiny-home-page',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="tiny-nav">
      <a routerLink="/">Home</a>
      <a routerLink="/admin">Admin</a>
      <a routerLink="/setup">Setup</a>
    </nav>
    <h1>Tiny project</h1>
    <p>A deliberately tiny external-style ForgeCMS consumer — users, posts, one relation.</p>

    @if (loading()) {
      <p>Loading…</p>
    } @else if (error(); as message) {
      <p class="tiny-error">{{ message }}</p>
    } @else {
      <ul class="tiny-post-list">
        @for (post of posts(); track post.id) {
          <li>
            <a [routerLink]="['/posts', post.slug]">{{ post.title }}</a>
          </li>
        } @empty {
          <li>No published posts yet.</li>
        }
      </ul>
    }
  `
})
export class HomePage {
  protected readonly posts = signal<PublicPost[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  constructor() {
    fetch('/api/site/posts')
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        return res.json() as Promise<{ data: PublicPost[] }>;
      })
      .then((body) => this.posts.set(body.data))
      .catch((err: unknown) => this.error.set(err instanceof Error ? err.message : 'Unknown error'))
      .finally(() => this.loading.set(false));
  }
}
