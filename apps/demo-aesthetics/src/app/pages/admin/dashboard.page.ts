import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PageHeaderComponent, describeAdminError } from '@forge-cms/admin';
import { VoltNativeButton } from '@voltui/components';
import { DemoNoticeComponent } from '../../components/demo-notice.component';
import { ForgeAnalyticsApiService, injectForgeClient } from '@forge-cms/angular';
import type { AnalyticsSummaryResponse } from '@forge-cms/angular';
import type { DemoDocument, DemoSchema } from '../../forge-schema';

@Component({
  selector: 'lumea-admin-dashboard',
  standalone: true,
  imports: [RouterLink, DatePipe, PageHeaderComponent, VoltNativeButton, DemoNoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <forge-page-header
        title="Clinic overview"
        subtitle="Bookings waiting on a reply, what is live on the site, and who is visiting."
      />

      <lumea-demo-notice />

      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        @for (stat of stats(); track stat.label) {
          <a
            [routerLink]="stat.link"
            class="group rounded-xl border border-border bg-card p-5 outline-none transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p class="text-sm text-muted-foreground">{{ stat.label }}</p>
            <p class="mt-2 text-2xl font-semibold">
              @if (loading()) {
                <span class="text-muted-foreground" aria-label="Loading">–</span>
              } @else {
                {{ stat.value }}
              }
            </p>
            <p class="mt-1 text-xs text-muted-foreground group-hover:underline">
              {{ stat.hint }}
            </p>
          </a>
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
            <div class="px-5 py-6 text-sm" role="alert">
              <p class="text-destructive">{{ message }}</p>
              <button
                type="button"
                voltButton
                variant="link"
                size="sm"
                class="mt-2"
                (click)="retry()"
              >
                Try again
              </button>
            </div>
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
                <li class="px-5 py-6 text-sm text-muted-foreground">
                  No bookings yet. New requests from the booking form appear here as pending.
                </li>
              }
            </ul>
          }
        </div>

        <div class="rounded-xl border border-border bg-card">
          <div class="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
            <h2 class="text-sm font-medium">
              Site traffic
              <span class="ml-1 rounded-full border border-border px-2 py-0.5 text-[0.65rem]"
                >Experimental</span
              >
            </h2>
            <a routerLink="/admin/analytics" class="text-sm text-muted-foreground hover:underline">
              View analytics →
            </a>
          </div>

          <div class="px-5 py-4" aria-live="polite">
            @if (analyticsLoading()) {
              <p class="text-sm text-muted-foreground">Loading…</p>
            } @else if (analyticsError(); as message) {
              <div role="alert" class="text-sm">
                <p class="text-destructive">{{ message }}</p>
                <button
                  type="button"
                  voltButton
                  variant="link"
                  size="sm"
                  class="mt-2"
                  (click)="retryAnalytics()"
                >
                  Try again
                </button>
              </div>
            } @else if (analytics(); as summary) {
              @if (!summary.configured) {
                <p class="text-sm text-muted-foreground" data-analytics-state="unconfigured">
                  Traffic reporting is not switched on for this site yet. Once the Cloudflare
                  Analytics Engine binding and read token are set, visits appear here.
                </p>
              } @else if ((summary.totals?.pageviews ?? 0) === 0) {
                <p class="text-sm text-muted-foreground" data-analytics-state="empty">
                  No visits recorded in the last 7 days.
                </p>
              } @else {
                <p class="text-xs text-muted-foreground">Pageviews, last 7 days</p>
                <p class="mt-2 text-2xl font-semibold" data-analytics-state="traffic">
                  {{ summary.totals?.pageviews ?? 0 }}
                </p>
                @if (analyticsChangeLabel(); as change) {
                  <p class="mt-1 text-xs text-muted-foreground">{{ change }}</p>
                }
              }
            }
          </div>
        </div>
      </div>

      <section aria-labelledby="quick-links-title" class="rounded-xl border border-border bg-card">
        <h2 id="quick-links-title" class="border-b border-border px-5 py-4 text-sm font-medium">
          Quick links
        </h2>
        <ul class="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
          @for (link of quickLinks; track link.path) {
            <li class="bg-card">
              <a
                [routerLink]="link.path"
                class="block px-5 py-4 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span class="font-medium">{{ link.label }}</span>
                <span class="mt-0.5 block text-xs text-muted-foreground">{{ link.hint }}</span>
              </a>
            </li>
          }
        </ul>
      </section>
    </div>
  `
})
export class AdminDashboardPage implements OnInit {
  // Typed by the content model (spec 076): slugs, `where`/`sort` fields and results are checked.
  private readonly api = injectForgeClient<DemoSchema>();
  private readonly analyticsApi = inject(ForgeAnalyticsApiService);

  protected readonly bookings = signal<DemoDocument<'bookings'>[]>([]);
  protected readonly serviceCount = signal(0);
  protected readonly draftCount = signal(0);
  protected readonly postCount = signal(0);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  // Forge Analytics (spec 057, experimental) — a compact peer of the booking inbox rather than a
  // stat tile. Four real states, none of them fabricated: loading, `configured: false` (no
  // CLOUDFLARE_ANALYTICS_TOKEN/CLOUDFLARE_ACCOUNT_ID on this deployment), configured with no
  // traffic yet, and traffic. A failed request offers a retry; it never shows a number.
  protected readonly analytics = signal<AnalyticsSummaryResponse | null>(null);
  protected readonly analyticsLoading = signal(true);
  protected readonly analyticsError = signal<string | null>(null);

  protected readonly stats = computed(() => [
    {
      label: 'Pending bookings',
      value: this.bookings().filter((booking) => booking.status === 'pending').length,
      hint: 'Waiting on a reply',
      link: '/admin/collections/bookings'
    },
    {
      label: 'Treatments live',
      value: this.serviceCount(),
      hint: 'On the public menu',
      link: '/admin/collections/services'
    },
    {
      label: 'Drafts waiting',
      value: this.draftCount(),
      hint: 'Treatments and journal posts',
      link: '/admin/collections/services'
    },
    {
      label: 'Journal posts',
      value: this.postCount(),
      hint: 'Published and drafts',
      link: '/admin/collections/posts'
    }
  ]);

  protected readonly quickLinks = [
    {
      label: 'Treatments',
      hint: 'Prices, benefits and publishing',
      path: '/admin/collections/services'
    },
    { label: 'Content', hint: 'Home page, team, journal, notices', path: '/admin/collections' },
    { label: 'Media', hint: 'Photos used across the site', path: '/admin/media' },
    { label: 'Clinic settings', hint: 'Phone, address, opening hours', path: '/admin/settings' }
  ] as const;

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

  protected retry(): void {
    this.error.set(null);
    this.loading.set(true);
    void this.load();
  }

  protected retryAnalytics(): void {
    this.analyticsError.set(null);
    this.analyticsLoading.set(true);
    void this.loadAnalytics();
  }

  private async load(): Promise<void> {
    try {
      const [bookings, services, posts] = await Promise.all([
        this.api.getDocuments('bookings', {
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
      this.error.set(describeAdminError(err));
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
      this.analyticsError.set(describeAdminError(err));
    } finally {
      this.analyticsLoading.set(false);
    }
  }
}
