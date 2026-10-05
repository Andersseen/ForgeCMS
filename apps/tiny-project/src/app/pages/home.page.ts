import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { collectionResource } from '@forge-cms/angular';

/**
 * The whole public site: one list of published posts. Read through `@forge-cms/angular`'s
 * `collectionResource` (anonymous `GET /api/v1/posts`, which returns published posts only) so the same
 * code runs in the browser and during SSR (spec 078) — a raw relative `fetch` cannot run on a server.
 * Deliberately no styling framework: this fixture proves integration, not design.
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

    @if (posts.error(); as error) {
      <p class="tiny-error">{{ error.message }}</p>
    } @else if (posts.value(); as page) {
      <ul class="tiny-post-list">
        @for (post of page.docs; track post.id) {
          <li>
            <a [routerLink]="['/posts', post['slug']]">{{ post['title'] }}</a>
          </li>
        } @empty {
          <li>No published posts yet.</li>
        }
      </ul>
    } @else {
      <p>Loading…</p>
    }
  `
})
export class HomePage {
  protected readonly posts = collectionResource(() => ({
    collection: 'posts',
    sort: 'title',
    limit: 100
  }));
}
