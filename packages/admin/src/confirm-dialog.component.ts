import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { VoltButton, VoltCard } from '@voltui/components';
import { ForgeModalFocusDirective } from './modal-focus.directive.js';

/**
 * A generic "are you sure?" overlay — the workspace's delete flow needs one (spec 052 §16: a single
 * icon click must not delete content), and it is useful to hosts independently of that.
 *
 * Same hand-rolled overlay chrome as `ForgeCollectionFormComponent`, for the reason documented
 * there: VoltDialog's trigger+TemplateRef composition pattern could not be visually verified here.
 *
 * Focus (spec 086): opening moves focus to the safe choice (Cancel), Tab/Shift+Tab stay inside, and
 * closing restores focus to whatever opened it (see `ForgeModalFocusDirective`).
 */
@Component({
  selector: 'forge-confirm-dialog',
  standalone: true,
  imports: [VoltButton, VoltCard, ForgeModalFocusDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        role="dialog"
        aria-modal="true"
        forgeModalFocus="[data-forge-initial] button"
        aria-labelledby="forge-confirm-dialog-title"
        aria-describedby="forge-confirm-dialog-message"
        tabindex="-1"
        (keydown.escape)="onCancel()"
        (click)="onCancel()"
      >
        <volt-card class="w-full max-w-sm space-y-4 p-6" (click)="$event.stopPropagation()">
          <h2 id="forge-confirm-dialog-title" class="text-lg font-semibold">{{ title() }}</h2>
          <p id="forge-confirm-dialog-message" class="text-sm text-muted-foreground">
            {{ message() }}
          </p>

          @if (error(); as message) {
            <p class="text-xs text-destructive" role="alert">{{ message }}</p>
          }
          <!-- Neutral progress, announced politely; always present so the change is observed. -->
          <p class="sr-only" role="status">{{ pending() ? pendingLabel() : '' }}</p>

          <div class="flex items-center justify-end gap-2 pt-2">
            <volt-button
              data-forge-initial
              type="button"
              variant="outline"
              size="sm"
              [disabled]="pending()"
              (click)="onCancel()"
            >
              {{ cancelLabel() }}
            </volt-button>
            <volt-button
              type="button"
              variant="destructive"
              size="sm"
              [disabled]="pending()"
              (click)="onConfirm()"
            >
              {{ pending() ? pendingLabel() : confirmLabel() }}
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
  /** The confirmed action is in flight: confirm shows `pendingLabel` and neither button can fire. */
  pending = input(false);
  pendingLabel = input('Deleting…');
  /** The last attempt failed. The dialog stays open so confirming again is the retry. */
  error = input<string | null>(null);

  confirm = output<void>();
  cancel = output<void>();

  protected onConfirm(): void {
    if (!this.pending()) this.confirm.emit();
  }

  protected onCancel(): void {
    // Dismissing mid-request would leave "was it deleted?" ambiguous; wait for the outcome.
    if (!this.pending()) this.cancel.emit();
  }
}
