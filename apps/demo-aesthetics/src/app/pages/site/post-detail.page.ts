import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SiteApiService } from '../../services/site-api.service';
import { asyncState } from './async-state';
import type { PostDetail } from '../../../shared/site-content';

@Component({
  selector: 'lumea-post-detail-page',
  standalone: true,
  imports: [RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state.loading()) {
      <div class="mx-auto max-w-3xl px-5 py-24 text-sm text-muted-foreground">Loading…</div>
    } @else if (state.error()) {
      <div class="mx-auto max-w-3xl px-5 py-24">
        <h1 class="lumea-display text-3xl">That entry is not published</h1>
        <p class="mt-3 text-sm text-muted-foreground">
          Draft posts are invisible to visitors — that is the CMS doing its job.
        </p>
        <a routerLink="/journal" class="mt-4 inline-block text-sm underline underline-offset-4">
          Back to the journal
        </a>
      </div>
    } @else if (state.data(); as post) {
      <article class="mx-auto max-w-3xl px-5 py-16">
        <p class="text-xs uppercase tracking-[0.15em] text-muted-foreground">{{ post.topic }}</p>
        <h1 class="lumea-display mt-3 text-4xl leading-tight">{{ post.title }}</h1>
        <p class="mt-4 text-sm text-muted-foreground">
          @if (post.authorName) {
            {{ post.authorName }} ·
          }
          {{ post.publishedAt | date: 'longDate' }} · {{ post.readingMinutes }} min read
        </p>

        @if (post.coverImage; as cover) {
          <img
            [src]="cover.url"
            [alt]="cover.alt"
            class="mt-8 aspect-[16/9] w-full rounded-3xl object-cover"
          />
        }

        <div class="mt-10">
          @for (paragraph of post.body; track $index) {
            <p class="mb-5 text-base leading-relaxed">{{ paragraph.text }}</p>
          }
        </div>

        <a routerLink="/journal" class="mt-10 inline-block text-sm underline underline-offset-4">
          ← All entries
        </a>
      </article>
    }
  `
})
export class PostDetailPage {
  private readonly api = inject(SiteApiService);

  readonly slug = input.required<string>();

  protected readonly state = asyncState<PostDetail>();

  constructor() {
    effect(() => {
      const slug = this.slug();
      this.state.reload(() => this.api.post(slug));
    });
  }
}
