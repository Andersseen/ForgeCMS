import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  forwardRef,
  inject,
  input,
  output,
  signal,
  viewChild,
  viewChildren
} from '@angular/core';
import { VoltButton, VoltInput, VoltSwitch, VoltTextarea } from '@voltui/components';
import type { BlockMeta, FieldMeta } from '@forge-cms/angular';
import { ForgeRelationPickerComponent } from './relation-picker.component.js';
import { ForgeUploadPickerComponent } from './upload-picker.component.js';
import { ForgeRichTextEditorComponent } from './richtext-editor.component.js';
import { ForgeControlA11yDirective } from './control-a11y.directive.js';
import {
  fromDateInputValue,
  fromDateTimeLocalValue,
  toDateInputValue,
  toDateTimeLocalValue
} from './date-value.js';

const FOCUSABLE =
  'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])';

/** Kinds whose control is a native `<input>`/`<textarea>`/`<select>` that can carry `required`. */
const NATIVE_REQUIRED_KINDS = new Set([
  'text',
  'slug',
  'email',
  'number',
  'date',
  'textarea',
  'json',
  'select'
]);

/**
 * Renders a single field, recursing into itself for the composite kinds (`group`, `array`,
 * `blocks`) added in spec 022. Nesting is arbitrary — a group inside an array inside a group renders
 * correctly because this component is in its own `imports` (via `forwardRef`, which is how a
 * standalone component references itself without hitting the class's temporal dead zone).
 *
 * Values flow up, never sideways: a nested control emits its own new value, and the composite branch
 * that owns it merges that into its object/array and re-emits. Nothing mutates a parent's state
 * directly, so the whole tree stays a plain immutable value the form can submit as-is.
 *
 * Accessibility (spec 086): every control is named by a real `<label for>` (or, for the widgets that
 * have no single native control, a labelled group), a field error is a stable-id element that the
 * rendered control references through `aria-describedby`, and composites expose their own error and
 * row identities. Wrapper elements carry `data-forge-invalid` so the form can focus the first one.
 */
