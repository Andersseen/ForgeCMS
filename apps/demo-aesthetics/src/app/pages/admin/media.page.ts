import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { EmptyStateComponent, PageHeaderComponent } from '@forge-cms/admin';
import { AdminApiService } from '../../services/admin-api.service';

interface MediaDoc extends Record<string, unknown> {
  id: string;
  filename: string;
  alt: string;
  url: string;
  contentType: string;
  filesize: number;
}

/**
 * The media library — and the only place in the demo that exercises spec 016's multipart upload
 * path for real (`POST /api/v1/media` with `multipart/form-data`).
 */
@Component({
  selector: 'lumea-admin-media',
  standalone: true,
  imports: [PageHeaderComponent, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <forge-page-header
        title="Media"
        subtitle="Images used by treatments, the team and the journal."
      />

      <div class="rounded-xl border border-dashed border-border bg-card p-5">
        <label class="block text-sm font-medium">Upload an image</label>
        <p class="mt-1 text-xs text-muted-foreground">
          Goes through the storage adapter (in-memory locally, R2 when the binding exists). Uploaded
          files are served from memory, so they disappear on reload — seeded images live in
          <code>public/images</code>.
        </p>
        <div class="mt-3 flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept="image/*"
            (change)="pick($event)"
            class="text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-sm"
          />
          <input
            placeholder="Alt text"
            [value]="alt()"
            (input)="alt.set(value($event))"
            class="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            type="button"
            (click)="upload()"
            [disabled]="!file() || uploading()"
            class="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {{ uploading() ? 'Uploading…' : 'Upload' }}
          </button>
        </div>
        @if (uploadError(); as message) {
          <p class="mt-3 text-sm text-destructive">{{ message }}</p>
        }
      </div>

      @if (loading()) {
        <p class="text-sm text-muted-foreground">Loading…</p>
      } @else if (documents().length === 0) {
        <forge-empty-state title="No media yet" message="Upload an image to get started." />
      } @else {
        <div class="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
          @for (item of documents(); track item.id) {
            <figure class="overflow-hidden rounded-xl border border-border bg-card">
              <div class="aspect-square bg-muted">
                @if (item.url) {
                  <img [src]="item.url" [alt]="item.alt" class="h-full w-full object-cover" />
                }
              </div>
              <figcaption class="space-y-1 p-3">
                <p class="truncate text-xs font-medium">{{ item.filename }}</p>
                <p class="truncate text-xs text-muted-foreground">
                  {{ item.alt || 'No alt text' }}
                </p>
              </figcaption>
            </figure>
          }
        </div>
      }
    </div>
  `
})
export class AdminMediaPage implements OnInit {
  private readonly api = inject(AdminApiService);

  protected readonly documents = signal<MediaDoc[]>([]);
  protected readonly loading = signal(true);
  protected readonly file = signal<File | null>(null);
  protected readonly alt = signal('');
  protected readonly uploading = signal(false);
  protected readonly uploadError = signal<string | null>(null);

  ngOnInit(): void {
    void this.load();
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected pick(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.file.set(input.files?.[0] ?? null);
  }

  protected async upload(): Promise<void> {
    const file = this.file();
    if (!file) return;

    this.uploading.set(true);
    this.uploadError.set(null);
    try {
      await this.api.uploadMedia(file, this.alt());
      this.file.set(null);
      this.alt.set('');
      await this.load();
    } catch (err) {
      this.uploadError.set(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      this.uploading.set(false);
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.documents.set(await this.api.listDocuments<MediaDoc>('media', { limit: 100 }));
    } finally {
      this.loading.set(false);
    }
  }
}
