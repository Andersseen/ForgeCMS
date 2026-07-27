import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ServiceSummary } from '../../../shared/site-content';

@Component({
  selector: 'lumea-service-card',
  standalone: true,
  imports: [RouterLink, CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a
      [routerLink]="['/services', service().slug]"
      class="group flex h-full flex-col overflow-hidden rounded-2xl border border-border/70 bg-card transition-shadow hover:shadow-lg"
    >
      <div class="aspect-[4/3] overflow-hidden bg-muted">
        @if (service().image; as image) {
          <img
            [src]="image.url"
            [alt]="image.alt"
            class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        }
      </div>

      <div class="flex flex-1 flex-col gap-3 p-5">
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          @if (service().category; as category) {
            <span class="rounded-full bg-muted px-2 py-0.5">{{ category.name }}</span>
          }
          <span>{{ service().durationMinutes }} min</span>
        </div>

        <h3 class="lumea-display text-lg leading-snug">{{ service().name }}</h3>
        <p class="flex-1 text-sm leading-relaxed text-muted-foreground">{{ service().summary }}</p>

        <div class="flex items-baseline justify-between border-t border-border/60 pt-3">
          <span class="text-base font-medium">{{ service().price | currency: 'EUR' }}</span>
          <span class="text-xs text-muted-foreground">{{ service().priceNote }}</span>
        </div>
      </div>
    </a>
  `
})
export class ServiceCard {
  readonly service = input.required<ServiceSummary>();
}
