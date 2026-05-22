import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import {
  VoltAvatar,
  VoltAvatarFallback,
  VoltAvatarImage,
  VoltBadge,
  VoltButton,
  VoltCard,
  VoltInput,
  VoltProgress,
  VoltSeparator
} from '@voltui/components';
import {
  IconChevronRight,
  IconClock,
  IconEdit,
  IconEye,
  IconFileText,
  IconFilter,
  IconGlobe,
  IconImage,
  IconLayout,
  IconMoreVertical,
  IconNewspaper,
  IconPlus,
  IconSearch,
  IconTrash,
  IconUsers
} from '../../../components/icons';
import { CmsApiService } from '../../../services/cms-api.service';

interface CollectionViewModel {
  id: string;
  name: string;
  slug: string;
  description: string;
  count: number;
  drafts: number;
  icon: string;
  fields: string[];
  lastModified: string;
  modifiedBy: string;
  modifiedByAvatar: string;
}

const ICON_MAP: Record<string, string> = {
  pages: 'globe',
  posts: 'newspaper',
  products: 'settings',
  media: 'image',
  users: 'users',
  categories: 'shield',
  forms: 'terminal',
  navigation: 'layout'
};

@Component({
  selector: 'forge-cms-collections',
  standalone: true,
  imports: [
    VoltCard,
    VoltButton,
    VoltBadge,
    VoltAvatar,
    VoltAvatarImage,
    VoltAvatarFallback,
    VoltInput,
    VoltProgress,
    VoltSeparator,
    IconPlus,
    IconSearch,
    IconFilter,
    IconMoreVertical,
    IconEdit,
    IconEye,
    IconTrash,
    IconGlobe,
    IconNewspaper,
    IconFileText,
    IconImage,
    IconUsers,
    IconLayout,
    IconClock,
    IconChevronRight
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold tracking-tight">Collections</h1>
          <p class="text-sm text-muted-foreground mt-1">Manage your content types and schemas.</p>
        </div>
        <volt-button variant="default" size="sm">
          <icon-plus class="h-3.5 w-3.5 mr-1.5" />
          New Collection
        </volt-button>
      </div>

      <!-- Toolbar -->
      <div class="flex items-center gap-3">
        <volt-input placeholder="Search collections..." class="w-72 h-9 text-sm" />
        <volt-button variant="outline" size="sm">
          <icon-filter class="h-3.5 w-3.5 mr-1.5" />
          Filter
        </volt-button>
      </div>

      @if (loading()) {
        <div class="flex items-center justify-center py-12">
          <div class="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
        </div>
      } @else if (error()) {
        <div class="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {{ error() }}
        </div>
      } @else {
        <!-- Collections Grid -->
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          @for (col of collections(); track col.id) {
            <volt-card class="p-5 hover:border-primary/50 transition-all cursor-pointer group">
              <div class="flex items-start justify-between">
                <div class="flex items-center gap-3">
                  <div
                    class="h-10 w-10 rounded-lg bg-muted flex items-center justify-center text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors"
                  >
                    @switch (col.icon) {
                      @case ('globe') {
                        <icon-globe class="h-5 w-5" />
                      }
                      @case ('newspaper') {
                        <icon-newspaper class="h-5 w-5" />
                      }
                      @case ('image') {
                        <icon-image class="h-5 w-5" />
                      }
                      @case ('users') {
                        <icon-users class="h-5 w-5" />
                      }
                      @case ('settings') {
                        <icon-file-text class="h-5 w-5" />
                      }
                      @case ('shield') {
                        <icon-file-text class="h-5 w-5" />
                      }
                      @case ('terminal') {
                        <icon-file-text class="h-5 w-5" />
                      }
                      @default {
                        <icon-file-text class="h-5 w-5" />
                      }
                    }
                  </div>
                  <div>
                    <h3 class="font-semibold">{{ col.name }}</h3>
                    <p class="text-xs text-muted-foreground">/{{ col.slug }}</p>
                  </div>
                </div>
                <div
                  class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <volt-button variant="ghost" size="icon" class="h-7 w-7">
                    <icon-eye class="h-3.5 w-3.5" />
                  </volt-button>
                  <volt-button variant="ghost" size="icon" class="h-7 w-7">
                    <icon-edit class="h-3.5 w-3.5" />
                  </volt-button>
                  <volt-button variant="ghost" size="icon" class="h-7 w-7">
                    <icon-more-vertical class="h-3.5 w-3.5" />
                  </volt-button>
                </div>
              </div>

              <p class="text-sm text-muted-foreground mt-3">{{ col.description }}</p>

              <div class="mt-4">
                <div class="flex items-center justify-between text-xs mb-1.5">
                  <span class="text-muted-foreground">{{ col.count }} documents</span>
                  @if (col.drafts > 0) {
                    <span class="text-warning">{{ col.drafts }} drafts</span>
                  } @else {
                    <span class="text-success">All published</span>
                  }
                </div>
                <div class="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    class="h-full rounded-full bg-primary transition-all"
                    [style.width.%]="col.count > 0 ? ((col.count - col.drafts) / col.count) * 100 : 100"
                  ></div>
                </div>
              </div>

              <div class="mt-4 flex flex-wrap gap-1.5">
                @for (field of col.fields; track field) {
                  <span
                    class="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                    >{{ field }}</span
                  >
                }
              </div>

              <volt-separator class="my-4" />

              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2 text-xs text-muted-foreground">
                  <icon-clock class="h-3 w-3" />
                  <span>{{ col.lastModified }}</span>
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="text-xs text-muted-foreground">by</span>
                  <volt-avatar>
                    <img [src]="col.modifiedByAvatar" [alt]="col.modifiedBy" voltAvatarImage />
                    <volt-avatar-fallback>{{
                      col.modifiedBy.slice(0, 2).toUpperCase()
                    }}</volt-avatar-fallback>
                  </volt-avatar>
                </div>
              </div>
            </volt-card>
          }
        </div>
      }
    </div>
  `
})
export class CollectionsPage implements OnInit {
  private api = inject(CmsApiService);

  readonly collections = signal<CollectionViewModel[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  async ngOnInit() {
    try {
      this.loading.set(true);
      this.error.set(null);

      const metaList = await this.api.getCollections();

      const viewModels: CollectionViewModel[] = await Promise.all(
        metaList.map(async (meta) => {
          const docs = await this.api.getDocuments(meta.slug);
          const draftCount = docs.filter((d) => d['status'] === 'draft').length;

          return {
            id: meta.slug,
            name: meta.name,
            slug: meta.slug,
            description: meta.description,
            count: docs.length,
            drafts: draftCount,
            icon: ICON_MAP[meta.slug] ?? 'file-text',
            fields: meta.fields,
            lastModified: 'Just now',
            modifiedBy: 'System',
            modifiedByAvatar: 'https://i.pravatar.cc/150?u=system'
          };
        })
      );

      this.collections.set(viewModels);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load collections');
    } finally {
      this.loading.set(false);
    }
  }
}
