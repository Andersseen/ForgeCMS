import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PageHeaderComponent } from '@forge-cms/admin';
import { CmsApiService } from '@forge-cms/angular';

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

      <div class="rounded-xl border border-border bg-card">
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
    </div>
  `
})
export class AdminDashboardPage implements OnInit {
  private readonly api = inject(CmsApiService);

  protected readonly bookings = signal<BookingRow[]>([]);
  protected readonly serviceCount = signal(0);
  protected readonly draftCount = signal(0);
  protected readonly postCount = signal(0);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly stats = computed(() => [
    {
      label: 'Pending bookings',
      value: this.bookings().filter((booking) => booking.status === 'pending').length
    },
    { label: 'Treatments live', value: this.serviceCount() },
    { label: 'Drafts waiting', value: this.draftCount() },
    { label: 'Journal entries', value: this.postCount() }
  ]);

  ngOnInit(): void {
    void this.load();
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
}
