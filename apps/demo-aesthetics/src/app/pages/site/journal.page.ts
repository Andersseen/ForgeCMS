import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SiteApiService } from '../../services/site-api.service';
import { asyncState } from './async-state';

@Component({
  selector: 'lumea-journal-page',
  standalone: true,
  imports: [RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="lumea-hero border-b border-border/60">
      <div class="mx-auto max-w-6xl px-5 py-16">
        <h1 class="lumea-display text-4xl">Journal</h1>
        <p class="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
          What we tell clients in the room, written down. No product placements.
        </p>
      </div>
    </section>

    <section class="mx-auto max-w-4xl px-5 py-16">
      @if (state.loading()) {
        <p class="text-sm text-muted-foreground">Loading…</p>
      } @else if (state.error(); as message) {
        <p class="text-sm text-destructive">{{ message }}</p>
      } @else {
        <div class="space-y-10">
          @for (post of state.data() ?? []; track post.id) {
            <a
              [routerLink]="['/journal', post.slug]"
              class="group grid gap-6 rounded-2xl border border-border/70 bg-card p-5 transition-shadow hover:shadow-md sm:grid-cols-[200px_1fr]"
            >
              <div class="aspect-[4/3] overflow-hidden rounded-xl bg-muted">
                @if (post.coverImage; as cover) {
                  <img [src]="cover.url" [alt]="cover.alt" class="h-full w-full object-cover" />
                }
              </div>
              <div>
                <p class="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                  {{ post.topic }}
                </p>
                <h2 class="lumea-display mt-2 text-xl leading-snug">{{ post.title }}</h2>
                <p class="mt-2 text-sm leading-relaxed text-muted-foreground">{{ post.excerpt }}</p>
                <p class="mt-4 text-xs text-muted-foreground">
                  @if (post.authorName) {
                    {{ post.authorName }} ·
                  }
                  {{ post.publishedAt | date: 'longDate' }} · {{ post.readingMinutes }} min read
                </p>
              </div>
            </a>
          } @empty {
            <p class="text-sm text-muted-foreground">Nothing published yet.</p>
          }
        </div>
      }
    </section>
  `
})
export class JournalPage {
  private readonly api = inject(SiteApiService);
  protected readonly state = asyncState(() => this.api.journal());
}
