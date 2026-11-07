import { ChangeDetectionStrategy, Component, afterNextRender, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { StrataDocumentLink } from '@strata-sc/server-components/navigation';

interface PostSummary {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly byline: string;
}

/**
 * A CONVENTIONAL Angular route (no Server Component): browser-owned, it loads the published list from the
 * Strata controller after hydration. Links into the Server Component route are document links.
 */
@Component({
  selector: 'app-desk-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StrataDocumentLink, RouterLink],
  template: `
    <main id="desk">
      <h1>Editorial desk</h1>
      <p><a routerLink="/login" data-login-link>Editor sign-in</a></p>
      @switch (state()) {
        @case ('loading') {
          <p data-desk-loading>Loading published posts…</p>
        }
        @case ('error') {
          <p data-desk-error>Published posts are unavailable right now.</p>
        }
        @default {
          <ul data-desk-list>
            @for (post of posts(); track post.slug) {
              <li>
                <a [strataDocumentLink]="['/posts', post.slug]">{{ post.title }}</a>
                <span> by {{ post.byline }}</span>
              </li>
            } @empty {
              <li>No published posts yet.</li>
            }
          </ul>
        }
      }
    </main>
  `
})
export default class DeskPage {
  protected readonly posts = signal<readonly PostSummary[]>([]);
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');

  constructor() {
    afterNextRender(() => void this.load());
  }

  private async load(): Promise<void> {
    try {
      const response = await fetch('/api/editorial/posts', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { data?: PostSummary[] };
      this.posts.set(body.data ?? []);
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }
}
