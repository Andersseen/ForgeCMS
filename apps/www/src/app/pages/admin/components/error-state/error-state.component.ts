import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { VoltButton, VoltCard } from '@voltui/components';
import { IconAlertCircle } from '../../../../components/icons';

@Component({
  selector: 'forge-error-state',
  standalone: true,
  imports: [VoltCard, VoltButton, IconAlertCircle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <volt-card class="p-8">
      <div class="text-center space-y-3">
        <div
          class="h-12 w-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto"
        >
          <icon-alert-circle class="h-6 w-6" />
        </div>
        <h3 class="text-sm font-medium">{{ title() }}</h3>
        @if (message()) {
          <p class="text-xs text-muted-foreground max-w-sm mx-auto">{{ message() }}</p>
        }
        @if (showRetry()) {
          <volt-button size="sm" (click)="retry.emit()">Retry</volt-button>
        }
      </div>
    </volt-card>
  `
})
export class ErrorStateComponent {
  title = input.required<string>();
  message = input<string | null>();
  showRetry = input(true);
  retry = output<void>();
}
