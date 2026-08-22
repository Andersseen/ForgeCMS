import {
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  input,
  output,
  signal
} from '@angular/core';
import {
  VoltButton,
  VoltError,
  VoltInput,
  VoltLabel,
  VoltSwitch,
  VoltTextarea
} from '@voltui/components';
import type { BlockMeta, FieldMeta } from '@forge-cms/angular';
import { ForgeRelationPickerComponent } from './relation-picker.component.js';
import { ForgeUploadPickerComponent } from './upload-picker.component.js';
import { ForgeRichTextEditorComponent } from './richtext-editor.component.js';

/**
 * Renders a single field, recursing into itself for the composite kinds (`group`, `array`,
 * `blocks`) added in spec 022. Nesting is arbitrary — a group inside an array inside a group renders
 * correctly because this component is in its own `imports` (via `forwardRef`, which is how a
 * standalone component references itself without hitting the class's temporal dead zone).
 *
 * Values flow up, never sideways: a nested control emits its own new value, and the composite branch
 * that owns it merges that into its object/array and re-emits. Nothing mutates a parent's state
 * directly, so the whole tree stays a plain immutable value the form can submit as-is.
 */
@Component({
  selector: 'forge-field-control',
  standalone: true,
  imports: [
    VoltInput,
    VoltTextarea,
    VoltSwitch,
    VoltLabel,
    VoltError,
    VoltButton,
    ForgeRelationPickerComponent,
    ForgeUploadPickerComponent,
    ForgeRichTextEditorComponent,
    forwardRef(() => ForgeFieldControlComponent)
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let f = field();

    @switch (f.kind) {
      @case ('group') {
        <fieldset class="space-y-3 rounded-md border border-border p-3">
          <legend class="px-1 text-sm font-medium">{{ f.label }}</legend>
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
        </fieldset>
      }

      @case ('array') {
        <fieldset class="space-y-3 rounded-md border border-border p-3">
          <legend class="px-1 text-sm font-medium">{{ f.label }}</legend>

          @for (row of rowValues(); track $index) {
            <div class="space-y-3 rounded-md border border-border/60 p-3">
              <div class="flex items-center justify-between">
                <span class="text-xs text-muted-foreground">#{{ $index + 1 }}</span>
                <volt-button type="button" variant="outline" size="sm" (click)="removeRow($index)">
                  Remove
                </volt-button>
              </div>
              @for (child of f.fields ?? []; track child.name) {
                <forge-field-control
                  [field]="child"
                  [value]="row[child.name]"
                  [errors]="errors()"
                  [path]="rowPath($index, child.name)"
                  [locales]="locales()"
                  [activeLocale]="effectiveLocale()"
                  (valueChange)="setInRow($index, child.name, $event)"
                />
              }
            </div>
          } @empty {
            <p class="text-sm text-muted-foreground">No rows yet.</p>
          }

          @if (canAddRow()) {
            <volt-button type="button" variant="outline" size="sm" (click)="addRow()">
              Add row
            </volt-button>
          }
        </fieldset>
      }

      @case ('blocks') {
        <fieldset class="space-y-3 rounded-md border border-border p-3">
          <legend class="px-1 text-sm font-medium">{{ f.label }}</legend>

          @for (row of rowValues(); track $index) {
            <div class="space-y-3 rounded-md border border-border/60 p-3">
              <div class="flex items-center justify-between">
                <span class="text-xs font-medium">{{ blockLabel(row) }}</span>
                <volt-button type="button" variant="outline" size="sm" (click)="removeRow($index)">
                  Remove
                </volt-button>
              </div>
              @for (child of blockFields(row); track child.name) {
                <forge-field-control
                  [field]="child"
                  [value]="row[child.name]"
                  [errors]="errors()"
                  [path]="rowPath($index, child.name)"
                  [locales]="locales()"
                  [activeLocale]="effectiveLocale()"
                  (valueChange)="setInRow($index, child.name, $event)"
                />
              }
            </div>
          } @empty {
            <p class="text-sm text-muted-foreground">No blocks yet.</p>
          }

          @if (canAddRow()) {
            <div class="flex items-center gap-2">
              <select
                class="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                #blockPicker
              >
                @for (block of f.blocks ?? []; track block.slug) {
                  <option [value]="block.slug">{{ block.label }}</option>
                }
              </select>
              <volt-button
                type="button"
                variant="outline"
                size="sm"
                (click)="addBlock(blockPicker.value)"
              >
                Add block
              </volt-button>
            </div>
          }
        </fieldset>
      }

      @default {
        <div class="space-y-1.5">
          <volt-label [htmlFor]="path()" [error]="!!error()">
            {{ f.label }}
            @if (f.required) {
              <span class="text-destructive">&nbsp;*</span>
            }
          </volt-label>

          @if (isLocalized()) {
            <div class="flex gap-1 mb-1">
              @for (loc of locales(); track loc) {
                <button
                  type="button"
                  class="px-2 py-0.5 text-xs rounded border transition-colors"
                  [class]="loc === effectiveLocale()
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-transparent border-border text-muted-foreground hover:bg-muted'"
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
                [value]="isLocalized() ? localeStringValue() : stringValue()"
                (valueChange)="isLocalized() ? emitLocaleValue($event) : valueChange.emit($event)"
              />
            }
            @case ('richtext') {
              <forge-richtext-editor
                [value]="isLocalized() ? localeValue() : value()"
                (valueChange)="isLocalized() ? emitLocaleValue($event) : valueChange.emit($event)"
              />
            }
            @case ('json') {
              <volt-textarea
                [id]="path()"
                [value]="isLocalized() ? localeJsonValue() : jsonValue()"
                (valueChange)="isLocalized() ? emitLocaleJson($event) : emitJson($event)"
              />
            }
            @case ('boolean') {
              <volt-switch
                [id]="path()"
                [checked]="isLocalized() ? localeBooleanValue() : booleanValue()"
                (checkedChange)="isLocalized() ? emitLocaleValue($event) : valueChange.emit($event)"
              />
            }
            @case ('select') {
              <select
                [id]="path()"
                class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                [value]="isLocalized() ? localeStringValue() : stringValue()"
                (change)="isLocalized() ? onSelectChangeLocalized($event) : onSelectChange($event)"
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
                  [value]="isLocalized() ? localeValue() : value()"
                  (valueChange)="isLocalized() ? emitLocaleValue($event) : valueChange.emit($event)"
                />
              }
            }
            @case ('upload') {
              @if (f.relation; as relation) {
                <forge-upload-picker
                  [inputId]="path()"
                  [collection]="relation.collection"
                  [value]="isLocalized() ? localeValue() : value()"
                  (valueChange)="isLocalized() ? emitLocaleValue($event) : valueChange.emit($event)"
                />
              }
            }
            @case ('number') {
              <volt-input
                [id]="path()"
                type="number"
                [value]="isLocalized() ? localeStringValue() : stringValue()"
                (valueChange)="isLocalized() ? emitLocaleNumber($event) : emitNumber($event)"
              />
            }
            @case ('date') {
              <volt-input
                [id]="path()"
                type="date"
                [value]="isLocalized() ? localeStringValue() : stringValue()"
                (valueChange)="isLocalized() ? emitLocaleValue($event) : valueChange.emit($event)"
              />
            }
            @case ('email') {
              <volt-input
                [id]="path()"
                type="email"
                [value]="isLocalized() ? localeStringValue() : stringValue()"
                (valueChange)="isLocalized() ? emitLocaleValue($event) : valueChange.emit($event)"
              />
            }
            @default {
              <volt-input
                [id]="path()"
                type="text"
                [value]="isLocalized() ? localeStringValue() : stringValue()"
                (valueChange)="isLocalized() ? emitLocaleValue($event) : valueChange.emit($event)"
              />
            }
          }

          @if (error(); as message) {
            <volt-error>{{ message }}</volt-error>
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
  /** Available locales for localized fields. */
  locales = input<string[]>([]);
  /** Currently active locale for editing localized fields. */
  activeLocale = input<string>('');

  valueChange = output<unknown>();

  protected readonly localLocale = signal<string>('');

  protected readonly effectiveLocale = computed(() => {
    const local = this.localLocale();
    if (local) return local;
    const parent = this.activeLocale();
    if (parent) return parent;
    const available = this.locales();
    return available[0] ?? 'en';
  });

  protected readonly isLocalized = computed(() => {
    return this.field().localized === true && this.locales().length > 0;
  });

  protected readonly localeValue = computed(() => {
    if (!this.isLocalized()) return this.value();
    const val = this.value();
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      return (val as Record<string, unknown>)[this.effectiveLocale()];
    }
    return undefined;
  });

  protected setLocale(locale: string): void {
    this.localLocale.set(locale);
  }

  protected emitLocaleValue(newValue: unknown): void {
    const existing = this.value();
    const obj =
      typeof existing === 'object' && existing !== null && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    obj[this.effectiveLocale()] = newValue;
    this.valueChange.emit(obj);
  }

  protected readonly error = computed(() => this.errors()[this.path()]);

  protected readonly stringValue = computed(() => {
    const value = this.value();
    return value === undefined || value === null ? '' : String(value);
  });

  protected readonly localeStringValue = computed(() => {
    const value = this.localeValue();
    return value === undefined || value === null ? '' : String(value);
  });

  protected readonly booleanValue = computed(() => Boolean(this.value()));

  protected readonly localeBooleanValue = computed(() => Boolean(this.localeValue()));

  protected readonly jsonValue = computed(() => {
    const value = this.value();
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  });

  protected readonly localeJsonValue = computed(() => {
    const value = this.localeValue();
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  });

  protected readonly relationValue = computed(() => {
    const value = this.value();
    if (Array.isArray(value)) return value.join(', ');
    return value === undefined || value === null ? '' : String(value);
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

  protected childPath(name: string): string {
    const prefix = this.path();
    return prefix ? `${prefix}.${name}` : name;
  }

  protected rowPath(index: number, name: string): string {
    return `${this.childPath(String(index))}.${name}`;
  }

  protected blockFields(row: Record<string, unknown>): FieldMeta[] {
    return this.blockFor(row)?.fields ?? [];
  }

  protected blockLabel(row: Record<string, unknown>): string {
    return this.blockFor(row)?.label ?? String(row.blockType ?? 'Unknown block');
  }

  private blockFor(row: Record<string, unknown>): BlockMeta | undefined {
    return this.field().blocks?.find((block) => block.slug === row.blockType);
  }

  protected setInObject(name: string, value: unknown): void {
    this.valueChange.emit({ ...this.objectValue(), [name]: value });
  }

  protected setInRow(index: number, name: string, value: unknown): void {
    const rows = this.rowValues().map((row, i) => (i === index ? { ...row, [name]: value } : row));
    this.valueChange.emit(rows);
  }

  protected addRow(): void {
    this.valueChange.emit([...this.rowValues(), {}]);
  }

  protected addBlock(blockType: string): void {
    if (!blockType) return;
    this.valueChange.emit([...this.rowValues(), { blockType }]);
  }

  protected removeRow(index: number): void {
    this.valueChange.emit(this.rowValues().filter((_, i) => i !== index));
  }

  protected onSelectChange(event: Event): void {
    this.valueChange.emit((event.target as HTMLSelectElement).value);
  }

  protected onSelectChangeLocalized(event: Event): void {
    this.emitLocaleValue((event.target as HTMLSelectElement).value);
  }

  protected emitNumber(raw: string): void {
    this.valueChange.emit(raw === '' ? undefined : Number(raw));
  }

  protected emitLocaleNumber(raw: string): void {
    this.emitLocaleValue(raw === '' ? undefined : Number(raw));
  }

  protected emitRelation(raw: string): void {
    if (this.field().relation?.many !== true) {
      this.valueChange.emit(raw);
      return;
    }
    this.valueChange.emit(
      raw
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
    );
  }

  protected emitJson(raw: string): void {
    try {
      this.valueChange.emit(raw === '' ? undefined : JSON.parse(raw));
    } catch {
      this.valueChange.emit(raw);
    }
  }

  protected emitLocaleJson(raw: string): void {
    try {
      this.emitLocaleValue(raw === '' ? undefined : JSON.parse(raw));
    } catch {
      this.emitLocaleValue(raw);
    }
  }
}
