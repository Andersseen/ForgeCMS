import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PageHeaderComponent } from '@forge-cms/admin';
import { CmsApiService, ForgeAnalyticsApiService } from '@forge-cms/angular';
import type { AnalyticsSummaryResponse } from '@forge-cms/angular';

interface BookingRow extends Record<string, unknown> {
  id: string;
  name: string;
  email: string;
  status: string;
  preferredDate: string;
}

@Component({
  selector: 'lumea-admin-dashboard',
  standalone: true,
  imports: [RouterLink, DatePipe, PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <forge-page-header
        title="Clinic overview"
        subtitle="Bookings waiting on a reply, and what is live on the site right now."
      />

      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        @for (stat of stats(); track stat.label) {
          <div class="rounded-xl border border-border bg-card p-5">
            <p class="text-sm text-muted-foreground">{{ stat.label }}</p>
            <p class="mt-2 text-2xl font-semibold">{{ stat.value }}</p>
          </div>
        }
      </div>

      <div class="grid gap-4 lg:grid-cols-3">
        <div class="rounded-xl border border-border bg-card lg:col-span-2">
          <div class="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 class="text-sm font-medium">Booking inbox</h2>
            <a
              routerLink="/admin/collections/bookings"
              class="text-sm text-muted-foreground hover:underline"
            >
              Manage all →
            </a>
          </div>

          @if (loading()) {
            <p class="px-5 py-6 text-sm text-muted-foreground">Loading…</p>
          } @else if (error(); as message) {
            <p class="px-5 py-6 text-sm text-destructive">{{ message }}</p>
          } @else {
            <ul class="divide-y divide-border">
              @for (booking of bookings(); track booking.id) {
                <li class="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <p class="text-sm font-medium">{{ booking.name }}</p>
                    <p class="text-xs text-muted-foreground">{{ booking.email }}</p>
                  </div>
                  <div class="flex items-center gap-4">
                    <span class="text-xs text-muted-foreground">
                      {{ booking.preferredDate | date: 'medium' }}
                    </span>
                    <span
                      class="rounded-full px-2.5 py-0.5 text-xs"
                      [class]="
                        booking.status === 'pending'
                          ? 'bg-amber-100 text-amber-900'
                          : 'bg-muted text-muted-foreground'
                      "
                    >
                      {{ booking.status }}
                    </span>
                  </div>
                </li>
              } @empty {
                <li class="px-5 py-6 text-sm text-muted-foreground">No bookings yet.</li>
              }
            </ul>
          }
        </div>

        <div class="rounded-xl border border-border bg-card">
          <div class="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 class="text-sm font-medium">Site traffic</h2>
            <a routerLink="/admin/analytics" class="text-sm text-muted-foreground hover:underline">
              View analytics →
            </a>
          </div>

          <div class="px-5 py-4">
            @if (analyticsLoading()) {
              <p class="text-sm text-muted-foreground">Loading…</p>
            } @else if (analyticsError(); as message) {
              <p class="text-sm text-destructive">{{ message }}</p>
            } @else if (analytics(); as summary) {
              @if (!summary.configured) {
                <p class="text-sm text-muted-foreground">
                  Not set up yet — configure a Cloudflare Analytics Engine binding to see traffic
                  here.
                </p>
              } @else {
                <p class="text-xs text-muted-foreground">Pageviews, last 7 days</p>
                <p class="mt-2 text-2xl font-semibold">{{ summary.totals?.pageviews ?? 0 }}</p>
                @if (analyticsChangeLabel(); as change) {
                  <p class="mt-1 text-xs text-muted-foreground">{{ change }}</p>
                }
              }
            }
          </div>
        </div>
      </div>
    </div>
  `
})
export class AdminDashboardPage implements OnInit {
  private readonly api = inject(CmsApiService);
  private readonly analyticsApi = inject(ForgeAnalyticsApiService);

  protected readonly bookings = signal<BookingRow[]>([]);
  protected readonly serviceCount = signal(0);
  protected readonly draftCount = signal(0);
  protected readonly postCount = signal(0);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  // Forge Analytics (spec 057, experimental) — a compact peer of the booking inbox rather than a
  // stat tile: `configured: false` (no CLOUDFLARE_ANALYTICS_TOKEN/CLOUDFLARE_ACCOUNT_ID secret set
  // on this deployment yet) and "no traffic yet" are both real, expected states, not errors.
  protected readonly analytics = signal<AnalyticsSummaryResponse | null>(null);
  protected readonly analyticsLoading = signal(true);
  protected readonly analyticsError = signal<string | null>(null);

  protected readonly stats = computed(() => [
    {
      label: 'Pending bookings',
      value: this.bookings().filter((booking) => booking.status === 'pending').length
    },
    { label: 'Treatments live', value: this.serviceCount() },
    { label: 'Drafts waiting', value: this.draftCount() },
    { label: 'Journal entries', value: this.postCount() }
  ]);

  protected readonly analyticsChangeLabel = computed(() => {
    const pct = this.analytics()?.totals?.changePct;
    if (pct === null || pct === undefined) return null;
    const direction = pct >= 0 ? '+' : '';
    return `${direction}${pct}% vs. previous 7 days`;
  });

  ngOnInit(): void {
    void this.load();
    void this.loadAnalytics();
  }

  private async load(): Promise<void> {
    try {
      const [bookings, services, posts] = await Promise.all([
        this.api.getDocuments<BookingRow>('bookings', {
          where: { status: { ne: 'cancelled' } },
          sort: 'preferredDate',
          order: 'asc',
          limit: 8
        }),
        this.api.getDocuments('services', { status: 'all', limit: 100 }),
        this.api.getDocuments('posts', { status: 'all', limit: 100 })
      ]);

      this.bookings.set(bookings);
      this.serviceCount.set(services.filter((doc) => doc._status === 'published').length);
      this.draftCount.set([...services, ...posts].filter((doc) => doc._status === 'draft').length);
      this.postCount.set(posts.length);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load the dashboard');
    } finally {
      this.loading.set(false);
    }
  }

  // Kept independent of `load()` — a failure or slow response here should never hold up (or fail)
  // the booking inbox, which is the actually load-bearing part of this page.
  private async loadAnalytics(): Promise<void> {
    try {
      this.analytics.set(await this.analyticsApi.getSummary('7d'));
    } catch (err) {
      this.analyticsError.set(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      this.analyticsLoading.set(false);
    }
  }
}
