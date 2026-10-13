import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { collectionResource } from '@forge-cms/angular';

@Component({
  selector: 'app-home-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>My site</h1>
    <a routerLink="/admin">Admin</a>
    @if (posts.error(); as error) {
      <p>{{ error.message }}</p>
    } @else if (posts.value(); as page) {
      <ul>
        @for (post of page.docs; track post.id) {
          <li>{{ post['title'] }}</li>
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
  // Anonymous read of published posts through the typed client.
  protected readonly posts = collectionResource(() => ({
    collection: 'posts',
    sort: 'title',
    limit: 20
  }));
}
