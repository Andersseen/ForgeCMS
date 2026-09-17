import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { ForgeAnalyticsApiService } from '@forge-cms/angular';
import type { AnalyticsRange, AnalyticsSummaryResponse } from '@forge-cms/angular';
import { VoltCard } from '@voltui/components';
import { LoadingStateComponent } from './loading-state.component.js';
import { ErrorStateComponent } from './error-state.component.js';
import { EmptyStateComponent } from './empty-state.component.js';
import { PageHeaderComponent } from './page-header.component.js';
import { describeAdminError } from './admin-error.js';

const RANGE_LABELS: Record<AnalyticsRange, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days'
};

const BAR_SLOT_WIDTH = 10;

interface ChartBar {
  x: number;
  y: number;
  height: number;
  bucket: string;
  pageviews: number;
}

/**
 * Experimental, opt-in analytics screen (spec 057). Not routed by default — a host mounts it via
 * {@link forgeAdminAnalyticsRoutes}. Data isn't a `CollectionMeta`/document, so this follows the same
 * manual loading/error/data-signal shape as `ForgeCollectionsIndexComponent` rather than
 * `collectionResource`/`documentResource`.
 */
@Component({
  selector: 'forge-analytics-dashboard',
  standalone: true,
  imports: [
    VoltCard,
    LoadingStateComponent,
    ErrorStateComponent,
    EmptyStateComponent,
    PageHeaderComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <forge-page-header title="Analytics" subtitle="Pageviews for your public pages.">
        <select
          actions
          class="h-9 rounded-md border border-border bg-background px-3 text-sm"
          aria-label="Date range"
          [value]="range()"
          (change)="onRangeChange($event)"
        >
          @for (option of rangeOptions; track option) {
            <option [value]="option">{{ rangeLabels[option] }}</option>
          }
        </select>
      </forge-page-header>

      @if (loading()) {
        <forge-loading-state variant="stat-grid" />
      } @else if (error(); as message) {
        <forge-error-state title="Couldn't load analytics" [message]="message" (retry)="load()" />
      } @else if (data(); as summary) {
        @if (!summary.configured) {
          <forge-empty-state
            title="Analytics isn't set up yet"
            message="Configure a Cloudflare Analytics Engine binding for this deployment to start seeing traffic here."
          />
        } @else if ((summary.totals?.pageviews ?? 0) === 0) {
          <forge-empty-state
            title="No traffic yet"
            message="Analytics starts collecting as soon as the site receives visits."
          />
        } @else {
          <volt-card class="p-4">
            <p class="text-xs text-muted-foreground">Pageviews</p>
            <p class="text-3xl font-bold tracking-tight mt-1">{{ summary.totals?.pageviews }}</p>
            @if (changeLabel(); as change) {
              <p class="text-xs text-muted-foreground mt-1">{{ change }}</p>
            }

            <svg
              class="w-full h-24 mt-4"
              [attr.viewBox]="'0 0 ' + chartWidth() + ' 100'"
              preserveAspectRatio="none"
              role="img"
              [attr.aria-label]="'Pageviews per period, ' + summary.totals?.pageviews + ' total'"
            >
              @for (bar of chartBars(); track bar.bucket) {
                <rect
                  [attr.x]="bar.x"
                  [attr.y]="bar.y"
                  [attr.width]="barWidth"
                  [attr.height]="bar.height"
                  class="fill-primary"
                >
                  <title>{{ bar.bucket }}: {{ bar.pageviews }}</title>
                </rect>
              }
            </svg>
          </volt-card>

          <div class="grid gap-4 md:grid-cols-2">
            <volt-card class="p-4">
              <h2 class="text-sm font-medium mb-3">Top pages</h2>
              <ul class="space-y-2 text-sm">
                @for (row of summary.topPages ?? []; track row.path) {
                  <li class="flex items-center justify-between gap-4">
                    <span class="truncate text-muted-foreground">{{ row.path }}</span>
                    <span class="font-medium">{{ row.pageviews }}</span>
                  </li>
                }
              </ul>
            </volt-card>

            <volt-card class="p-4">
              <h2 class="text-sm font-medium mb-3">Referrers</h2>
              <ul class="space-y-2 text-sm">
                @for (row of summary.referrers ?? []; track row.host) {
                  <li class="flex items-center justify-between gap-4">
                    <span class="truncate text-muted-foreground">{{ row.host }}</span>
                    <span class="font-medium">{{ row.pageviews }}</span>
                  </li>
                }
              </ul>
            </volt-card>

            <volt-card class="p-4">
              <h2 class="text-sm font-medium mb-3">Countries</h2>
              <ul class="space-y-2 text-sm">
                @for (row of summary.countries ?? []; track row.country) {
                  <li class="flex items-center justify-between gap-4">
                    <span class="truncate text-muted-foreground">{{ row.country }}</span>
                    <span class="font-medium">{{ row.pageviews }}</span>
                  </li>
                }
              </ul>
            </volt-card>
          </div>
        }
      }
    </div>
  `
})
export class ForgeAnalyticsDashboardComponent implements OnInit {
  private readonly api = inject(ForgeAnalyticsApiService);

  protected readonly rangeOptions: AnalyticsRange[] = ['24h', '7d', '30d', '90d'];
  protected readonly rangeLabels = RANGE_LABELS;
  protected readonly barWidth = BAR_SLOT_WIDTH * 0.7;

  protected readonly range = signal<AnalyticsRange>('7d');
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly data = signal<AnalyticsSummaryResponse | null>(null);

  protected readonly chartBars = computed<ChartBar[]>(() => {
    const timeline = this.data()?.timeline ?? [];
    const max = Math.max(1, ...timeline.map((point) => point.pageviews));
    return timeline.map((point, index) => {
      const height = (point.pageviews / max) * 100;
      return { x: index * BAR_SLOT_WIDTH, y: 100 - height, height, ...point };
    });
  });

  protected readonly chartWidth = computed(() =>
    Math.max(BAR_SLOT_WIDTH, this.chartBars().length * BAR_SLOT_WIDTH)
  );

  protected readonly changeLabel = computed(() => {
    const pct = this.data()?.totals?.changePct;
    if (pct === null || pct === undefined) return null;
    const direction = pct >= 0 ? '+' : '';
    return `${direction}${pct}% vs. previous period`;
  });

  ngOnInit(): void {
    void this.load();
  }

  protected onRangeChange(event: Event): void {
    this.range.set((event.target as HTMLSelectElement).value as AnalyticsRange);
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const summary = await this.api.getSummary(this.range());
      this.data.set(summary);
    } catch (err) {
      this.error.set(describeAdminError(err));
    } finally {
      this.loading.set(false);
    }
  }
}
