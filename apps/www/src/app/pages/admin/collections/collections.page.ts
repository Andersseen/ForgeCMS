import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  VoltAvatar,
  VoltAvatarFallback,
  VoltAvatarImage,
  VoltBadge,
  VoltButton,
  VoltCard,
  VoltInput,
  VoltProgress,
  VoltSeparator,
} from '@voltui/components';
import {
  IconChevronRight,
  IconClock,
  IconDatabase,
  IconEdit,
  IconEye,
  IconFileText,
  IconFilter,
  IconGlobe,
  IconHardDrive,
  IconImage,
  IconLayout,
  IconMoreVertical,
  IconNewspaper,
  IconPlus,
  IconSearch,
  IconSettings,
  IconShield,
  IconTerminal,
  IconTrash,
  IconUsers,
} from '../../../components/icons';

interface Collection {
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
    IconChevronRight,
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

      <!-- Collections Grid -->
      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        @for (col of collections; track col.id) {
          <volt-card class="p-5 hover:border-primary/50 transition-all cursor-pointer group">
            <div class="flex items-start justify-between">
              <div class="flex items-center gap-3">
                <div class="h-10 w-10 rounded-lg bg-muted flex items-center justify-center text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                  @switch (col.icon) {
                    @case ('globe') { <icon-globe class="h-5 w-5" /> }
                    @case ('newspaper') { <icon-newspaper class="h-5 w-5" /> }
                    @case ('image') { <icon-image class="h-5 w-5" /> }
                    @case ('users') { <icon-users class="h-5 w-5" /> }
                    @case ('settings') { <icon-settings class="h-5 w-5" /> }
                    @case ('shield') { <icon-shield class="h-5 w-5" /> }
                    @case ('terminal') { <icon-terminal class="h-5 w-5" /> }
                    @default { <icon-file-text class="h-5 w-5" /> }
                  }
                </div>
                <div>
                  <h3 class="font-semibold">{{ col.name }}</h3>
                  <p class="text-xs text-muted-foreground">/{{ col.slug }}</p>
                </div>
              </div>
              <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
                  [style.width.%]="((col.count - col.drafts) / col.count) * 100"
                ></div>
              </div>
            </div>

            <div class="mt-4 flex flex-wrap gap-1.5">
              @for (field of col.fields; track field) {
                <span class="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{{ field }}</span>
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
                  <volt-avatar-fallback>{{ col.modifiedBy.slice(0, 2).toUpperCase() }}</volt-avatar-fallback>
                </volt-avatar>
              </div>
            </div>
          </volt-card>
        }
      </div>
    </div>
  `,
})
export class CollectionsPage {
  collections: Collection[] = [
    {
      id: '1',
      name: 'Pages',
      slug: 'pages',
      description: 'Static pages for your website. Home, About, Contact, and custom landing pages.',
      count: 24,
      drafts: 3,
      icon: 'globe',
      fields: ['slug', 'title', 'content', 'seo', 'meta', 'status'],
      lastModified: '2h ago',
      modifiedBy: 'John Doe',
      modifiedByAvatar: 'https://i.pravatar.cc/150?u=1',
    },
    {
      id: '2',
      name: 'Posts',
      slug: 'posts',
      description: 'Blog posts and articles with rich text editing, tags, and categories.',
      count: 156,
      drafts: 12,
      icon: 'newspaper',
      fields: ['slug', 'title', 'excerpt', 'body', 'tags', 'category', 'publishedAt', 'author'],
      lastModified: '5h ago',
      modifiedBy: 'Sarah Miller',
      modifiedByAvatar: 'https://i.pravatar.cc/150?u=2',
    },
    {
      id: '3',
      name: 'Products',
      slug: 'products',
      description: 'E-commerce products with variants, pricing, and inventory tracking.',
      count: 48,
      drafts: 0,
      icon: 'settings',
      fields: ['sku', 'name', 'description', 'price', 'inventory', 'images', 'category'],
      lastModified: '1d ago',
      modifiedBy: 'Mike Kim',
      modifiedByAvatar: 'https://i.pravatar.cc/150?u=3',
    },
    {
      id: '4',
      name: 'Media',
      slug: 'media',
      description: 'Images, videos, PDFs, and other file assets used across all collections.',
      count: 3456,
      drafts: 0,
      icon: 'image',
      fields: ['filename', 'alt', 'mimeType', 'size', 'dimensions', 'url'],
      lastModified: '30m ago',
      modifiedBy: 'Anna Lee',
      modifiedByAvatar: 'https://i.pravatar.cc/150?u=4',
    },
    {
      id: '5',
      name: 'Users',
      slug: 'users',
      description: 'CMS user accounts with roles and permissions for content management.',
      count: 42,
      drafts: 0,
      icon: 'users',
      fields: ['email', 'name', 'role', 'avatar', 'status', 'lastLogin'],
      lastModified: '3d ago',
      modifiedBy: 'Admin User',
      modifiedByAvatar: 'https://i.pravatar.cc/150?u=admin',
    },
    {
      id: '6',
      name: 'Categories',
      slug: 'categories',
      description: 'Hierarchical taxonomy for organizing posts and products.',
      count: 12,
      drafts: 0,
      icon: 'shield',
      fields: ['slug', 'name', 'description', 'parent', 'order'],
      lastModified: '1w ago',
      modifiedBy: 'John Doe',
      modifiedByAvatar: 'https://i.pravatar.cc/150?u=1',
    },
    {
      id: '7',
      name: 'Forms',
      slug: 'forms',
      description: 'Contact forms, surveys, and custom form definitions with submission handling.',
      count: 8,
      drafts: 1,
      icon: 'terminal',
      fields: ['name', 'fields', 'submissions', 'webhook', 'notifications'],
      lastModified: '2d ago',
      modifiedBy: 'Robert Johnson',
      modifiedByAvatar: 'https://i.pravatar.cc/150?u=5',
    },
    {
      id: '8',
      name: 'Navigation',
      slug: 'navigation',
      description: 'Menu structures for header, footer, and sidebar navigation.',
      count: 4,
      drafts: 0,
      icon: 'settings',
      fields: ['name', 'items', 'location', 'locale'],
      lastModified: '3d ago',
      modifiedBy: 'Sarah Miller',
      modifiedByAvatar: 'https://i.pravatar.cc/150?u=2',
    },
  ];
}
