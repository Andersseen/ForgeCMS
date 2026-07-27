import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import type { OnInit } from '@angular/core';
import { CmsApiService } from '@forge-cms/angular';
import type { CollectionMeta } from '@forge-cms/angular';
import { VoltButton, VoltInput } from '@voltui/components';
import { documentLabel, shortId } from './document-label.js';

const SEARCHABLE_KINDS = new Set(['text', 'slug', 'email']);
const RESULT_LIMIT = 12;

interface Option {
  id: string;
  label: string;
}

function isEmptySelection(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/**
 * Picks one or more related documents by searching them, instead of pasting a UUID into a text
 * input — which is what the relation field was until spec 042.
 *
 * Search is server-side: the picker reads the target collection's schema, finds its first text-ish
 * field, and queries `?<field>[contains]=<term>`. When the target has no such field it falls back to
 * listing the first page, which is the honest behaviour for a collection with nothing to search on.
 */
@Component({
  selector: 'forge-relation-picker',
  standalone: true,
  imports: [VoltInput, VoltButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-2">
      @if (selected().length > 0) {
        <div class="flex flex-wrap gap-1.5">
          @for (option of selected(); track option.id) {
            <span
              class="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs"
              [title]="option.id"
            >
              {{ option.label }}
              <button
                type="button"
                class="text-muted-foreground hover:text-destructive"
                (click)="remove(option.id)"
                aria-label="Remove"
              >
                ×
              </button>
            </span>
          }
        </div>
      }

      @if (many() || selected().length === 0) {
        <volt-input
          [id]="inputId()"
          type="text"
          [value]="term()"
          (valueChange)="search($event)"
          [placeholder]="'Search ' + collection() + '…'"
        />

        @if (loading()) {
          <p class="text-xs text-muted-foreground">Searching…</p>
        } @else if (error()) {
          <p class="text-xs text-destructive">{{ error() }}</p>
        } @else if (results().length > 0) {
          <ul
            class="max-h-48 divide-y divide-border overflow-y-auto rounded-md border border-border"
          >
            @for (option of results(); track option.id) {
              <li>
                <button
                  type="button"
                  class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                  (click)="choose(option)"
                >
                  <span class="truncate">{{ option.label }}</span>
                  <span class="font-mono text-xs text-muted-foreground">{{
                    shortId(option.id)
                  }}</span>
                </button>
              </li>
            }
          </ul>
        } @else if (term() !== '') {
          <p class="text-xs text-muted-foreground">No matches.</p>
        }
      } @else {
        <volt-button type="button" variant="outline" size="sm" (click)="clear()">
          Choose another
        </volt-button>
      }
    </div>
  `
})
export class ForgeRelationPickerComponent implements OnInit {
  private readonly api = inject(CmsApiService);

  collection = input.required<string>();
  many = input(false);
  /** An id, a list of ids, or the populated document(s) when the caller fetched with `depth: 1`. */
  value = input<unknown>();
  inputId = input('');

  valueChange = output<string | string[]>();

  protected readonly shortId = shortId;
  protected readonly term = signal('');
  protected readonly results = signal<Option[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Labels resolved for ids we only know as strings, so a chip is never a bare UUID. */
  private readonly resolved = signal<Record<string, string>>({});
  private searchField: string | null = null;
  private searchToken = 0;

  protected readonly selected = computed<Option[]>(() => {
    const value = this.value();
    const entries = Array.isArray(value) ? value : isEmptySelection(value) ? [] : [value];
    const labels = this.resolved();

    return (
      entries
        .map((entry) => {
          if (typeof entry === 'string')
            return { id: entry, label: labels[entry] ?? shortId(entry) };
          const record = entry as Record<string, unknown>;
          return { id: String(record.id ?? ''), label: documentLabel(record) };
        })
        // An empty id is "nothing selected" — clearing a single relation emits `''`, and counting
        // that as a selection left the picker with no way back to the search box.
        .filter((option) => option.id !== '')
    );
  });

  ngOnInit(): void {
    void this.prepare();
  }

  /** Finds a searchable field on the target collection and labels whatever ids we already hold. */
  private async prepare(): Promise<void> {
    try {
      const collections = await this.api.getCollections();
      const target: CollectionMeta | undefined = collections.find(
        (entry) => entry.slug === this.collection()
      );
      this.searchField =
        target?.fieldDefinitions.find((field) => SEARCHABLE_KINDS.has(field.kind))?.name ?? null;

      const unlabelled = this.selected()
        .filter((option) => option.label === shortId(option.id) && option.id !== '')
        .map((option) => option.id);
      if (unlabelled.length === 0) return;

      const docs = await this.api.getDocuments(this.collection(), {
        where: { id: { in: unlabelled } },
        limit: unlabelled.length
      });
      const labels: Record<string, string> = {};
      for (const doc of docs)
        labels[String((doc as Record<string, unknown>).id)] = documentLabel(doc);
      this.resolved.set(labels);
    } catch {
      // A failed lookup only costs nicer labels; the picker still works with ids.
    }
  }

  protected async search(term: string): Promise<void> {
    this.term.set(term);
    if (term.trim() === '') {
      this.results.set([]);
      return;
    }

    const token = ++this.searchToken;
    this.loading.set(true);
    this.error.set(null);

    try {
      const docs = await this.api.getDocuments(this.collection(), {
        limit: RESULT_LIMIT,
        ...(this.searchField ? { where: { [this.searchField]: { contains: term } } } : {})
      });
      if (token !== this.searchToken) return;

      const options = docs.map((doc) => ({
        id: String((doc as Record<string, unknown>).id),
        label: documentLabel(doc)
      }));
      // Without a searchable field the server cannot filter, so narrow the page client-side.
      const filtered = this.searchField
        ? options
        : options.filter((option) => option.label.toLowerCase().includes(term.toLowerCase()));

      this.results.set(filtered.filter((option) => !this.isSelected(option.id)));
    } catch (err) {
      if (token !== this.searchToken) return;
      this.error.set(err instanceof Error ? err.message : 'Search failed');
    } finally {
      if (token === this.searchToken) this.loading.set(false);
    }
  }

  protected choose(option: Option): void {
    this.resolved.update((labels) => ({ ...labels, [option.id]: option.label }));
    this.term.set('');
    this.results.set([]);

    if (!this.many()) {
      this.valueChange.emit(option.id);
      return;
    }
    this.valueChange.emit([...this.selected().map((entry) => entry.id), option.id]);
  }

  protected remove(id: string): void {
    if (!this.many()) {
      this.valueChange.emit('');
      return;
    }
    this.valueChange.emit(
      this.selected()
        .map((entry) => entry.id)
        .filter((entry) => entry !== id)
    );
  }

  protected clear(): void {
    this.valueChange.emit(this.many() ? [] : '');
  }

  private isSelected(id: string): boolean {
    return this.selected().some((option) => option.id === id);
  }
}
