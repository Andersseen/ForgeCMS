import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  VoltAvatar,
  VoltAvatarFallback,
  VoltAvatarImage,
  VoltBadge,
  VoltButton,
  VoltCard,
  VoltProgress,
  VoltSeparator,
} from '@voltui/components';
import {
  IconAlertCircle,
  IconBarChart,
  IconCheckCircle,
  IconClock,
  IconDatabase,
  IconEye,
  IconFileText,
  IconGlobe,
  IconHardDrive,
  IconImage,
  IconNewspaper,
  IconUsers,
  IconXCircle,
  IconZap,
} from '../../../components/icons';

interface ActivityItem {
  id: string;
  action: 'created' | 'updated' | 'deleted' | 'published' | 'unpublished';
  user: string;
  userAvatar: string;
  document: string;
  collection: string;
  time: string;
}

interface DraftItem {
  id: string;
  title: string;
  collection: string;
  author: string;
  authorAvatar: string;
  updatedAt: string;
}

interface CollectionStat {
  name: string;
  slug: string;
  count: number;
  icon: string;
  lastModified: string;
}

@Component({
  selector: 'forge-cms-dashboard',
  standalone: true,
  imports: [
    VoltCard,
    VoltButton,
    VoltBadge,
    VoltAvatar,
    VoltAvatarImage,
    VoltAvatarFallback,
    VoltProgress,
    VoltSeparator,
    IconBarChart,
    IconUsers,
    IconImage,
    IconHardDrive,
    IconGlobe,
    IconFileText,
    IconNewspaper,
    IconClock,
    IconCheckCircle,
    IconAlertCircle,
    IconXCircle,
    IconEye,
    IconZap,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p class="text-sm text-muted-foreground mt-1">Welcome back. Here's what's happening with your CMS.</p>
        </div>
        <div class="flex items-center gap-2">
          <volt-button variant="outline" size="sm">
            <icon-zap class="h-3.5 w-3.5 mr-1.5" />
            Quick Start
          </volt-button>
          <volt-button size="sm">
            <icon-file-text class="h-3.5 w-3.5 mr-1.5" />
            New Document
          </volt-button>
        </div>
      </div>

      <!-- Stats Cards -->
      <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <volt-card class="p-4">
          <div class="flex items-center justify-between">
            <div class="space-y-1">
              <p class="text-sm text-muted-foreground">Total Documents</p>
              <p class="text-2xl font-bold">1,284</p>
              <div class="flex items-center gap-1 text-xs">
                <span class="text-success font-medium">+12%</span>
                <span class="text-muted-foreground">vs last month</span>
              </div>
            </div>
            <div class="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <icon-file-text class="h-5 w-5" />
            </div>
          </div>
        </volt-card>

        <volt-card class="p-4">
          <div class="flex items-center justify-between">
            <div class="space-y-1">
              <p class="text-sm text-muted-foreground">Published</p>
              <p class="text-2xl font-bold">1,102</p>
              <div class="flex items-center gap-1 text-xs">
                <span class="text-success font-medium">86%</span>
                <span class="text-muted-foreground">of total</span>
              </div>
            </div>
            <div class="h-10 w-10 rounded-lg bg-success/10 text-success flex items-center justify-center">
              <icon-check-circle class="h-5 w-5" />
            </div>
          </div>
        </volt-card>

        <volt-card class="p-4">
          <div class="flex items-center justify-between">
            <div class="space-y-1">
              <p class="text-sm text-muted-foreground">Drafts</p>
              <p class="text-2xl font-bold">142</p>
              <div class="flex items-center gap-1 text-xs">
                <span class="text-warning font-medium">34</span>
                <span class="text-muted-foreground">pending review</span>
              </div>
            </div>
            <div class="h-10 w-10 rounded-lg bg-warning/10 text-warning flex items-center justify-center">
              <icon-alert-circle class="h-5 w-5" />
            </div>
          </div>
        </volt-card>

        <volt-card class="p-4">
          <div class="flex items-center justify-between">
            <div class="space-y-1">
              <p class="text-sm text-muted-foreground">Media Files</p>
              <p class="text-2xl font-bold">3,456</p>
              <div class="flex items-center gap-1 text-xs">
                <span class="text-muted-foreground">4.2 GB used</span>
              </div>
            </div>
            <div class="h-10 w-10 rounded-lg bg-info/10 text-info flex items-center justify-center">
              <icon-image class="h-5 w-5" />
            </div>
          </div>
        </volt-card>
      </div>

      <div class="grid gap-6 lg:grid-cols-3">
        <!-- Collections Overview -->
        <div class="lg:col-span-2 space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold">Collections</h2>
            <a routerLink="/admin/collections">
              <volt-button variant="ghost" size="sm">View All</volt-button>
            </a>
          </div>
          <div class="grid gap-3 md:grid-cols-2">
            @for (col of collections; track col.slug) {
              <volt-card class="p-4 hover:border-primary/50 transition-all cursor-pointer group">
                <div class="flex items-start justify-between">
                  <div class="flex items-center gap-3">
                    <div class="h-9 w-9 rounded-lg bg-muted flex items-center justify-center text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                      @switch (col.icon) {
                        @case ('globe') { <icon-globe class="h-4 w-4" /> }
                        @case ('newspaper') { <icon-newspaper class="h-4 w-4" /> }
                        @case ('image') { <icon-image class="h-4 w-4" /> }
                        @case ('users') { <icon-users class="h-4 w-4" /> }
                        @default { <icon-file-text class="h-4 w-4" /> }
                      }
                    </div>
                    <div>
                      <h3 class="font-medium text-sm">{{ col.name }}</h3>
                      <p class="text-xs text-muted-foreground">{{ col.count }} documents</p>
                    </div>
                  </div>
                  <volt-button variant="ghost" size="icon" class="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
                    <icon-eye class="h-3.5 w-3.5" />
                  </volt-button>
                </div>
                <div class="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <icon-clock class="h-3 w-3" />
                  <span>Modified {{ col.lastModified }}</span>
                </div>
              </volt-card>
            }
          </div>
        </div>

        <!-- Drafts Pending Review -->
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold">Pending Review</h2>
            <volt-badge variant="secondary">{{ drafts.length }}</volt-badge>
          </div>
          <div class="space-y-3">
            @for (draft of drafts; track draft.id) {
              <volt-card class="p-3 hover:border-warning/50 transition-colors cursor-pointer">
                <div class="flex items-start gap-3">
                  <volt-avatar>
                    <img [src]="draft.authorAvatar" [alt]="draft.author" voltAvatarImage />
                    <volt-avatar-fallback>{{ draft.author.slice(0, 2).toUpperCase() }}</volt-avatar-fallback>
                  </volt-avatar>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium truncate">{{ draft.title }}</p>
                    <div class="flex items-center gap-2 mt-1">
                      <volt-badge variant="outline" class="text-xs py-0">{{ draft.collection }}</volt-badge>
                      <span class="text-xs text-muted-foreground">{{ draft.updatedAt }}</span>
                    </div>
                  </div>
                </div>
              </volt-card>
            }
          </div>
          <volt-button variant="outline" size="sm" class="w-full">View All Drafts</volt-button>
        </div>
      </div>

      <!-- Activity Log -->
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">Recent Activity</h2>
          <volt-button variant="ghost" size="sm">View All Activity</volt-button>
        </div>
        <volt-card class="overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-muted/50">
                <tr class="border-b border-border">
                  <th class="h-10 px-4 text-left font-medium text-muted-foreground w-10"></th>
                  <th class="h-10 px-4 text-left font-medium text-muted-foreground">Action</th>
                  <th class="h-10 px-4 text-left font-medium text-muted-foreground">Document</th>
                  <th class="h-10 px-4 text-left font-medium text-muted-foreground">Collection</th>
                  <th class="h-10 px-4 text-left font-medium text-muted-foreground">User</th>
                  <th class="h-10 px-4 text-right font-medium text-muted-foreground">Time</th>
                </tr>
              </thead>
              <tbody>
                @for (item of activityLog; track item.id) {
                  <tr class="border-b border-border hover:bg-muted/30 transition-colors">
                    <td class="px-4 py-3">
                      @switch (item.action) {
                        @case ('published') {
                          <div class="h-6 w-6 rounded-full bg-success/10 text-success flex items-center justify-center">
                            <icon-check-circle class="h-3.5 w-3.5" />
                          </div>
                        }
                        @case ('created') {
                          <div class="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                            <icon-file-text class="h-3.5 w-3.5" />
                          </div>
                        }
                        @case ('updated') {
                          <div class="h-6 w-6 rounded-full bg-info/10 text-info flex items-center justify-center">
                            <icon-bar-chart class="h-3.5 w-3.5" />
                          </div>
                        }
                        @case ('deleted') {
                          <div class="h-6 w-6 rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
                            <icon-x-circle class="h-3.5 w-3.5" />
                          </div>
                        }
                        @case ('unpublished') {
                          <div class="h-6 w-6 rounded-full bg-warning/10 text-warning flex items-center justify-center">
                            <icon-alert-circle class="h-3.5 w-3.5" />
                          </div>
                        }
                      }
                    </td>
                    <td class="px-4 py-3">
                      <span class="capitalize font-medium text-xs">{{ item.action }}</span>
                    </td>
                    <td class="px-4 py-3 font-medium">{{ item.document }}</td>
                    <td class="px-4 py-3 text-muted-foreground">{{ item.collection }}</td>
                    <td class="px-4 py-3">
                      <div class="flex items-center gap-2">
                        <volt-avatar>
                          <img [src]="item.userAvatar" [alt]="item.user" voltAvatarImage />
                          <volt-avatar-fallback>{{ item.user.slice(0, 2).toUpperCase() }}</volt-avatar-fallback>
                        </volt-avatar>
                        <span class="text-sm">{{ item.user }}</span>
                      </div>
                    </td>
                    <td class="px-4 py-3 text-right text-muted-foreground text-xs">{{ item.time }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </volt-card>
      </div>

      <!-- System Health -->
      <div class="space-y-4">
        <h2 class="text-lg font-semibold">System Health</h2>
        <div class="grid gap-4 md:grid-cols-3">
          <volt-card class="p-4">
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center gap-2">
                <icon-hard-drive class="h-4 w-4 text-muted-foreground" />
                <h3 class="text-sm font-medium">Storage</h3>
              </div>
              <span class="text-xs font-medium text-success">Healthy</span>
            </div>
            <p class="text-xs text-muted-foreground mb-3">4.2 GB of 10 GB used</p>
            <volt-progress [value]="42" />
            <p class="text-xs text-muted-foreground mt-2">5.8 GB remaining</p>
          </volt-card>

          <volt-card class="p-4">
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center gap-2">
                <icon-database class="h-4 w-4 text-muted-foreground" />
                <h3 class="text-sm font-medium">Database</h3>
              </div>
              <span class="text-xs font-medium text-success">Healthy</span>
            </div>
            <p class="text-xs text-muted-foreground mb-3">Last backup: 2h ago</p>
            <volt-progress [value]="68" />
            <p class="text-xs text-muted-foreground mt-2">12,847 records</p>
          </volt-card>

          <volt-card class="p-4">
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center gap-2">
                <icon-globe class="h-4 w-4 text-muted-foreground" />
                <h3 class="text-sm font-medium">API</h3>
              </div>
              <span class="text-xs font-medium text-success">Online</span>
            </div>
            <p class="text-xs text-muted-foreground mb-3">24.5k requests today</p>
            <volt-progress [value]="35" />
            <p class="text-xs text-muted-foreground mt-2">Avg latency: 45ms</p>
          </volt-card>
        </div>
      </div>
    </div>
  `,
})
export class DashboardPage {
  collections: CollectionStat[] = [
    { name: 'Pages', slug: 'pages', count: 24, icon: 'globe', lastModified: '2h ago' },
    { name: 'Posts', slug: 'posts', count: 156, icon: 'newspaper', lastModified: '5h ago' },
    { name: 'Products', slug: 'products', count: 48, icon: 'file-text', lastModified: '1d ago' },
    { name: 'Media', slug: 'media', count: 3456, icon: 'image', lastModified: '30m ago' },
    { name: 'Users', slug: 'users', count: 42, icon: 'users', lastModified: '3d ago' },
    { name: 'Categories', slug: 'categories', count: 12, icon: 'file-text', lastModified: '1w ago' },
  ];

  drafts: DraftItem[] = [
    { id: '1', title: 'Q3 Marketing Strategy', collection: 'Posts', author: 'Sarah Miller', authorAvatar: 'https://i.pravatar.cc/150?u=2', updatedAt: '2h ago' },
    { id: '2', title: 'New Product Launch Page', collection: 'Pages', author: 'Mike Kim', authorAvatar: 'https://i.pravatar.cc/150?u=3', updatedAt: '5h ago' },
    { id: '3', title: 'Team Handbook v2', collection: 'Pages', author: 'Anna Lee', authorAvatar: 'https://i.pravatar.cc/150?u=4', updatedAt: '1d ago' },
    { id: '4', title: 'API Documentation', collection: 'Posts', author: 'John Doe', authorAvatar: 'https://i.pravatar.cc/150?u=1', updatedAt: '1d ago' },
  ];

  activityLog: ActivityItem[] = [
    { id: '1', action: 'published', user: 'John Doe', userAvatar: 'https://i.pravatar.cc/150?u=1', document: 'Homepage Hero Update', collection: 'Pages', time: '2h ago' },
    { id: '2', action: 'created', user: 'Sarah Miller', userAvatar: 'https://i.pravatar.cc/150?u=2', document: 'Q3 Marketing Strategy', collection: 'Posts', time: '3h ago' },
    { id: '3', action: 'updated', user: 'Mike Kim', userAvatar: 'https://i.pravatar.cc/150?u=3', document: 'Pricing Page', collection: 'Pages', time: '5h ago' },
    { id: '4', action: 'deleted', user: 'Robert Johnson', userAvatar: 'https://i.pravatar.cc/150?u=5', document: 'Old Landing Page', collection: 'Pages', time: '1d ago' },
    { id: '5', action: 'published', user: 'Anna Lee', userAvatar: 'https://i.pravatar.cc/150?u=4', document: 'Getting Started Guide', collection: 'Posts', time: '1d ago' },
    { id: '6', action: 'unpublished', user: 'John Doe', userAvatar: 'https://i.pravatar.cc/150?u=1', document: 'Deprecated API Docs', collection: 'Posts', time: '2d ago' },
    { id: '7', action: 'created', user: 'Sarah Miller', userAvatar: 'https://i.pravatar.cc/150?u=2', document: 'Summer Sale Banner', collection: 'Media', time: '2d ago' },
  ];
}
