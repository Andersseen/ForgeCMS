import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SiteApiService } from '../../services/site-api.service';
import { ServiceCard } from './service-card.component';
import { asyncState } from './async-state';
import type { ServiceDetailPayload } from '../../../shared/site-content';

@Component({
  selector: 'lumea-service-detail-page',
  standalone: true,
  imports: [RouterLink, ServiceCard, CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state.loading()) {
      <div class="mx-auto max-w-6xl px-5 py-24 text-sm text-muted-foreground">Loading…</div>
    } @else if (state.error()) {
      <div class="mx-auto max-w-6xl px-5 py-24">
        <h1 class="lumea-display text-3xl">We could not find that treatment</h1>
        <a routerLink="/services" class="mt-4 inline-block text-sm underline underline-offset-4">
          Back to all treatments
        </a>
      </div>
    } @else if (state.data(); as payload) {
      @let service = payload.service;

      <article>
        <section class="lumea-hero border-b border-border/60">
          <div class="mx-auto grid max-w-6xl gap-10 px-5 py-16 md:grid-cols-[1.1fr_1fr]">
            <div>
              @if (service.category; as category) {
                <a
                  routerLink="/services"
                  class="text-xs uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
                >
                  {{ category.name }}
                </a>
              }
              <h1 class="lumea-display mt-4 text-4xl leading-tight">{{ service.name }}</h1>
              <p class="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
                {{ service.summary }}
              </p>

              <dl class="mt-8 flex flex-wrap gap-8 text-sm">
                <div>
                  <dt class="text-muted-foreground">Price</dt>
                  <dd class="mt-1 text-lg font-medium">{{ service.price | currency: 'EUR' }}</dd>
                </div>
                <div>
                  <dt class="text-muted-foreground">Duration</dt>
                  <dd class="mt-1 text-lg font-medium">{{ service.durationMinutes }} min</dd>
                </div>
                @if (service.aftercare?.sessionsRecommended; as sessions) {
                  <div>
                    <dt class="text-muted-foreground">Recommended course</dt>
                    <dd class="mt-1 text-lg font-medium">{{ sessions }} sessions</dd>
                  </div>
                }
                @if (service.aftercare) {
                  <div>
                    <dt class="text-muted-foreground">Downtime</dt>
                    <dd class="mt-1 text-lg font-medium">
                      {{ downtimeLabel(service.aftercare.downtimeDays) }}
                    </dd>
                  </div>
                }
              </dl>

              <a
                routerLink="/booking"
                [queryParams]="{ service: service.slug }"
                class="mt-8 inline-block rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Request this treatment
              </a>
            </div>

            @if (service.image; as image) {
              <img
                [src]="image.url"
                [alt]="image.alt"
                class="aspect-[4/3] w-full rounded-3xl object-cover"
              />
            }
          </div>
        </section>

        <section class="mx-auto grid max-w-6xl gap-12 px-5 py-16 md:grid-cols-[1.4fr_1fr]">
          <div>
            @for (paragraph of service.description; track $index) {
              <p class="mb-4 text-base leading-relaxed">{{ paragraph.text }}</p>
            }

            @if (service.benefits.length > 0) {
              <h2 class="lumea-display mt-10 text-2xl">What it does</h2>
              <ul class="mt-4 space-y-3">
                @for (benefit of service.benefits; track benefit.title) {
                  <li class="rounded-xl border border-border/70 bg-card p-4">
                    <p class="text-sm font-medium">{{ benefit.title }}</p>
                    <p class="mt-1 text-sm text-muted-foreground">{{ benefit.detail }}</p>
                  </li>
                }
              </ul>
            }

            @if (service.faqs.length > 0) {
              <h2 class="lumea-display mt-10 text-2xl">Questions we get asked</h2>
              <div class="mt-4 divide-y divide-border/70 border-y border-border/70">
                @for (faq of service.faqs; track faq.question) {
                  <details class="group py-4">
                    <summary class="cursor-pointer text-sm font-medium">{{ faq.question }}</summary>
                    <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {{ faq.answer }}
                    </p>
                  </details>
                }
              </div>
            }
          </div>

          <aside class="space-y-8">
            @if (service.aftercare?.instructions) {
              <div class="rounded-2xl border border-border/70 bg-card p-5">
                <p class="text-sm font-medium">Aftercare</p>
                <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {{ service.aftercare?.instructions }}
                </p>
              </div>
            }

            @if (payload.specialists.length > 0) {
              <div>
                <p class="text-sm font-medium">Performed by</p>
                <ul class="mt-3 space-y-3">
                  @for (specialist of payload.specialists; track specialist.id) {
                    <li class="flex items-center gap-3">
                      @if (specialist.photo; as photo) {
                        <img
                          [src]="photo.url"
                          [alt]="photo.alt"
                          class="h-11 w-11 rounded-full object-cover"
                        />
                      }
                      <span>
                        <span class="block text-sm">{{ specialist.name }}</span>
                        <span class="block text-xs text-muted-foreground">
                          {{ specialist.jobTitle }}
                        </span>
                      </span>
                    </li>
                  }
                </ul>
              </div>
            }
          </aside>
        </section>

        @if (payload.relatedServices.length > 0) {
          <section class="border-t border-border/60 lumea-band">
            <div class="mx-auto max-w-6xl px-5 py-16">
              <h2 class="lumea-display text-2xl">Others in this category</h2>
              <div class="mt-8 grid gap-6 md:grid-cols-3">
                @for (related of payload.relatedServices; track related.id) {
                  <lumea-service-card [service]="related" />
                }
              </div>
            </div>
          </section>
        }
      </article>
    }
  `
})
export class ServiceDetailPage {
  private readonly api = inject(SiteApiService);

  /** Bound from the route by `withComponentInputBinding()`. */
  readonly slug = input.required<string>();

  protected readonly state = asyncState<ServiceDetailPayload>();

  constructor() {
    effect(() => {
      const slug = this.slug();
      this.state.reload(() => this.api.service(slug));
    });
  }

  protected downtimeLabel(days: number | null): string {
    if (days === null) return 'Ask us';
    if (days === 0) return 'None';
    return days === 1 ? '1 day' : `${days} days`;
  }
}