@Component({
  selector: 'forge-field-control',
  standalone: true,
  imports: [
    VoltInput,
    VoltTextarea,
    VoltSwitch,
    VoltButton,
    ForgeRelationPickerComponent,
    ForgeUploadPickerComponent,
    ForgeRichTextEditorComponent,
    ForgeControlA11yDirective,
    forwardRef(() => ForgeFieldControlComponent)
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let f = field();

    @switch (f.kind) {
      @case ('group') {
        <fieldset
          class="space-y-3 rounded-md border border-border p-3"
          [id]="path()"
          [attr.data-forge-path]="path()"
          [attr.data-forge-invalid]="error() ? '' : null"
          [attr.aria-describedby]="error() ? errorId() : null"
        >
          <legend class="px-1 text-sm font-medium">
            {{ f.label }}
            @if (f.required) {
              <span class="text-destructive" aria-hidden="true">&nbsp;*</span>
              <span class="sr-only">(required)</span>
            }
          </legend>
          @for (child of f.fields ?? []; track child.name) {
            <forge-field-control
              [field]="child"
              [value]="objectValue()[child.name]"
              [errors]="errors()"
              [path]="childPath(child.name)"
              [locales]="locales()"
              [activeLocale]="effectiveLocale()"
              (valueChange)="setInObject(child.name, $event)"
            />
          }
          @if (error(); as message) {
            <p [id]="errorId()" class="text-sm font-medium text-error">{{ message }}</p>
          }
        </fieldset>
      }

      @case ('array') {
        <fieldset
          class="space-y-3 rounded-md border border-border p-3"
          [id]="path()"
          [attr.data-forge-path]="path()"
          [attr.data-forge-invalid]="error() ? '' : null"
          [attr.aria-describedby]="error() ? errorId() : null"
        >
          <legend class="px-1 text-sm font-medium">
            {{ f.label }}
            @if (f.required) {
              <span class="text-destructive" aria-hidden="true">&nbsp;*</span>
              <span class="sr-only">(required)</span>
            }
          </legend>

          @for (row of rowValues(); track $index; let rowIndex = $index) {
            <div
              #rowEl
              role="group"
              class="space-y-3 rounded-md border border-border/60 p-3"
              [attr.aria-label]="rowLabel($index)"
            >
              <div class="flex items-center justify-between" data-forge-row-action>
                <span class="text-xs text-muted-foreground" aria-hidden="true"
                  >#{{ $index + 1 }}</span
                >
                <volt-button
                  type="button"
                  variant="outline"
                  size="sm"
                  [disabled]="!canRemoveRow()"
                  (click)="removeRow($index)"
                >
                  Remove<span class="sr-only"> {{ rowLabel($index) }}</span>
                </volt-button>
              </div>
              @for (child of f.fields ?? []; track child.name) {
                <forge-field-control
                  [field]="child"
                  [value]="row[child.name]"
                  [errors]="errors()"
                  [path]="rowPath(rowIndex, child.name)"
                  [locales]="locales()"
                  [activeLocale]="effectiveLocale()"
                  (valueChange)="setInRow(rowIndex, child.name, $event)"
                />
              }
            </div>
          } @empty {
            <p class="text-sm text-muted-foreground">No rows yet.</p>
          }

          @if (limitHint(); as hint) {
            <p class="text-xs text-muted-foreground">{{ hint }}</p>
          }
          <volt-button
            #addButton
            type="button"
            variant="outline"
            size="sm"
            [disabled]="!canAddRow()"
            (click)="addRow()"
          >
            Add row<span class="sr-only"> to {{ f.label }}</span>
          </volt-button>

          @if (error(); as message) {
            <p [id]="errorId()" class="text-sm font-medium text-error">{{ message }}</p>
          }
        </fieldset>
      }

      @case ('blocks') {
        <fieldset
          class="space-y-3 rounded-md border border-border p-3"
          [id]="path()"
          [attr.data-forge-path]="path()"
          [attr.data-forge-invalid]="error() ? '' : null"
          [attr.aria-describedby]="error() ? errorId() : null"
        >
          <legend class="px-1 text-sm font-medium">
            {{ f.label }}
            @if (f.required) {
              <span class="text-destructive" aria-hidden="true">&nbsp;*</span>
              <span class="sr-only">(required)</span>
            }
          </legend>

          @for (row of rowValues(); track $index; let rowIndex = $index) {
            <div
              #rowEl
              role="group"
              class="space-y-3 rounded-md border border-border/60 p-3"
              [attr.aria-label]="rowLabel($index, row)"
            >
              <div class="flex items-center justify-between" data-forge-row-action>
                <span class="text-xs font-medium">{{ blockLabel(row) }}</span>
                <volt-button
                  type="button"
                  variant="outline"
                  size="sm"
                  [disabled]="!canRemoveRow()"
                  (click)="removeRow($index)"
                >
                  Remove<span class="sr-only"> {{ rowLabel($index, row) }}</span>
                </volt-button>
              </div>
              @if (blockFor(row) === undefined) {
                <p class="text-xs text-destructive">
                  Unknown block type “{{ row['blockType'] }}”. It is not part of this collection's
                  schema, so it can't be edited here — its stored content is kept as it is unless
                  you remove it.
                </p>
              }
              @for (child of blockFields(row); track child.name) {
                <forge-field-control
                  [field]="child"
                  [value]="row[child.name]"
                  [errors]="errors()"
                  [path]="rowPath(rowIndex, child.name)"
                  [locales]="locales()"
                  [activeLocale]="effectiveLocale()"
                  (valueChange)="setInRow(rowIndex, child.name, $event)"
                />
              }
            </div>
          } @empty {
            <p class="text-sm text-muted-foreground">No blocks yet.</p>
          }

          @if (limitHint(); as hint) {
            <p class="text-xs text-muted-foreground">{{ hint }}</p>
          }
          <div class="flex items-center gap-2">
            <select
              #blockPicker
              class="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              [attr.aria-label]="'Block type to add to ' + f.label"
              [disabled]="!canAddRow()"
            >
              @for (block of f.blocks ?? []; track block.slug) {
                <option [value]="block.slug">{{ block.label }}</option>
              }
            </select>
            <volt-button
              #addButton
              type="button"
              variant="outline"
              size="sm"
              [disabled]="!canAddRow()"
              (click)="addBlock(blockPicker.value)"
            >
              Add block<span class="sr-only"> to {{ f.label }}</span>
            </volt-button>
          </div>

          @if (error(); as message) {
            <p [id]="errorId()" class="text-sm font-medium text-error">{{ message }}</p>
          }
        </fieldset>
      }

      @default {
        <div
          class="space-y-1.5"
          [forgeControlA11y]="path()"
          [forgeControlInvalid]="!!error()"
          [forgeControlErrorId]="errorId()"
          [attr.data-forge-path]="path()"
          [attr.data-forge-invalid]="error() ? '' : null"
          [attr.role]="isWidget() ? 'group' : null"
          [attr.aria-labelledby]="isWidget() ? labelId() : null"
          [attr.aria-describedby]="groupDescribesError() ? errorId() : null"
        >
          <!-- A native <label>: Volt's label only sets \`for\` inside an ngpFormField, which Forge does not use. -->
          <label
            class="text-sm font-medium leading-none text-foreground"
            [class.text-error]="!!error()"
            [attr.id]="labelId()"
            [attr.for]="isWidget() && f.kind !== 'relation' && f.kind !== 'upload' ? null : path()"
          >
            {{ f.label }}
            @if (f.required) {
              <span class="text-destructive" aria-hidden="true">&nbsp;*</span>
              @if (!hasNativeRequired()) {
                <span class="sr-only">(required)</span>
              }
            }
          </label>

          @if (isLocalized()) {
            <div role="group" class="mb-1 flex gap-1" [attr.aria-label]="f.label + ' language'">
              @for (loc of locales(); track loc) {
                <button
                  type="button"
                  class="rounded border px-2 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  [class]="
                    loc === effectiveLocale()
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-transparent text-muted-foreground hover:bg-muted'
                  "
                  [attr.aria-pressed]="loc === effectiveLocale() ? 'true' : 'false'"
                  (click)="setLocale(loc)"
                >
                  {{ loc }}
                </button>
              }
            </div>
          }

          @switch (f.kind) {
            @case ('textarea') {
              <volt-textarea
                [id]="path()"
                [required]="f.required"
                [value]="stringValue()"
                (valueChange)="commit($event)"
              />
            }
            @case ('richtext') {
              <forge-richtext-editor
                [value]="current()"
                [label]="f.label"
                [idPrefix]="path()"
                (valueChange)="commit($event)"
              />
            }
            @case ('json') {
              <volt-textarea
                [id]="path()"
                [required]="f.required"
                [value]="jsonValue()"
                (valueChange)="emitJson($event)"
              />
            }
            @case ('boolean') {
              <!-- Named explicitly: the label's htmlFor does not reach Volt's inner switch button. -->
              <volt-switch
                [id]="path()"
                [ariaLabel]="f.label"
                [checked]="Boolean(current())"
                (checkedChange)="commit($event)"
              />
            }
            @case ('select') {
              <select
                [id]="path()"
                class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                [required]="f.required"
                [value]="stringValue()"
                (change)="onSelectChange($event)"
              >
                <option value="">Select…</option>
                @for (opt of f.options ?? []; track opt) {
                  <option [value]="opt">{{ opt }}</option>
                }
              </select>
            }
            @case ('relation') {
              @if (f.relation; as relation) {
                <forge-relation-picker
                  [inputId]="path()"
                  [collection]="relation.collection"
                  [many]="relation.many"
                  [label]="f.label"
                  [value]="current()"
                  (valueChange)="commit($event)"
                />
              }
            }
            @case ('upload') {
              @if (f.relation; as relation) {
                <forge-upload-picker
                  [inputId]="path()"
                  [collection]="relation.collection"
                  [label]="f.label"
                  [value]="current()"
                  (valueChange)="commit($event)"
                />
              }
            }
            @case ('number') {
              <volt-input
                [id]="path()"
                type="number"
                [required]="f.required"
                [value]="stringValue()"
                (valueChange)="emitNumber($event)"
              />
            }
            @case ('date') {
              @if (f.withTime) {
                <volt-input
                  [id]="path()"
                  type="datetime-local"
                  [required]="f.required"
                  [value]="dateTimeValue()"
                  (valueChange)="commit(fromDateTimeLocalValue($event))"
                />
              } @else {
                <volt-input
                  [id]="path()"
                  type="date"
                  [required]="f.required"
                  [value]="dateValue()"
                  (valueChange)="commit(fromDateInputValue($event))"
                />
              }
            }
            @case ('email') {
              <volt-input
                [id]="path()"
                type="email"
                [required]="f.required"
                [value]="stringValue()"
                (valueChange)="commit($event)"
              />
            }
            @default {
              <volt-input
                [id]="path()"
                type="text"
                [required]="f.required"
                [value]="stringValue()"
                (valueChange)="commit($event)"
              />
            }
          }

          @if (error(); as message) {
            <p [id]="errorId()" class="text-sm font-medium text-error">{{ message }}</p>
          }
        </div>
      }
    }
  `
})
export class ForgeFieldControlComponent {
  field = input.required<FieldMeta>();
  value = input<unknown>();
  /** Validation errors keyed by the server's dotted field path (`seo.metaTitle`, `steps.0.label`). */
  errors = input<Record<string, string>>({});
  /** This control's own dotted path, used for error lookup and as the input id. */
  path = input<string>('');
  /** Locales available on the parent collection, when it has any. */
  locales = input<string[]>([]);
  /** The locale a parent control has already committed to (nested localized fields inherit it). */
  activeLocale = input<string>('');

  valueChange = output<unknown>();

  private readonly injector = inject(Injector);
  private readonly rowEls = viewChildren<ElementRef<HTMLElement>>('rowEl');
  private readonly addButton = viewChild<unknown, ElementRef<HTMLElement>>('addButton', {
    read: ElementRef
  });

  protected readonly Boolean = Boolean;
  protected readonly fromDateInputValue = fromDateInputValue;
  protected readonly fromDateTimeLocalValue = fromDateTimeLocalValue;

  /** Locale this control itself picked via its own tabs, overriding `activeLocale`. */
  protected readonly localLocale = signal<string>('');

  protected readonly effectiveLocale = computed(() => {
    return this.localLocale() || this.activeLocale() || this.locales()[0] || 'en';
  });

  /** A field is only edited per-locale when it opts in *and* the collection has locales to pick from. */
  protected readonly isLocalized = computed(
    () => this.field().localized === true && this.locales().length > 0
  );

  protected setLocale(locale: string): void {
    this.localLocale.set(locale);
  }

  protected readonly errorId = computed(() => `${this.path()}-error`);
  protected readonly labelId = computed(() => `${this.path()}-label`);
  protected readonly error = computed(() => this.errors()[this.path()]);

  /** The widgets without a single native control are exposed as a group named by the label. */
  protected readonly isWidget = computed(() =>
    ['relation', 'upload', 'richtext'].includes(this.field().kind)
  );
  /** The group itself carries the error when no native control inside does (richtext; a chosen single relation). */
  protected readonly groupDescribesError = computed(() => {
    if (this.error() === undefined) return false;
    const field = this.field();
    if (field.kind === 'richtext') return true;
    if (field.kind !== 'relation' || field.relation?.many === true) return false;
    const value = this.current();
    return value !== undefined && value !== null && value !== '';
  });
  protected readonly hasNativeRequired = computed(() =>
    NATIVE_REQUIRED_KINDS.has(this.field().kind)
  );

  /** The stored value for a localized field is `{ en: ..., es: ... }` — this reads the active slice. */
  protected readonly localeValue = computed(() => {
    const value = this.value();
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    return (value as Record<string, unknown>)[this.effectiveLocale()];
  });

  /** What the control shows: the active locale's slice for a localized field, else the value. */
  protected readonly current = computed(() =>
    this.isLocalized() ? this.localeValue() : this.value()
  );

  /** Emits a new value, merged into the active locale (others untouched) for a localized field. */
  protected commit(newValue: unknown): void {
    if (!this.isLocalized()) {
      this.valueChange.emit(newValue);
      return;
    }
    const current = this.value();
    const perLocale =
      typeof current === 'object' && current !== null && !Array.isArray(current)
        ? { ...(current as Record<string, unknown>) }
        : {};
    perLocale[this.effectiveLocale()] = newValue;
    this.valueChange.emit(perLocale);
  }

  protected readonly stringValue = computed(() => {
    const value = this.current();
    return value === undefined || value === null ? '' : String(value);
  });

  protected readonly dateValue = computed(() => toDateInputValue(this.current()));
  protected readonly dateTimeValue = computed(() => toDateTimeLocalValue(this.current()));

  protected readonly jsonValue = computed(() => {
    const value = this.current();
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  });

  protected readonly objectValue = computed<Record<string, unknown>>(() => {
    const value = this.value();
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  });

  protected readonly rowValues = computed<Record<string, unknown>[]>(() => {
    const value = this.value();
    if (!Array.isArray(value)) return [];
    return value.filter(
      (row): row is Record<string, unknown> =>
        typeof row === 'object' && row !== null && !Array.isArray(row)
    );
  });

  protected readonly canAddRow = computed(() => {
    const max = this.field().maxRows;
    return max === undefined || this.rowValues().length < max;
  });

  /** `minRows` is part of the schema: at the minimum another row must not look removable. */
  protected readonly canRemoveRow = computed(() => {
    const min = this.field().minRows;
    return min === undefined || this.rowValues().length > min;
  });

  /** Says why Add or Remove is unavailable, so a disabled control is never unexplained. */
  protected readonly limitHint = computed<string | null>(() => {
    const { minRows, maxRows } = this.field();
    const count = this.rowValues().length;
    const noun = this.field().kind === 'blocks' ? 'block' : 'row';
    const plural = (n: number) => (n === 1 ? noun : `${noun}s`);
    if (maxRows !== undefined && count >= maxRows) {
      return `Maximum of ${maxRows} ${plural(maxRows)} reached.`;
    }
    if (minRows !== undefined && minRows > 0 && count <= minRows) {
      return `At least ${minRows} ${plural(minRows)} required.`;
    }
    return null;
  });

  protected childPath(name: string): string {
    const prefix = this.path();
    return prefix ? `${prefix}.${name}` : name;
  }

  protected rowPath(index: number, name: string): string {
    return `${this.childPath(String(index))}.${name}`;
  }

  /** "Steps row 2 of 3" / "Hero block 1 of 2" — the identity of a repeated row or block. */
  protected rowLabel(index: number, row?: Record<string, unknown>): string {
    const total = this.rowValues().length;
    const kind = row === undefined ? `${this.field().label} row` : `${this.blockLabel(row)} block`;
    return `${kind} ${index + 1} of ${total}`;
  }

  protected blockFields(row: Record<string, unknown>): FieldMeta[] {
    return this.blockFor(row)?.fields ?? [];
  }

  protected blockLabel(row: Record<string, unknown>): string {
    return this.blockFor(row)?.label ?? String(row['blockType'] ?? 'Unknown block');
  }

  protected blockFor(row: Record<string, unknown>): BlockMeta | undefined {
    return this.field().blocks?.find((block) => block.slug === row['blockType']);
  }

  protected setInObject(name: string, value: unknown): void {
    this.valueChange.emit({ ...this.objectValue(), [name]: value });
  }

  protected setInRow(index: number, name: string, value: unknown): void {
    const rows = this.rowValues().map((row, i) => (i === index ? { ...row, [name]: value } : row));
    this.valueChange.emit(rows);
  }

  protected addRow(): void {
    if (!this.canAddRow()) return;
    this.valueChange.emit([...this.rowValues(), {}]);
    this.focusRow('last');
  }

  protected addBlock(blockType: string): void {
    if (!blockType || !this.canAddRow()) return;
    this.valueChange.emit([...this.rowValues(), { blockType }]);
    this.focusRow('last');
  }

  protected removeRow(index: number): void {
    if (!this.canRemoveRow()) return;
    this.valueChange.emit(this.rowValues().filter((_, i) => i !== index));
    this.focusRow(index);
  }

  /** After a structural change: the added row, the row that took the removed one's place, or "Add". */
  private focusRow(which: 'last' | number): void {
    afterNextRender(
      () => {
        const rows = this.rowEls();
        const row = which === 'last' ? rows.at(-1) : rows[Math.min(which, rows.length - 1)];
        // The row's own fields, not its Remove button (which sits in the header).
        const target =
          Array.from(row?.nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).find(
            (el) => el.closest('[data-forge-row-action]') === null
          ) ?? this.addButton()?.nativeElement.querySelector<HTMLElement>('button:not([disabled])');
        target?.focus();
      },
      { injector: this.injector }
    );
  }

  protected onSelectChange(event: Event): void {
    this.commit((event.target as HTMLSelectElement).value);
  }

  protected emitNumber(raw: string): void {
    // An empty input means "unset", not 0 — coercing it would silently write a value the user
    // never typed.
    this.commit(raw === '' ? undefined : Number(raw));
  }

  protected emitJson(raw: string): void {
    // Keep the raw string when it is not yet valid JSON: the user is mid-edit, and replacing their
    // text with a parse failure would make the field impossible to type into.
    try {
      this.commit(raw === '' ? undefined : JSON.parse(raw));
    } catch {
      this.commit(raw);
    }
  }
}
