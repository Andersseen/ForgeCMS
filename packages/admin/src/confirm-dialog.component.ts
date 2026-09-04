import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { VoltButton, VoltCard } from '@voltui/components';

/**
 * A generic "are you sure?" overlay — the workspace's delete flow needs one (spec 052 §16: a single
 * icon click must not delete content), and it is useful to hosts independently of that.
 *
 * Same hand-rolled overlay chrome as `ForgeCollectionFormComponent`, for the reason documented
 * there: VoltDialog's trigger+TemplateRef composition pattern could not be visually verified here.
 */
@Component({
  selector: 'forge-confirm-dialog',
  standalone: true,
  imports: [VoltButton, VoltCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="forge-confirm-dialog-title"
        aria-describedby="forge-confirm-dialog-message"
        tabindex="-1"
        (keydown.escape)="cancel.emit()"
        (click)="cancel.emit()"
      >
        <volt-card class="w-full max-w-sm space-y-4 p-6" (click)="$event.stopPropagation()">
          <h2 id="forge-confirm-dialog-title" class="text-lg font-semibold">{{ title() }}</h2>
          <p id="forge-confirm-dialog-message" class="text-sm text-muted-foreground">
            {{ message() }}
          </p>

          <div class="flex items-center justify-end gap-2 pt-2">
            <volt-button type="button" variant="outline" size="sm" (click)="cancel.emit()">
              {{ cancelLabel() }}
            </volt-button>
            <volt-button type="button" variant="destructive" size="sm" (click)="confirm.emit()">
              {{ confirmLabel() }}
            </volt-button>
          </div>
        </volt-card>
      </div>
    }
  `
})
export class ForgeConfirmDialogComponent {
  open = input(false);
  title = input.required<string>();
  message = input('This action cannot be undone.');
  confirmLabel = input('Delete');
  cancelLabel = input('Cancel');

  confirm = output<void>();
  cancel = output<void>();
}
