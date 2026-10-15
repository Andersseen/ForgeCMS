import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { EmptyStateComponent, PageHeaderComponent, describeAdminError } from '@forge-cms/admin';
import { injectForgeClient } from '@forge-cms/angular';
import { VoltButton, VoltError, VoltInput } from '@voltui/components';
import type { DemoDocument, DemoSchema } from '../../forge-schema';
import { DemoNoticeComponent } from '../../components/demo-notice.component';
import { DemoPolicyService } from '../../services/demo-policy.service';

/**
 * The media library — and the only place in the demo that exercises spec 016's multipart upload
 * path for real (`POST /api/v1/media` with `multipart/form-data`).
 */
@Component({
  selector: 'lumea-admin-media',
  standalone: true,
  imports: [
    PageHeaderComponent,
    EmptyStateComponent,
    DemoNoticeComponent,
    VoltButton,
    VoltError,
    VoltInput
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <forge-page-header
        title="Media"
        subtitle="Images used by treatments, the team and the journal."
      />

      <lumea-demo-notice />

      @if (demo.isPublic()) {
        <div class="rounded-xl border border-border bg-card p-5" data-uploads-disabled>
          <p class="text-sm font-medium">Uploads are disabled in the shared public demo</p>
          <p class="mt-1 text-xs text-muted-foreground">
            This keeps the hosted example inexpensive. Clone the demo, or use ForgeCMS in your own
            project, to exercise uploads to object storage. The images below are the seeded ones.
          </p>
        </div>
      } @else {
        <div class="rounded-xl border border-dashed border-border bg-card p-5">
          <label class="block text-sm font-medium" for="media-file">Upload an image</label>
          <p class="mt-1 text-xs text-muted-foreground">
            Goes through the storage adapter (in-memory locally, R2 when the binding exists) and is
            served back by <code>handleFile</code>. Local uploads live in memory, so they disappear
            on reload &mdash; seeded images live in <code>public/images</code>.
          </p>
          <div class="mt-3 flex flex-wrap items-center gap-3">
            <!-- Native on purpose: a single image picker. Volt's file-upload primitive is a
                 dropzone that creates its input on demand, which buys nothing here. -->
            <input
              id="media-file"
              type="file"
              accept="image/*"
              (change)="pick($event)"
              class="text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-sm"
            />
            <volt-input
              class="w-56"
              [placeholder]="'Alt text'"
              [ariaLabel]="'Alt text'"
              [value]="alt()"
              (valueChange)="alt.set($event)"
            />
            <volt-button type="button" [disabled]="!file() || uploading()" (click)="upload()">
              {{ uploading() ? 'Uploading…' : 'Upload' }}
            </volt-button>
          </div>
          @if (uploadError(); as message) {
            <volt-error class="mt-3" role="alert">{{ message }}</volt-error>
          }
        </div>
      }

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
                  <img [src]="item.url" [alt]="item.alt ?? ''" class="h-full w-full object-cover" />
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
  private readonly api = injectForgeClient<DemoSchema>();
  protected readonly demo = inject(DemoPolicyService);

  protected readonly documents = signal<DemoDocument<'media'>[]>([]);
  protected readonly loading = signal(true);
  protected readonly file = signal<File | null>(null);
  protected readonly alt = signal('');
  protected readonly uploading = signal(false);
  protected readonly uploadError = signal<string | null>(null);

  ngOnInit(): void {
    void this.load();
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
      await this.api.uploadFile('media', file, { alt: this.alt(), filename: file.name });
      this.file.set(null);
      this.alt.set('');
      await this.load();
    } catch (err) {
      this.uploadError.set(describeAdminError(err));
    } finally {
      this.uploading.set(false);
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.documents.set(await this.api.getDocuments('media', { limit: 100 }));
    } finally {
      this.loading.set(false);
    }
  }
}
