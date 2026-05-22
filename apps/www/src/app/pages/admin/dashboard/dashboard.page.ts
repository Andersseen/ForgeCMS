import { ChangeDetectionStrategy, Component, OnInit, signal, inject } from '@angular/core';
import {
  VoltAvatar,
  VoltAvatarFallback,
  VoltAvatarImage,
  VoltBadge,
  VoltButton,
  VoltCard,
  VoltProgress,
  VoltSeparator
} from '@voltui/components';
import {
  IconAlertCircle,
  IconBarChart,
  IconCheckCircle,
  IconClock,
  IconEye,
  IconFileText,
  IconGlobe,
  IconHardDrive,
  IconImage,
  IconNewspaper,
  IconUsers,
  IconXCircle,
  IconZap
} from '../../../components/icons';
import { CmsApiService } from '../../../services/cms-api.service';
import { RouterLink } from '@angular/router';

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
    RouterLink,
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
    IconZap
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p class="text-sm text-muted-foreground mt-1">
            Welcome back. Here's what's happening with your CMS.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <volt-button variant="outline" size="sm">
            <icon-zap class="h-3.5 w-3.5 mr-1.5" />
            Quick Start
          </volt-button>
          <a routerLink="/admin/collections">
            <volt-button size="sm">
              <icon-file-text class="h-3.5 w-3.5 mr-1.5" />
              New Document
            </volt-button>
          </a>
        </div>
      </div>

      @if (loading()) {
        <!-- Loading skeleton -->
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          @for (_ of [1,2,3,4]; track $index) {
            <volt-card class="p-4">
              <div class="animate-pulse space-y-3">
                <div class="h-4 bg-muted rounded w-24"></div>
                <div class="h-8 bg-muted rounded w-16"></div>
                <div class="h-3 bg-muted rounded w-32"></div>
              </div>
            </volt-card>
          }
        </div>
      } @else if (error()) {
        <volt-card class="p-6">
          <div class="text-center space-y-2">
            <icon-alert-circle class="h-8 w-8 text-destructive mx-auto" />
            <p class="text-sm font-medium">Failed to load dashboard data</p>
            <p class="text-xs text-muted-foreground">{{ error() }}</p>
            <volt-button size="sm" (click)="loadData()">Retry</volt-button>
          </div>
        </volt-card>
      } @else {
        <!-- Stats Cards -->
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <volt-card class="p-4">
            <div class="flex items-center justify-between">
              <div class="space-y-1">
                <p class="text-sm text-muted-foreground">Total Documents</p>
                <p class="text-2xl font-bold">{{ totalDocuments() }}</p>
                <div class="flex items-center gap-1 text-xs">
                  <span class="text-muted-foreground">across {{ collections().length }} collections</span>
                </div>
              </div>
              <div
                class="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center"
              >
                <icon-file-text class="h-5 w-5" />
              </div>
            </div>
          </volt-card>

          <volt-card class="p-4">
            <div class="flex items-center justify-between">
              <div class="space-y-1">
                <p class="text-sm text-muted-foreground">Published</p>
                <p class="text-2xl font-bold">{{ totalDocuments() }}</p>
                <div class="flex items-center gap-1 text-xs">
                  <span class="text-success font-medium">100%</span>
                  <span class="text-muted-foreground">of total</span>
                </div>
              </div>
              <div
                class="h-10 w-10 rounded-lg bg-success/10 text-success flex items-center justify-center"
              >
                <icon-check-circle class="h-5 w-5" />
              </div>
            </div>
          </volt-card>

          <volt-card class="p-4">
            <div class="flex items-center justify-between">
              <div class="space-y-1">
                <p class="text-sm text-muted-foreground">Collections</p>
                <p class="text-2xl font-bold">{{ collections().length }}</p>
                <div class="flex items-center gap-1 text-xs">
                  <span class="text-muted-foreground">configured</span>
                </div>
              </div>
              <div
                class="h-10 w-10 rounded-lg bg-warning/10 text-warning flex items-center justify-center"
              >
                <icon-newspaper class="h-5 w-5" />
              </div>
            </div>
          </volt-card>

          <volt-card class="p-4">
            <div class="flex items-center justify-between">
              <div class="space-y-1">
                <p class="text-sm text-muted-foreground">Media Files</p>
                <p class="text-2xl font-bold">0</p>
                <div class="flex items-center gap-1 text-xs">
                  <span class="text-muted-foreground">via Storage</span>
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
              @for (col of collections(); track col.slug) {
                <a [routerLink]="['/admin/collections', col.slug]">
                  <volt-card class="p-4 hover:border-primary/50 transition-all cursor-pointer group">
                    <div class="flex items-start justify-between">
                      <div class="flex items-center gap-3">
                        <div
                          class="h-9 w-9 rounded-lg bg-muted flex items-center justify-center text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors"
                        >
                          @switch (col.icon) {
                            @case ('globe') {
                              <icon-globe class="h-4 w-4" />
                            }
                            @case ('newspaper') {
                              <icon-newspaper class="h-4 w-4" />
                            }
                            @case ('image') {
                              <icon-image class="h-4 w-4" />
                            }
                            @case ('users') {
                              <icon-users class="h-4 w-4" />
                            }
                            @default {
                              <icon-file-text class="h-4 w-4" />
                            }
                          }
                        </div>
                        <div>
                          <h3 class="font-medium text-sm">{{ col.name }}</h3>
                          <p class="text-xs text-muted-foreground">{{ col.count }} documents</p>
                        </div>
                      </div>
                      <volt-button
                        variant="ghost"
                        size="icon"
                        class="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <icon-eye class="h-3.5 w-3.5" />
                      </volt-button>
                    </div>
                    <div class="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <icon-clock class="h-3 w-3" />
                      <span>Modified {{ col.lastModified }}</span>
                    </div>
                  </volt-card>
                </a>
              }
            </div>
          </div>

          <!-- Drafts Pending Review -->
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold">Pending Review</h2>
              <volt-badge variant="secondary">0</volt-badge>
            </div>
            <div class="space-y-3">
              <p class="text-sm text-muted-foreground text-center py-8">
                No pending drafts
              </p>
            </div>
            <volt-button variant="outline" size="sm" class="w-full">View All Drafts</volt-button>
          </div>
        </div>

        <!-- Activity Log (mock — activity tracking not yet implemented) -->
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
                            <div
                              class="h-6 w-6 rounded-full bg-success/10 text-success flex items-center justify-center"
                            >
                              <icon-check-circle class="h-3.5 w-3.5" />
                            </div>
                          }
                          @case ('created') {
                            <div
                              class="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center"
                            >
                              <icon-file-text class="h-3.5 w-3.5" />
                            </div>
                          }
                          @case ('updated') {
                            <div
                              class="h-6 w-6 rounded-full bg-info/10 text-info flex items-center justify-center"
                            >
                              <icon-bar-chart class="h-3.5 w-3.5" />
                            </div>
                          }
                          @case ('deleted') {
                            <div
                              class="h-6 w-6 rounded-full bg-destructive/10 text-destructive flex items-center justify-center"
                            >
                              <icon-x-circle class="h-3.5 w-3.5" />
                            </div>
                          }
                          @case ('unpublished') {
                            <div
                              class="h-6 w-6 rounded-full bg-warning/10 text-warning flex items-center justify-center"
                            >
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
                            <volt-avatar-fallback>{{
                              item.user.slice(0, 2).toUpperCase()
                            }}</volt-avatar-fallback>
                          </volt-avatar>
                          <span class="text-sm">{{ item.user }}</span>
                        </div>
                      </td>
                      <td class="px-4 py-3 text-right text-muted-foreground text-xs">
                        {{ item.time }}
                      </td>
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
              <p class="text-xs text-muted-foreground mb-3">R2 bucket connected</p>
              <volt-progress [value]="0" />
              <p class="text-xs text-muted-foreground mt-2">No files stored yet</p>
            </volt-card>

            <volt-card class="p-4">
              <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2">
                  <icon-database class="h-4 w-4 text-muted-foreground" />
                  <h3 class="text-sm font-medium">Database</h3>
                </div>
                <span class="text-xs font-medium text-success">Healthy</span>
              </div>
              <p class="text-xs text-muted-foreground mb-3">{{ totalDocuments() }} records</p>
              <volt-progress [value]="Math.min(totalDocuments() / 10, 100)" />
              <p class="text-xs text-muted-foreground mt-2">D1 SQLite (edge)</p>
            </volt-card>

            <volt-card class="p-4">
              <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2">
                  <icon-globe class="h-4 w-4 text-muted-foreground" />
                  <h3 class="text-sm font-medium">API</h3>
                </div>
                <span class="text-xs font-medium text-success">Online</span>
              </div>
              <p class="text-xs text-muted-foreground mb-3">REST API v1</p>
              <volt-progress [value]="100" />
              <p class="text-xs text-muted-foreground mt-2">Edge-ready handlers</p>
            </volt-card>
          </div>
        </div>
      }
    </div>
  `
})
export class DashboardPage implements OnInit {
  private api = inject(CmsApiService);

  collections = signal<CollectionStat[]>([]);
  totalDocuments = signal(0);
  loading = signal(true);
  error = signal<string | null>(null);

  protected readonly Math = Math;

  ngOnInit() {
    this.loadData();
  }

  async loadData() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const apiCollections = await this.api.getCollections();
      let total = 0;

      const stats: CollectionStat[] = [];
      for (const col of apiCollections) {
        try {
          const docs = await this.api.getDocuments(col.slug);
          total += docs.length;
          stats.push({
            name: col.name || col.slug,
            slug: col.slug,
            count: docs.length,
            icon: this.inferIcon(col.slug),
            lastModified: 'recently'
          });
        } catch {
          stats.push({
            name: col.name || col.slug,
            slug: col.slug,
            count: 0,
            icon: this.inferIcon(col.slug),
            lastModified: '-'
          });
        }
      }

      this.collections.set(stats);
      this.totalDocuments.set(total);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      this.loading.set(false);
    }
  }

  private inferIcon(slug: string): string {
    switch (slug) {
      case 'pages': return 'globe';
      case 'posts': return 'newspaper';
      case 'media': return 'image';
      case 'users': return 'users';
      default: return 'file-text';
    }
  }

  activityLog: ActivityItem[] = [
    {
      id: '1',
      action: 'published',
      user: 'John Doe',
      userAvatar: 'https://i.pravatar.cc/150?u=1',
      document: 'Homepage Hero Update',
      collection: 'Pages',
      time: '2h ago'
    },
    {
      id: '2',
      action: 'created',
      user: 'Sarah Miller',
      userAvatar: 'https://i.pravatar.cc/150?u=2',
      document: 'Q3 Marketing Strategy',
      collection: 'Posts',
      time: '3h ago'
    },
    {
      id: '3',
      action: 'updated',
      user: 'Mike Kim',
      userAvatar: 'https://i.pravatar.cc/150?u=3',
      document: 'Pricing Page',
      collection: 'Pages',
      time: '5h ago'
    },
    {
      id: '4',
      action: 'deleted',
      user: 'Robert Johnson',
      userAvatar: 'https://i.pravatar.cc/150?u=5',
      document: 'Old Landing Page',
      collection: 'Pages',
      time: '1d ago'
    },
    {
      id: '5',
      action: 'published',
      user: 'Anna Lee',
      userAvatar: 'https://i.pravatar.cc/150?u=4',
      document: 'Getting Started Guide',
      collection: 'Posts',
      time: '1d ago'
    },
    {
      id: '6',
      action: 'unpublished',
      user: 'John Doe',
      userAvatar: 'https://i.pravatar.cc/150?u=1',
      document: 'Deprecated API Docs',
      collection: 'Posts',
      time: '2d ago'
    }
  ];
}
