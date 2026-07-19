import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import {
  VoltButton,
  VoltCard,
  VoltError,
  VoltInput,
  VoltLabel,
  VoltSwitch,
  VoltTextarea
} from '@voltui/components';
import type { FieldMeta } from '@forge-cms/angular';

/**
 * Modal chrome is hand-rolled (plain Tailwind overlay), not @voltui/components' VoltDialog: that
 * component composes via a CDK-style trigger+TemplateRef pattern that couldn't be visually verified
 * in this environment, and getting it wrong would break the CRUD demo entirely. VoltCard/VoltInput/
 * VoltSwitch/etc. (simple signal-model form controls) are used as designed.
 */
@Component({
  selector: 'forge-collection-form',
  standalone: true,
  imports: [VoltButton, VoltCard, VoltInput, VoltTextarea, VoltSwitch, VoltLabel, VoltError],
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
            <div class="space-y-1.5">
              <volt-label [htmlFor]="field.name" [error]="!!fieldErrors()[field.name]">
                {{ field.label }}
                @if (field.required) {
                  <span class="text-destructive">&nbsp;*</span>
                }
              </volt-label>

              @switch (field.kind) {
                @case ('textarea') {
                  <volt-textarea
                    [id]="field.name"
                    [value]="getStringValue(field.name)"
                    (valueChange)="setValue(field.name, $event)"
                  />
                }
                @case ('json') {
                  <volt-textarea
                    [id]="field.name"
                    [value]="getStringValue(field.name)"
                    (valueChange)="setValue(field.name, $event)"
                  />
                }
                @case ('boolean') {
                  <volt-switch
                    [id]="field.name"
                    [checked]="getBooleanValue(field.name)"
                    (checkedChange)="setValue(field.name, $event)"
                  />
                }
                @case ('select') {
                  <select
                    [id]="field.name"
                    class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    [value]="getStringValue(field.name)"
                    (change)="onSelectChange(field.name, $event)"
                  >
                    <option value="">Select…</option>
                    @for (opt of field.options ?? []; track opt) {
                      <option [value]="opt">{{ opt }}</option>
                    }
                  </select>
                }
                @case ('relation') {
                  <volt-input
                    [id]="field.name"
                    type="text"
                    [value]="getRelationValue(field.name)"
                    (valueChange)="
                      setRelationValue(field.name, $event, field.relation?.many === true)
                    "
                    [placeholder]="
                      field.relation?.many === true ? 'Comma-separated IDs' : 'Related document ID'
                    "
                  />
                }
                @case ('number') {
                  <volt-input
                    [id]="field.name"
                    type="number"
                    [value]="getStringValue(field.name)"
                    (valueChange)="setValue(field.name, $event)"
                  />
                }
                @case ('date') {
                  <volt-input
                    [id]="field.name"
                    type="date"
                    [value]="getStringValue(field.name)"
                    (valueChange)="setValue(field.name, $event)"
                  />
                }
                @case ('email') {
                  <volt-input
                    [id]="field.name"
                    type="email"
                    [value]="getStringValue(field.name)"
                    (valueChange)="setValue(field.name, $event)"
                  />
                }
                @default {
                  <volt-input
                    [id]="field.name"
                    type="text"
                    [value]="getStringValue(field.name)"
                    (valueChange)="setValue(field.name, $event)"
                  />
                }
              }

              @if (fieldErrors()[field.name]; as message) {
                <volt-error>{{ message }}</volt-error>
              }
            </div>
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

  getStringValue(name: string): string {
    const value = this.formValue()[name];
    return value === undefined || value === null ? '' : String(value);
  }

  getRelationValue(name: string): string {
    const value = this.formValue()[name];
    if (Array.isArray(value)) return value.join(', ');
    return value === undefined || value === null ? '' : String(value);
  }

  getBooleanValue(name: string): boolean {
    return Boolean(this.formValue()[name]);
  }

  setRelationValue(name: string, value: string, many: boolean): void {
    if (many) {
      const ids = value
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
      this.setValue(name, ids.length > 0 ? ids : []);
    } else {
      this.setValue(name, value);
    }
  }

  setValue(name: string, value: unknown): void {
    this.edits.update((current) => ({ ...current, [name]: value }));
  }

  onSelectChange(name: string, event: Event): void {
    this.setValue(name, (event.target as HTMLSelectElement).value);
  }

  onSubmit(event: Event): void {
    event.preventDefault();

    const fields = this.fields();
    const coerced: Record<string, unknown> = { ...this.formValue() };
    for (const field of fields) {
      if (field.kind === 'number' && coerced[field.name] !== undefined) {
        coerced[field.name] = Number(coerced[field.name]);
      }
    }

    this.save.emit(coerced);
  }
}
