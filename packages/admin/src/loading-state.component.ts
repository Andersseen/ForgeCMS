import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { VoltCard } from '@voltui/components';

@Component({
  selector: 'forge-loading-state',
  standalone: true,
  imports: [VoltCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (variant()) {
      @case ('stat-grid') {
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          @for (_ of [1, 2, 3, 4]; track $index) {
            <volt-card class="p-4">
              <div class="animate-pulse space-y-3">
                <div class="h-4 bg-muted rounded w-24"></div>
                <div class="h-8 bg-muted rounded w-16"></div>
                <div class="h-3 bg-muted rounded w-32"></div>
              </div>
            </volt-card>
          }
        </div>
      }
      @case ('image-grid') {
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          @for (_ of [1, 2, 3, 4, 5, 6, 7, 8]; track $index) {
            <volt-card class="overflow-hidden">
              <div class="aspect-square bg-muted animate-pulse"></div>
              <div class="p-3 space-y-2">
                <div class="h-4 bg-muted rounded w-3/4"></div>
                <div class="h-3 bg-muted rounded w-1/2"></div>
              </div>
            </volt-card>
          }
        </div>
      }
      @case ('table') {
        <volt-card class="overflow-hidden p-6">
          <div class="animate-pulse space-y-3">
            @for (_ of [1, 2, 3, 4, 5]; track $index) {
              <div class="h-10 bg-muted rounded"></div>
            }
          </div>
        </volt-card>
      }
      @case ('blocks') {
        <div class="animate-pulse space-y-4 max-w-2xl">
          <div class="h-48 bg-muted rounded-lg"></div>
          <div class="h-48 bg-muted rounded-lg"></div>
        </div>
      }
      @default {
        <div class="flex items-center justify-center py-12">
          <div
            class="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
          ></div>
        </div>
      }
    }
  `
})
export class LoadingStateComponent {
  variant = input<'spinner' | 'stat-grid' | 'image-grid' | 'table' | 'blocks'>('spinner');
}
