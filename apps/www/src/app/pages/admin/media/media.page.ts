import { ChangeDetectionStrategy, Component, signal, inject } from '@angular/core';
import type { OnInit } from '@angular/core';
import { VoltButton, VoltCard, VoltInput, VoltProgress } from '@voltui/components';
import {
  IconAlertCircle,
  IconEye,
  IconHardDrive,
  IconImage,
  IconPlus,
  IconTrash
} from '../../../components/icons';
import { CmsApiService } from '@forge-cms/angular';
import { PageHeaderComponent, ErrorStateComponent, EmptyStateComponent } from '@forge-cms/admin';
import { SearchToolbarComponent } from '../components';

@Component({
  selector: 'forge-cms-media',
  standalone: true,
  imports: [
    VoltCard,
    VoltButton,
    VoltInput,
    VoltProgress,
    IconPlus,
    IconEye,
    IconTrash,
    IconImage,
    IconHardDrive,
    IconAlertCircle,
    PageHeaderComponent,
    ErrorStateComponent,
    EmptyStateComponent,
    SearchToolbarComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <forge-page-header title="Media Library" subtitle="Manage images, videos, and documents.">
        <div actions class="flex items-center gap-2">
          <volt-button variant="outline" size="sm">
            <icon-hard-drive class="h-3.5 w-3.5 mr-1.5" />
            Storage
          </volt-button>
          <volt-button size="sm">
            <icon-plus class="h-3.5 w-3.5 mr-1.5" />
            Upload
          </volt-button>
        </div>
      </forge-page-header>

      @if (loading()) {
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          @for (_ of [1, 2, 3, 4, 5, 6, 7, 8]; track $index) {
            <volt-card class="overflow-hidden">
              <div class="aspect-square bg-muted animate-pulse"></div>
              <div class="p-3 space-y-2">
                <div class="h-4 bg-muted rounded w-3/4"></div>
                <div class="h-3 bg-muted rounded w-1/2"></div>
              </div>
            </volt-card>
          }
        </div>
      } @else if (error()) {
        <forge-error-state title="Unable to load media" [message]="error()" (retry)="loadMedia()" />
      } @else if (mediaItems().length === 0) {
        <forge-empty-state
          title="No media yet"
          message="Upload files to see them here. Media storage uses the StorageAdapter (R2 in production)."
        >
          <icon-image icon class="h-6 w-6" />
        </forge-empty-state>
      } @else {
        <volt-card class="p-4">
          <div class="flex items-center justify-between mb-2">
            <div>
              <h3 class="text-sm font-medium">Storage Usage</h3>
              <p class="text-xs text-muted-foreground mt-0.5">Connected via StorageAdapter</p>
            </div>
            <span class="text-sm font-medium">{{ mediaItems().length }} files</span>
          </div>
          <volt-progress [value]="mediaItems().length > 0 ? 10 : 0" />
        </volt-card>

        <forge-search-toolbar placeholder="Search media...">
          <div filters>
            <volt-button variant="outline" size="sm">All Types</volt-button>
            <volt-button variant="outline" size="sm">Images</volt-button>
            <volt-button variant="outline" size="sm">Videos</volt-button>
          </div>
        </forge-search-toolbar>

        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          @for (item of mediaItems(); track item.id) {
            <volt-card class="overflow-hidden group cursor-pointer">
              <div
                class="aspect-square bg-muted flex items-center justify-center relative overflow-hidden"
              >
                @if (item.url) {
                  <img [src]="item.url" [alt]="item.filename" class="h-full w-full object-cover" />
                } @else {
                  <div class="flex flex-col items-center gap-2 text-muted-foreground">
                    <icon-image class="h-8 w-8" />
                    <span class="text-xs">{{ item.mimeType || 'file' }}</span>
                  </div>
                }
                <div
                  class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2"
                >
                  <volt-button variant="outline" size="icon" class="h-8 w-8">
                    <icon-eye class="h-4 w-4" />
                  </volt-button>
                  <volt-button variant="destructive" size="icon" class="h-8 w-8">
                    <icon-trash class="h-4 w-4" />
                  </volt-button>
                </div>
              </div>
              <div class="p-3">
                <div class="flex items-start justify-between">
                  <div class="min-w-0">
                    <p class="text-sm font-medium truncate">{{ item.filename }}</p>
                    <p class="text-xs text-muted-foreground">{{ item.size || 0 }} bytes</p>
                  </div>
                </div>
              </div>
            </volt-card>
          }
        </div>
      }
    </div>
  `
})
export class MediaPage implements OnInit {
  private api = inject(CmsApiService);

  mediaItems = signal<Record<string, unknown>[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);

  ngOnInit() {
    void this.loadMedia();
  }

  async loadMedia() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const docs = await this.api.getDocuments('media');
      this.mediaItems.set(docs);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to load media');
    } finally {
      this.loading.set(false);
    }
  }
}
