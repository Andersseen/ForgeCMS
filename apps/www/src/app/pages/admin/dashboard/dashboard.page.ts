import { ChangeDetectionStrategy, Component, signal, inject } from '@angular/core';
import type { OnInit } from '@angular/core';
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
import { CmsApiService } from '@forge-cms/angular';
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

interface CollectionStat {
  name: string;
  slug: string;
  count: number;
  icon: string;
  lastModified: string;
}

interface SystemStatus {
  database: { name: string; records: number };
  auth: { name: string; configured: boolean };
  storage: { name: string; files: number };
  api: { version: string; status: string };
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

        <!-- Activity Log -->
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold">Recent Activity</h2>
          </div>
          <volt-card class="p-6">
            <p class="text-sm text-muted-foreground text-center py-8">
              Activity tracking is not yet implemented.
            </p>
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
                <span class="text-xs font-medium" [class.text-success]="status()?.storage?.name === 'r2'" [class.text-warning]="status()?.storage?.name !== 'r2'">
                  {{ status()?.storage?.name === 'r2' ? 'Healthy' : 'Not configured' }}
                </span>
              </div>
              <p class="text-xs text-muted-foreground mb-3">{{ status()?.storage?.name ?? '—' }}</p>
              <volt-progress [value]="0" />
              <p class="text-xs text-muted-foreground mt-2">{{ status()?.storage?.files ?? 0 }} files</p>
            </volt-card>

            <volt-card class="p-4">
              <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2">
                  <icon-database class="h-4 w-4 text-muted-foreground" />
                  <h3 class="text-sm font-medium">Database</h3>
                </div>
                <span class="text-xs font-medium text-success">Healthy</span>
              </div>
              <p class="text-xs text-muted-foreground mb-3">{{ status()?.database?.records ?? totalDocuments() }} records</p>
              <volt-progress [value]="Math.min((status()?.database?.records ?? totalDocuments()) / 10, 100)" />
              <p class="text-xs text-muted-foreground mt-2">{{ status()?.database?.name ?? 'in-memory' }}</p>
            </volt-card>

            <volt-card class="p-4">
              <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2">
                  <icon-globe class="h-4 w-4 text-muted-foreground" />
                  <h3 class="text-sm font-medium">API</h3>
                </div>
                <span class="text-xs font-medium text-success">{{ status()?.api?.status ?? 'Online' }}</span>
              </div>
              <p class="text-xs text-muted-foreground mb-3">REST API {{ status()?.api?.version ?? 'v1' }}</p>
              <volt-progress [value]="100" />
              <p class="text-xs text-muted-foreground mt-2">ForgeCMS runtime</p>
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
  status = signal<SystemStatus | null>(null);

  protected readonly Math = Math;

  async ngOnInit() {
    await this.loadData();
    await this.loadStatus();
  }

  async loadStatus() {
    try {
      const response = await fetch('/api/status');
      if (!response.ok) return;
      const result = (await response.json()) as { data: SystemStatus };
      this.status.set(result.data);
    } catch {
      // silently ignore status errors
    }
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

  activityLog: ActivityItem[] = []; // Activity tracking not yet implemented
}
