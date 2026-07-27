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
import { VoltButton } from '@voltui/components';
import { documentImageUrl, documentLabel } from './document-label.js';

const LIBRARY_LIMIT = 24;

/**
 * Picks a file: preview what is selected, upload a new one, or choose from the library.
 *
 * Until spec 042 an `upload` field was a text input for a UUID, and `CmsApiService` had no upload
 * method at all — so a media library could not be built out of the package.
 */
@Component({
  selector: 'forge-upload-picker',
  standalone: true,
  imports: [VoltButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-3">
      @if (current(); as doc) {
        <div class="flex items-center gap-3 rounded-md border border-border p-2">
          @if (previewUrl(); as url) {
            <img [src]="url" [alt]="label()" class="h-14 w-14 rounded object-cover" />
          } @else {
            <span
              class="flex h-14 w-14 items-center justify-center rounded bg-muted text-xs text-muted-foreground"
            >
              file
            </span>
          }
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm">{{ label() }}</p>
            <p class="truncate font-mono text-xs text-muted-foreground">{{ doc }}</p>
          </div>
          <volt-button type="button" variant="ghost" size="sm" (click)="clear()"
            >Remove</volt-button
          >
        </div>
      }

      <div class="flex flex-wrap items-center gap-2">
        <input
          [id]="inputId()"
          type="file"
          class="text-sm file:mr-2 file:rounded-md file:border file:border-border file:bg-muted file:px-2.5 file:py-1 file:text-sm"
          (change)="upload($event)"
        />
        <volt-button type="button" variant="outline" size="sm" (click)="toggleLibrary()">
          {{ showLibrary() ? 'Hide library' : 'Choose existing' }}
        </volt-button>
        @if (uploading()) {
          <span class="text-xs text-muted-foreground">Uploading…</span>
        }
      </div>

      @if (error(); as message) {
        <p class="text-xs text-destructive">{{ message }}</p>
      }

      @if (showLibrary()) {
        <div
          class="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto rounded-md border border-border p-2"
        >
          @for (item of library(); track item.id) {
            <button
              type="button"
              class="group overflow-hidden rounded border border-transparent hover:border-primary"
              (click)="select(item.id)"
              [title]="item.label"
            >
              @if (item.url) {
                <img
                  [src]="item.url"
                  [alt]="item.label"
                  class="aspect-square w-full object-cover"
                />
              } @else {
                <span class="flex aspect-square items-center justify-center bg-muted text-[10px]">
                  {{ item.label }}
                </span>
              }
            </button>
          } @empty {
            <p class="col-span-4 p-2 text-xs text-muted-foreground">The library is empty.</p>
          }
        </div>
      }
    </div>
  `
})
export class ForgeUploadPickerComponent implements OnInit {
  private readonly api = inject(CmsApiService);

  /** The upload-enabled collection this field points at (`media`, usually). */
  collection = input.required<string>();
  /** An id, or the populated document when the caller fetched with `depth: 1`. */
  value = input<unknown>();
  inputId = input('');

  valueChange = output<string>();

  protected readonly showLibrary = signal(false);
  protected readonly uploading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly library = signal<{ id: string; label: string; url: string | null }[]>([]);
  /** The selected document, fetched when we only have its id. */
  private readonly fetched = signal<Record<string, unknown> | null>(null);

  protected readonly current = computed<string | null>(() => {
    const value = this.value();
    if (typeof value === 'string' && value !== '') return value;
    if (typeof value === 'object' && value !== null)
      return String((value as Record<string, unknown>).id);
    return null;
  });

  private readonly document = computed<Record<string, unknown> | null>(() => {
    const value = this.value();
    if (typeof value === 'object' && value !== null) return value as Record<string, unknown>;
    return this.fetched();
  });

  protected readonly previewUrl = computed(() => documentImageUrl(this.document()));
  protected readonly label = computed(() => documentLabel(this.document() ?? this.current()));

  ngOnInit(): void {
    void this.resolveCurrent();
  }

  private async resolveCurrent(): Promise<void> {
    const value = this.value();
    if (typeof value !== 'string' || value === '') return;
    try {
      this.fetched.set(await this.api.getDocument(this.collection(), value));
    } catch {
      // A missing media document just means no preview; the id is still shown.
    }
  }

  protected async toggleLibrary(): Promise<void> {
    const next = !this.showLibrary();
    this.showLibrary.set(next);
    if (!next || this.library().length > 0) return;

    try {
      const docs = await this.api.getDocuments(this.collection(), { limit: LIBRARY_LIMIT });
      this.library.set(
        docs.map((doc) => ({
          id: String((doc as Record<string, unknown>).id),
          label: documentLabel(doc),
          url: documentImageUrl(doc)
        }))
      );
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not load the library');
    }
  }

  protected async upload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.uploading.set(true);
    this.error.set(null);
    try {
      const doc = await this.api.uploadFile(this.collection(), file, { alt: file.name });
      const record = doc as Record<string, unknown>;
      this.fetched.set(record);
      this.library.update((items) => [
        { id: String(record.id), label: documentLabel(record), url: documentImageUrl(record) },
        ...items
      ]);
      this.valueChange.emit(String(record.id));
      input.value = '';
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      this.uploading.set(false);
    }
  }

  protected select(id: string): void {
    const item = this.library().find((entry) => entry.id === id);
    this.fetched.set(item ? { id: item.id, filename: item.label, url: item.url } : null);
    this.showLibrary.set(false);
    this.valueChange.emit(id);
  }

  protected clear(): void {
    this.fetched.set(null);
    this.valueChange.emit('');
  }
}
