import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { VoltCard } from '@voltui/components';

@Component({
  selector: 'forge-empty-state',
  standalone: true,
  imports: [VoltCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <volt-card class="p-8">
      <div class="text-center space-y-3">
        <div
          class="h-12 w-12 rounded-full bg-muted text-muted-foreground flex items-center justify-center mx-auto"
        >
          <ng-content select="[icon]" />
        </div>
        <h3 class="text-sm font-medium">{{ title() }}</h3>
        @if (message()) {
          <p class="text-xs text-muted-foreground max-w-sm mx-auto">{{ message() }}</p>
        }
      </div>
    </volt-card>
  `
})
export class EmptyStateComponent {
  title = input.required<string>();
  message = input<string>();
}
