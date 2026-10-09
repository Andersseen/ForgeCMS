import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';
import { afterNextRenderIfAlive } from './after-render.js';
import type { OnInit, ElementRef } from '@angular/core';
import { CmsApiService } from '@forge-cms/angular';
import { VoltButton, buttonVariants } from '@voltui/components';
import { documentImageUrl, documentLabel } from './document-label.js';
import { describeAdminError } from './admin-error.js';

const LIBRARY_LIMIT = 24;

let nextPickerId = 0;

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
    <div #root class="space-y-3">
      @if (current(); as doc) {
        <div class="flex items-center gap-3 rounded-md border border-border p-2">
          @if (previewUrl(); as url) {
            <img
              [src]="url"
              [alt]="label() ? label() + ': ' + fileLabel() : fileLabel()"
              class="h-14 w-14 rounded object-cover"
            />
          } @else {
            <span
              class="flex h-14 w-14 items-center justify-center rounded bg-muted text-xs text-muted-foreground"
              aria-hidden="true"
            >
              file
            </span>
          }
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm">{{ fileLabel() }}</p>
            <p class="truncate font-mono text-xs text-muted-foreground">{{ doc }}</p>
          </div>
          <volt-button data-forge-remove type="button" variant="ghost" size="sm" (click)="clear()">
            Remove<span class="sr-only"> {{ fileLabel() }}</span>
          </volt-button>
        </div>
      }

      <div class="flex flex-wrap items-center gap-2">
        <input
          [id]="inputId()"
          type="file"
          class="rounded text-sm file:mr-2 file:rounded-md file:border file:border-border file:bg-muted file:px-2.5 file:py-1 file:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          [disabled]="uploading()"
          (change)="upload($event)"
        />
        <button
          data-forge-library-toggle
          type="button"
          [class]="toggleClass"
          [attr.aria-expanded]="showLibrary() ? 'true' : 'false'"
          [attr.aria-controls]="libraryId"
          (click)="toggleLibrary()"
        >
          {{ showLibrary() ? 'Hide library' : 'Choose existing' }}
        </button>
      </div>

      <!-- Neutral progress, announced politely; always present so the change is observed. -->
      <p class="text-xs text-muted-foreground" role="status">{{ status() }}</p>

      @if (error(); as message) {
        <p class="text-xs text-destructive" role="alert">{{ message }}</p>
      }

      @if (showLibrary()) {
        <div
          [id]="libraryId"
          role="group"
          aria-label="Media library"
          [attr.aria-busy]="libraryLoading() ? 'true' : null"
          class="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto rounded-md border border-border p-2"
        >
          @for (item of library(); track item.id) {
            <button
              type="button"
              class="group overflow-hidden rounded border border-transparent hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              (click)="select(item.id)"
              [title]="item.label"
              [attr.aria-label]="'Select ' + item.label"
            >
              @if (item.url) {
                <img [src]="item.url" alt="" class="aspect-square w-full object-cover" />
              } @else {
                <span class="flex aspect-square items-center justify-center bg-muted text-[10px]">
                  {{ item.label }}
                </span>
              }
            </button>
          } @empty {
            @if (!libraryLoading()) {
              <p class="col-span-4 p-2 text-xs text-muted-foreground">The library is empty.</p>
            }
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
  /** The owning field's label; names the preview and the remove action. */
  label = input('');

  valueChange = output<string>();

  protected readonly libraryId = `forge-upload-library-${nextPickerId++}`;
  /** Same look as Volt's outline/sm button, on a native element that can carry `aria-expanded`. */
  protected readonly toggleClass = buttonVariants({ variant: 'outline', size: 'sm' });
  protected readonly showLibrary = signal(false);
  protected readonly uploading = signal(false);
  protected readonly libraryLoading = signal(false);
  protected readonly status = computed(() => {
    if (this.uploading()) return 'Uploading…';
    if (this.libraryLoading()) return 'Loading library…';
    return '';
  });
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly root = viewChild<ElementRef<HTMLElement>>('root');
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
  protected readonly fileLabel = computed(() => documentLabel(this.document() ?? this.current()));

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
    if (!next || this.library().length > 0 || this.libraryLoading()) return;

    this.libraryLoading.set(true);
    this.error.set(null);
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
      this.error.set(describeAdminError(err));
    } finally {
      this.libraryLoading.set(false);
    }
  }

  protected async upload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    // One upload at a time through this control, however the second one was started.
    if (this.uploading()) {
      input.value = '';
      return;
    }

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
      this.error.set(describeAdminError(err));
    } finally {
      this.uploading.set(false);
      // The input is disabled while uploading, which drops focus: hand it back.
      this.focusAfterRender('input[type="file"]', true);
    }
  }

  protected select(id: string): void {
    const item = this.library().find((entry) => entry.id === id);
    this.fetched.set(item ? { id: item.id, filename: item.label, url: item.url } : null);
    this.showLibrary.set(false);
    this.valueChange.emit(id);
    this.focusAfterRender('[data-forge-library-toggle]');
  }

  protected clear(): void {
    this.fetched.set(null);
    this.valueChange.emit('');
    this.focusAfterRender('input[type="file"]');
  }

  private focusAfterRender(selector: string, onlyIfLost = false): void {
    afterNextRenderIfAlive(this.injector, this.destroyRef, () => {
      const root = this.root()?.nativeElement;
      const active = root?.ownerDocument.activeElement;
      if (onlyIfLost && active !== null && active !== root?.ownerDocument.body) return;
      root?.querySelector<HTMLElement>(selector)?.focus();
    });
  }
}
