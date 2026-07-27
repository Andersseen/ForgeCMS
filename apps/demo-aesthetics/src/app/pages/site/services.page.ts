import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { SiteApiService } from '../../services/site-api.service';
import { ServiceCard } from './service-card.component';
import { asyncState } from './async-state';

@Component({
  selector: 'lumea-services-page',
  standalone: true,
  imports: [ServiceCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="lumea-hero border-b border-border/60">
      <div class="mx-auto max-w-6xl px-5 py-16">
        <h1 class="lumea-display text-4xl">Treatments</h1>
        <p class="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
          Prices are per session and include the consultation. Courses are quoted after your first
          skin reading — we never sell a package before we have seen the skin.
        </p>
      </div>
    </section>

    <section class="mx-auto max-w-6xl px-5 py-12">
      @if (state.loading()) {
        <p class="text-sm text-muted-foreground">Loading the menu…</p>
      } @else if (state.error(); as message) {
        <p class="text-sm text-destructive">{{ message }}</p>
      } @else {
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            (click)="activeCategory.set(null)"
            class="rounded-full border px-4 py-1.5 text-sm transition-colors"
            [class]="
              activeCategory() === null
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border hover:bg-muted'
            "
          >
            All
          </button>
          @for (category of state.data()?.categories ?? []; track category.id) {
            <button
              type="button"
              (click)="activeCategory.set(category.id)"
              class="rounded-full border px-4 py-1.5 text-sm transition-colors"
              [class]="
                activeCategory() === category.id
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border hover:bg-muted'
              "
            >
              {{ category.name }}
            </button>
          }
        </div>

        <div class="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          @for (service of visibleServices(); track service.id) {
            <lumea-service-card [service]="service" />
          } @empty {
            <p class="text-sm text-muted-foreground">No treatments in this category yet.</p>
          }
        </div>
      }
    </section>
  `
})
export class ServicesPage {
  private readonly api = inject(SiteApiService);

  protected readonly state = asyncState(() => this.api.services());
  protected readonly activeCategory = signal<string | null>(null);

  /**
   * Filtering happens client-side over the whole (small) menu. A larger catalogue would want
   * `?where[category]=…` per click, which the API supports — but `CmsApiService` cannot express it
   * and a purpose-built endpoint would need a parameter per filter (finding 15).
   */
  protected readonly visibleServices = computed(() => {
    const services = this.state.data()?.services ?? [];
    const category = this.activeCategory();
    return category === null
      ? services
      : services.filter((service) => service.category?.id === category);
  });
}
