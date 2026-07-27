import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SiteApiService } from '../../services/site-api.service';
import { ServiceCard } from './service-card.component';
import { asyncState } from './async-state';
import type { PageBlock } from '../../../shared/site-content';

/**
 * The home page has no fixed layout: it renders whatever blocks the editor arranged on the `home`
 * document, in order. Add a `cta` block in /admin and it appears here without a deploy.
 *
 * FINDING 16: a `blocks` row is typed as `BlockValue` (`Record<string, unknown> & { blockType }`),
 * so the render site casts each row by hand. There is no per-block type inference and no compile-
 * time link between the block definition and the template that draws it.
 */
interface HeroBlock extends PageBlock {
  eyebrow?: string;
  heading?: string;
  subheading?: string;
  primaryCtaLabel?: string;
  primaryCtaHref?: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
}

interface StatBandBlock extends PageBlock {
  stats?: { value: string; label: string }[];
}

interface FeaturedServicesBlock extends PageBlock {
  heading?: string;
  intro?: string;
  limit?: number;
}

interface RichTextBlock extends PageBlock {
  heading?: string;
  body?: string;
  align?: string;
}

interface TestimonialsBlock extends PageBlock {
  heading?: string;
  limit?: number;
}

interface CtaBlock extends PageBlock {
  heading?: string;
  body?: string;
  ctaLabel?: string;
  ctaHref?: string;
}

