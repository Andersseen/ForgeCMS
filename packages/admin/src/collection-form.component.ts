import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { VoltButton, VoltCard } from '@voltui/components';
import type { FieldMeta } from '@forge-cms/angular';
import { ForgeFieldControlComponent } from './field-control.component.js';

/**
 * Modal chrome is hand-rolled (plain Tailwind overlay), not @voltui/components' VoltDialog: that
 * component composes via a CDK-style trigger+TemplateRef pattern that couldn't be visually verified
 * in this environment, and getting it wrong would break the CRUD demo entirely.
 *
 * Rendering a single field is `ForgeFieldControlComponent`'s job — it recurses, so this form handles
 * arbitrarily nested `group`/`array`/`blocks` fields (spec 022) without knowing they exist.
 */
@Component({
  selector: 'forge-collection-form',
  standalone: true,
  imports: [VoltButton, VoltCard, ForgeFieldControlComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      (click)="cancel.emit()"
    >
      <volt-card
        class="w-full max-w-lg p-6 space-y-4 max-h-[85vh] overflow-y-auto"
        (click)="$event.stopPropagation()"
      >
        <h2 class="text-lg font-semibold">
          {{ submitLabel() === 'Create' ? 'New document' : 'Edit document' }}
        </h2>

        <form class="space-y-4" (submit)="onSubmit($event)">
          @for (field of fields(); track field.name) {
            <forge-field-control
              [field]="field"
              [value]="formValue()[field.name]"
              [errors]="fieldErrors()"
              [path]="field.name"
              (valueChange)="setValue(field.name, $event)"
            />
          }

          <div class="flex items-center justify-end gap-2 pt-2">
            <volt-button type="button" variant="outline" size="sm" (click)="cancel.emit()">
              Cancel
            </volt-button>
            <volt-button type="submit" size="sm">{{ submitLabel() }}</volt-button>
          </div>
        </form>
      </volt-card>
    </div>
  `
})
export class ForgeCollectionFormComponent {
  fields = input.required<FieldMeta[]>();
  initialValue = input<Record<string, unknown>>({});
  fieldErrors = input<Record<string, string>>({});
  submitLabel = input('Save');

  save = output<Record<string, unknown>>();
  cancel = output<void>();

  // `initialValue` arrives via a signal input bound to the parent's editing state; snapshotting it
  // once in a field initializer captures whatever it was at construction time (often the default
  // `{}`, since the parent hasn't necessarily flushed the real value through Angular's change
  // detection yet) rather than reactively reflecting it. `computed` re-derives on every change.
  private readonly edits = signal<Record<string, unknown>>({});
  protected readonly formValue = computed<Record<string, unknown>>(() => ({
    ...this.initialValue(),
    ...this.edits()
  }));

  setValue(name: string, value: unknown): void {
    this.edits.update((current) => ({ ...current, [name]: value }));
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    // Field controls emit already-typed values (numbers as numbers, relations as arrays, composite
    // fields as objects/arrays), so there is nothing left to coerce here.
    this.save.emit({ ...this.formValue() });
  }
}
