import { ChangeDetectionStrategy, Component, signal, inject } from '@angular/core';
import type { OnInit } from '@angular/core';
import { VoltBadge, VoltButton, VoltCard, VoltProgress } from '@voltui/components';
import {
  IconCheckCircle,
  IconClock,
  IconDatabase,
  IconEye,
  IconFileText,
  IconGlobe,
  IconHardDrive,
  IconImage,
  IconNewspaper,
  IconZap
} from '../../../components/icons';
import { CmsApiService } from '@forge-cms/angular';
import { RouterLink } from '@angular/router';
import {
  PageHeaderComponent,
  LoadingStateComponent,
  ErrorStateComponent,
  StatCardComponent,
  SectionHeaderComponent,
  CollectionIconComponent
} from '../components';

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
    VoltProgress,
    IconFileText,
    IconCheckCircle,
    IconNewspaper,
    IconImage,
    IconClock,
    IconEye,
    IconHardDrive,
    IconDatabase,
    IconGlobe,
    IconZap,
    PageHeaderComponent,
    LoadingStateComponent,
    ErrorStateComponent,
    StatCardComponent,
    SectionHeaderComponent,
    CollectionIconComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <forge-page-header
        title="Dashboard"
        subtitle="Welcome back. Here's what's happening with your CMS."
      >
        <div actions class="flex items-center gap-2">
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
      </forge-page-header>

      @if (loading()) {
        <forge-loading-state variant="stat-grid" />
      } @else if (error()) {
        <forge-error-state
          title="Failed to load dashboard data"
          [message]="error()"
          (retry)="loadData()"
        />
      } @else {
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <forge-stat-card
            [value]="totalDocuments()"
            label="Total Documents"
            sublabel="across {{ collections().length }} collections"
            color="primary"
          >
            <icon-file-text icon class="h-5 w-5" />
          </forge-stat-card>
          <forge-stat-card
            [value]="totalDocuments()"
            label="Published"
            sublabel="100% of total"
            color="success"
          >
            <icon-check-circle icon class="h-5 w-5" />
          </forge-stat-card>
          <forge-stat-card
            [value]="collections().length"
            label="Collections"
            sublabel="configured"
            color="warning"
          >
            <icon-newspaper icon class="h-5 w-5" />
          </forge-stat-card>
          <forge-stat-card [value]="0" label="Media Files" sublabel="via Storage" color="info">
            <icon-image icon class="h-5 w-5" />
          </forge-stat-card>
        </div>

        <div class="grid gap-6 lg:grid-cols-3">
          <div class="lg:col-span-2 space-y-4">
            <forge-section-header title="Collections">
              <a actions routerLink="/admin/collections">
                <volt-button variant="ghost" size="sm">View All</volt-button>
              </a>
            </forge-section-header>
            <div class="grid gap-3 md:grid-cols-2">
              @for (col of collections(); track col.slug) {
                <a [routerLink]="['/admin/collections', col.slug]">
                  <volt-card class="p-4 hover:border-primary/50 transition-all cursor-pointer group">
                    <div class="flex items-start justify-between">
                      <div class="flex items-center gap-3">
                        <div
                          class="h-9 w-9 rounded-lg bg-muted flex items-center justify-center text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors"
                        >
                          <forge-collection-icon [name]="col.icon" iconClass="h-4 w-4" />
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

          <div class="space-y-4">
            <forge-section-header title="Pending Review">
              <volt-badge actions variant="secondary">0</volt-badge>
            </forge-section-header>
            <div class="space-y-3">
              <p class="text-sm text-muted-foreground text-center py-8">No pending drafts</p>
            </div>
            <volt-button variant="outline" size="sm" class="w-full">View All Drafts</volt-button>
          </div>
        </div>

        <div class="space-y-4">
          <forge-section-header title="Recent Activity" />
          <volt-card class="p-6">
            <p class="text-sm text-muted-foreground text-center py-8">
              Activity tracking is not yet implemented.
            </p>
          </volt-card>
        </div>

        <div class="space-y-4">
          <forge-section-header title="System Health" />
          <div class="grid gap-4 md:grid-cols-3">
            <volt-card class="p-4">
              <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2">
                  <icon-hard-drive class="h-4 w-4 text-muted-foreground" />
                  <h3 class="text-sm font-medium">Storage</h3>
                </div>
                <span class="text-xs font-medium"
                  [class.text-success]="status()?.storage?.name === 'r2'"
                  [class.text-warning]="status()?.storage?.name !== 'r2'"
                >
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
              <p class="text-xs text-muted-foreground mb-3">
                {{ status()?.database?.records ?? totalDocuments() }} records
              </p>
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
}
