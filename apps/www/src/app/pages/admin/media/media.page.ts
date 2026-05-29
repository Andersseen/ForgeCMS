import { ChangeDetectionStrategy, Component, signal, inject } from '@angular/core';
import type { OnInit } from '@angular/core';
import { VoltBadge, VoltButton, VoltCard, VoltInput, VoltProgress } from '@voltui/components';
import {
  IconClock,
  IconEye,
  IconFilter,
  IconHardDrive,
  IconImage,
  IconMoreVertical,
  IconPlus,
  IconSearch,
  IconTrash
} from '../../../components/icons';
import { CmsApiService } from '@forge-cms/angular';

interface MediaItem {
  id: string;
  name: string;
  type: 'image' | 'video' | 'document';
  mimeType: string;
  size: string;
  dimensions?: string;
  url: string;
  collection: string;
  uploadedAt: string;
}

@Component({
  selector: 'forge-cms-media',
  standalone: true,
  imports: [
    VoltCard,
    VoltButton,
    VoltBadge,
    VoltInput,
    VoltProgress,
    IconPlus,
    IconSearch,
    IconFilter,
    IconMoreVertical,
    IconEye,
    IconTrash,
    IconImage,
    IconHardDrive,
    IconClock
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold tracking-tight">Media Library</h1>
          <p class="text-sm text-muted-foreground mt-1">Manage images, videos, and documents.</p>
        </div>
        <div class="flex items-center gap-2">
          <volt-button variant="outline" size="sm">
            <icon-hard-drive class="h-3.5 w-3.5 mr-1.5" />
            Storage
          </volt-button>
          <volt-button size="sm">
            <icon-plus class="h-3.5 w-3.5 mr-1.5" />
            Upload
          </volt-button>
        </div>
      </div>

      @if (loading()) {
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          @for (_ of [1,2,3,4,5,6,7,8]; track $index) {
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
        <volt-card class="p-6">
          <div class="text-center space-y-2">
            <icon-image class="h-8 w-8 text-muted-foreground mx-auto" />
            <p class="text-sm font-medium">Media not connected</p>
            <p class="text-xs text-muted-foreground max-w-md mx-auto">
              {{ error() }} Storage adapter is available but no media API endpoint exists yet.
              Media is stored via the StorageAdapter (R2 in production).
            </p>
          </div>
        </volt-card>
      } @else {
        <!-- Storage Usage -->
        <volt-card class="p-4">
          <div class="flex items-center justify-between mb-2">
            <div>
              <h3 class="text-sm font-medium">Storage Usage</h3>
              <p class="text-xs text-muted-foreground mt-0.5">
                Connected via StorageAdapter — R2 in production
              </p>
            </div>
            <span class="text-sm font-medium">{{ mediaItems.length }} files</span>
          </div>
          <volt-progress [value]="mediaItems.length > 0 ? 10 : 0" />
        </volt-card>

        <!-- Filters -->
        <div class="flex items-center gap-3">
          <volt-input placeholder="Search media..." class="w-72 h-9 text-sm" />
          <volt-button variant="outline" size="sm">All Types</volt-button>
          <volt-button variant="outline" size="sm">Images</volt-button>
          <volt-button variant="outline" size="sm">Videos</volt-button>
          <volt-button variant="outline" size="sm">Documents</volt-button>
        </div>

        <!-- Media Grid -->
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          @for (item of mediaItems; track item.id) {
            <volt-card class="overflow-hidden group cursor-pointer">
              <div
                class="aspect-square bg-muted flex items-center justify-center relative overflow-hidden"
              >
                @if (item.type === 'image') {
                  <img [src]="item.url" [alt]="item.name" class="h-full w-full object-cover" />
                } @else {
                  <div class="flex flex-col items-center gap-2 text-muted-foreground">
                    <icon-image class="h-8 w-8" />
                    <span class="text-xs">{{ item.mimeType }}</span>
                  </div>
                }
                <div
                  class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2"
                >
                  <volt-button variant="secondary" size="icon" class="h-8 w-8">
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
                    <p class="text-sm font-medium truncate">{{ item.name }}</p>
                    <p class="text-xs text-muted-foreground">{{ item.size }}</p>
                  </div>
                  <volt-button variant="ghost" size="icon" class="h-6 w-6 shrink-0 -mt-1 -mr-1">
                    <icon-more-vertical class="h-3.5 w-3.5" />
                  </volt-button>
                </div>
                <div class="flex items-center gap-2 mt-2">
                  <volt-badge variant="outline" class="text-[10px] py-0">{{
                    item.collection
                  }}</volt-badge>
                  <span class="text-xs text-muted-foreground">{{ item.uploadedAt }}</span>
                </div>
                @if (item.dimensions) {
                  <p class="text-xs text-muted-foreground mt-1">{{ item.dimensions }}</p>
                }
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

  mediaItems: MediaItem[] = [
    {
      id: '1',
      name: 'hero-banner-homepage.jpg',
      type: 'image',
      mimeType: 'image/jpeg',
      size: '245 KB',
      dimensions: '1920 x 1080',
      url: 'https://picsum.photos/seed/forge1/400/400',
      collection: 'Pages',
      uploadedAt: '2h ago'
    },
    {
      id: '2',
      name: 'product-showcase.png',
      type: 'image',
      mimeType: 'image/png',
      size: '1.2 MB',
      dimensions: '1200 x 800',
      url: 'https://picsum.photos/seed/forge2/400/400',
      collection: 'Products',
      uploadedAt: '5h ago'
    },
    {
      id: '3',
      name: 'team-photo-2024.jpg',
      type: 'image',
      mimeType: 'image/jpeg',
      size: '3.4 MB',
      dimensions: '2400 x 1600',
      url: 'https://picsum.photos/seed/forge3/400/400',
      collection: 'About',
      uploadedAt: '1d ago'
    },
    {
      id: '4',
      name: 'tutorial-video.mp4',
      type: 'video',
      mimeType: 'video/mp4',
      size: '45 MB',
      url: '',
      collection: 'Posts',
      uploadedAt: '2d ago'
    },
    {
      id: '5',
      name: 'brand-guidelines.pdf',
      type: 'document',
      mimeType: 'application/pdf',
      size: '2.1 MB',
      url: '',
      collection: 'Media',
      uploadedAt: '3d ago'
    },
    {
      id: '6',
      name: 'blog-header-winter.jpg',
      type: 'image',
      mimeType: 'image/jpeg',
      size: '890 KB',
      dimensions: '1600 x 900',
      url: 'https://picsum.photos/seed/forge4/400/400',
      collection: 'Posts',
      uploadedAt: '1w ago'
    },
    {
      id: '7',
      name: 'product-icon-set.svg',
      type: 'image',
      mimeType: 'image/svg+xml',
      size: '45 KB',
      url: 'https://picsum.photos/seed/forge5/400/400',
      collection: 'Products',
      uploadedAt: '1w ago'
    },
    {
      id: '8',
      name: 'customer-testimonial.mp4',
      type: 'video',
      mimeType: 'video/mp4',
      size: '28 MB',
      url: '',
      collection: 'Pages',
      uploadedAt: '2w ago'
    }
  ];

  loading = signal(true);
  error = signal<string | null>(null);

  ngOnInit() {
    // Storage API endpoint not yet implemented — media is managed via
    // StorageAdapter (R2 in production). For now, show mock data.
    this.loading.set(false);
    this.error.set('Storage API endpoint not yet implemented.');
  }
}