@Component({
  selector: 'lumea-home-page',
  standalone: true,
  imports: [RouterLink, ServiceCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state.loading()) {
      <div class="mx-auto max-w-6xl px-5 py-24 text-sm text-muted-foreground">Loading…</div>
    } @else if (state.error(); as message) {
      <div class="mx-auto max-w-6xl px-5 py-24 text-sm text-destructive">{{ message }}</div>
    } @else if (state.data(); as home) {
      @for (block of home.page?.sections ?? []; track $index) {
        @switch (block.blockType) {
          @case ('hero') {
            @let hero = asHero(block);
            <section class="lumea-hero">
              <div
                class="mx-auto grid max-w-6xl gap-10 px-5 py-20 md:grid-cols-[1.15fr_1fr] md:py-28"
              >
                <div>
                  @if (hero.eyebrow) {
                    <p class="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      {{ hero.eyebrow }}
                    </p>
                  }
                  <h1 class="lumea-display mt-4 text-4xl leading-tight md:text-5xl">
                    {{ hero.heading }}
                  </h1>
                  <p class="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
                    {{ hero.subheading }}
                  </p>
                  <div class="mt-8 flex flex-wrap gap-3">
                    @if (hero.primaryCtaLabel) {
                      <a
                        [routerLink]="hero.primaryCtaHref"
                        class="rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90"
                      >
                        {{ hero.primaryCtaLabel }}
                      </a>
                    }
                    @if (hero.secondaryCtaLabel) {
                      <a
                        [routerLink]="hero.secondaryCtaHref"
                        class="rounded-full border border-border px-6 py-3 text-sm font-medium hover:bg-muted"
                      >
                        {{ hero.secondaryCtaLabel }}
                      </a>
                    }
                  </div>
                </div>

                @if (home.promotion; as promotion) {
                  <aside
                    class="self-center rounded-3xl border border-border/70 bg-card/80 p-7 backdrop-blur"
                  >
                    <p class="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      Current offer
                    </p>
                    <p class="lumea-display mt-3 text-2xl">{{ promotion.title }}</p>
                    <p class="mt-3 text-sm leading-relaxed text-muted-foreground">
                      {{ promotion.description }}
                    </p>
                    @if (promotion.code) {
                      <p class="mt-5 text-sm">
                        Code
                        <span class="rounded-md bg-muted px-2 py-1 font-mono">{{
                          promotion.code
                        }}</span>
                      </p>
                    }
                  </aside>
                }
              </div>
            </section>
          }

          @case ('stat_band') {
            @let band = asStatBand(block);
            <section class="border-y border-border/60 lumea-band">
              <div class="mx-auto grid max-w-6xl gap-8 px-5 py-10 sm:grid-cols-2 md:grid-cols-4">
                @for (stat of band.stats ?? []; track stat.label) {
                  <div>
                    <p class="lumea-display text-2xl">{{ stat.value }}</p>
                    <p class="mt-1 text-sm text-muted-foreground">{{ stat.label }}</p>
                  </div>
                }
              </div>
            </section>
          }

          @case ('featured_services') {
            @let featured = asFeaturedServices(block);
            <section class="mx-auto max-w-6xl px-5 py-20">
              <div class="max-w-2xl">
                <h2 class="lumea-display text-3xl">{{ featured.heading }}</h2>
                <p class="mt-3 text-base leading-relaxed text-muted-foreground">
                  {{ featured.intro }}
                </p>
              </div>
              <div class="mt-10 grid gap-6 md:grid-cols-3">
                @for (
                  service of home.featuredServices.slice(0, featured.limit ?? 3);
                  track service.id
                ) {
                  <lumea-service-card [service]="service" />
                }
              </div>
              <a
                routerLink="/services"
                class="mt-8 inline-block text-sm font-medium underline underline-offset-4"
              >
                See the full treatment menu →
              </a>
            </section>
          }

          @case ('rich_text') {
            @let richText = asRichText(block);
            <section class="border-y border-border/60 lumea-band">
              <div
                class="mx-auto max-w-3xl px-5 py-16"
                [class.text-center]="richText.align === 'center'"
              >
                <h2 class="lumea-display text-2xl">{{ richText.heading }}</h2>
                <p class="mt-4 text-base leading-relaxed text-muted-foreground">
                  {{ richText.body }}
                </p>
              </div>
            </section>
          }

          @case ('testimonials') {
            @let quotes = asTestimonials(block);
            <section class="mx-auto max-w-6xl px-5 py-20">
              <h2 class="lumea-display text-3xl">{{ quotes.heading }}</h2>
              <div class="mt-10 grid gap-6 md:grid-cols-3">
                @for (
                  testimonial of home.testimonials.slice(0, quotes.limit ?? 3);
                  track testimonial.id
                ) {
                  <figure class="rounded-2xl border border-border/70 bg-card p-6">
                    <div class="text-sm tracking-widest text-primary">
                      {{ stars(testimonial.rating) }}
                    </div>
                    <blockquote class="mt-4 text-sm leading-relaxed">
                      “{{ testimonial.quote }}”
                    </blockquote>
                    <figcaption class="mt-5 text-xs text-muted-foreground">
                      {{ testimonial.author }}
                      @if (testimonial.serviceName) {
                        · {{ testimonial.serviceName }}
                      }
                    </figcaption>
                  </figure>
                }
              </div>
            </section>
          }

          @case ('cta') {
            @let cta = asCta(block);
            <section class="border-t border-border/60 lumea-hero">
              <div class="mx-auto max-w-3xl px-5 py-20 text-center">
                <h2 class="lumea-display text-3xl">{{ cta.heading }}</h2>
                <p class="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
                  {{ cta.body }}
                </p>
                <a
                  [routerLink]="cta.ctaHref"
                  class="mt-8 inline-block rounded-full bg-primary px-7 py-3 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  {{ cta.ctaLabel }}
                </a>
              </div>
            </section>
          }
        }
      }
    }
  `
})
export class HomePage {
  private readonly api = inject(SiteApiService);

  protected readonly state = asyncState(() => this.api.home());

  protected asHero(block: PageBlock): HeroBlock {
    return block as HeroBlock;
  }

  protected asStatBand(block: PageBlock): StatBandBlock {
    return block as StatBandBlock;
  }

  protected asFeaturedServices(block: PageBlock): FeaturedServicesBlock {
    return block as FeaturedServicesBlock;
  }

  protected asRichText(block: PageBlock): RichTextBlock {
    return block as RichTextBlock;
  }

  protected asTestimonials(block: PageBlock): TestimonialsBlock {
    return block as TestimonialsBlock;
  }

  protected asCta(block: PageBlock): CtaBlock {
    return block as CtaBlock;
  }

  protected stars(rating: number): string {
    return '★★★★★'.slice(0, Math.max(0, Math.min(5, rating)));
  }
}
