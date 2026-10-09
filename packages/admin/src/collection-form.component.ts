import type { ElementRef } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';
import { VoltButton, VoltCard } from '@voltui/components';
import type { FieldMeta } from '@forge-cms/angular';
import { ForgeFieldControlComponent } from './field-control.component.js';
import { normaliseReferences } from './references.js';
import { toSubmitPayload } from './form-payload.js';
import { ForgeModalFocusDirective } from './modal-focus.directive.js';

const FOCUSABLE =
  'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  imports: [VoltButton, VoltCard, ForgeFieldControlComponent, ForgeModalFocusDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #overlay
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      forgeModalFocus
      aria-labelledby="forge-collection-form-title"
      tabindex="-1"
      (keydown.escape)="onCancel()"
      (click)="onCancel()"
    >
      <!-- The card is capped to the dynamic viewport and the form inside it is a column: the title
           and the action row stay put while only the fields scroll, so Save/Cancel are always
           reachable on a small screen (spec 086). -->
      <volt-card
        class="w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-hidden"
        (click)="$event.stopPropagation()"
      >
        <form class="flex max-h-[inherit] min-h-0 flex-col" novalidate (submit)="onSubmit($event)">
          <div class="shrink-0 px-6 pt-6">
            <h2 id="forge-collection-form-title" class="text-lg font-semibold">
              {{ submitLabel() === 'Create' ? 'New document' : 'Edit document' }}
            </h2>
          </div>

          <div class="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
            @for (field of fields(); track field.name) {
              <forge-field-control
                [field]="field"
                [value]="formValue()[field.name]"
                [errors]="fieldErrors()"
                [path]="field.name"
                [locales]="locales()"
                (valueChange)="setValue(field.name, $event)"
              />
            }
          </div>

          <div class="shrink-0 space-y-2 border-t border-border px-6 py-4">
            @if (error(); as message) {
              <p class="text-xs text-destructive" role="alert">{{ message }}</p>
            }
            <p class="sr-only" role="status">{{ submitting() ? 'Saving…' : '' }}</p>
            <div class="flex items-center justify-end gap-2">
              <volt-button
                type="button"
                variant="outline"
                size="sm"
                [disabled]="submitting()"
                (click)="onCancel()"
              >
                Cancel
              </volt-button>
              <volt-button type="submit" size="sm" [disabled]="submitting() || submitDisabled()">
                {{ submitting() ? 'Saving…' : submitLabel() }}
              </volt-button>
            </div>
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
  /** Locales the owning collection supports; forwarded so localized fields can offer a picker. */
  locales = input<string[]>([]);
  /** A save is in flight: the submit control shows "Saving…" and neither it nor cancel can fire. */
  submitting = input(false);
  /** Saving is not currently possible (e.g. the session expired); the entered values stay editable. */
  submitDisabled = input(false);
  /** A request-level problem (failed save, expired session), shown with alert semantics next to the actions. */
  error = input<string | null>(null);

  save = output<Record<string, unknown>>();
  cancel = output<void>();
  /** Emits once, `true`, the first time a field is edited — lets a host offer an unsaved-changes guard. */
  dirtyChange = output<boolean>();

  // `initialValue` arrives via a signal input bound to the parent's editing state; snapshotting it
  // once in a field initializer captures whatever it was at construction time (often the default
  // `{}`, since the parent hasn't necessarily flushed the real value through Angular's change
  // detection yet) rather than reactively reflecting it. `computed` re-derives on every change.
  private readonly edits = signal<Record<string, unknown>>({});
  protected readonly formValue = computed<Record<string, unknown>>(() => ({
    ...normaliseReferences(this.fields(), this.initialValue()),
    ...this.edits()
  }));

  private dirtyEmitted = false;
  private readonly injector = inject(Injector);
  private readonly overlay = viewChild.required<ElementRef<HTMLElement>>('overlay');
  private wasSubmitting = false;

  constructor() {
    // A server validation error moves focus to the first invalid control. It only fires when errors
    // arrive: a network failure or a 5xx has no field to point at and must not steal focus.
    effect(() => {
      if (Object.keys(this.fieldErrors()).length === 0) return;
      afterNextRender(() => this.focusFirstInvalid(), { injector: this.injector });
    });

    // A failed save leaves the (just-disabled) Save button's focus nowhere; put it back.
    effect(() => {
      const submitting = this.submitting();
      const finished = this.wasSubmitting && !submitting;
      this.wasSubmitting = submitting;
      if (!finished) return;
      afterNextRender(
        () => {
          const root = this.overlay().nativeElement;
          if (this.firstInvalid() !== null || root.contains(root.ownerDocument.activeElement)) {
            return;
          }
          root.querySelector<HTMLElement>('button[type="submit"]')?.focus();
        },
        { injector: this.injector }
      );
    });
  }

  /** The first invalid control in document order; a composite's own error only when no child is invalid. */
  private firstInvalid(): HTMLElement | null {
    const flagged = Array.from(
      this.overlay().nativeElement.querySelectorAll<HTMLElement>('[data-forge-invalid]')
    );
    const wrapper =
      flagged.find((element) => element.querySelector('[data-forge-invalid]') === null) ?? null;
    if (wrapper === null) return null;

    const path = wrapper.dataset['forgePath'];
    const control = Array.from(wrapper.querySelectorAll<HTMLElement>('[id]')).find(
      (element) => element.id === path && element.tagName !== 'FIELDSET'
    );
    return control ?? wrapper.querySelector<HTMLElement>(FOCUSABLE);
  }

  private focusFirstInvalid(): void {
    this.firstInvalid()?.focus();
  }

  setValue(name: string, value: unknown): void {
    this.edits.update((current) => ({ ...current, [name]: value }));
    if (!this.dirtyEmitted) {
      this.dirtyEmitted = true;
      this.dirtyChange.emit(true);
    }
  }

  protected onCancel(): void {
    // Cancelling mid-save would leave "was it written?" ambiguous, so it waits for the outcome.
    if (!this.submitting()) this.cancel.emit();
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    if (this.submitting() || this.submitDisabled()) return;
    // Field controls emit already-typed values (numbers as numbers, relations as arrays, composite
    // fields as objects/arrays), so there is nothing left to coerce here. Forge-owned metadata the
    // document was loaded with is not submitted (spec 063).
    this.save.emit(toSubmitPayload(this.formValue()));
  }
}
