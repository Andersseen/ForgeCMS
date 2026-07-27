import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { PageHeaderComponent } from '@forge-cms/admin';

interface AdapterStatus {
  database: string;
  auth: string;
  storage: string;
  collections: Record<string, number>;
}

interface EndpointGroup {
  title: string;
  note: string;
  endpoints: { method: string; path: string; description: string }[];
}

@Component({
  selector: 'lumea-admin-api',
  standalone: true,
  imports: [PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <forge-page-header
        title="API"
        subtitle="What this deployment exposes, and which adapters answered the last request."
      />

      @if (status(); as info) {
        <div class="grid gap-4 sm:grid-cols-3">
          <div class="rounded-xl border border-border bg-card p-5">
            <p class="text-xs text-muted-foreground">Database adapter</p>
            <p class="mt-1 font-medium">{{ info.database }}</p>
          </div>
          <div class="rounded-xl border border-border bg-card p-5">
            <p class="text-xs text-muted-foreground">Auth adapter</p>
            <p class="mt-1 font-medium">{{ info.auth }}</p>
          </div>
          <div class="rounded-xl border border-border bg-card p-5">
            <p class="text-xs text-muted-foreground">Storage adapter</p>
            <p class="mt-1 font-medium">{{ info.storage }}</p>
          </div>
        </div>
      }

      @for (group of groups; track group.title) {
        <div class="rounded-xl border border-border bg-card">
          <div class="border-b border-border px-5 py-4">
            <h2 class="text-sm font-medium">{{ group.title }}</h2>
            <p class="mt-1 text-xs text-muted-foreground">{{ group.note }}</p>
          </div>
          <ul class="divide-y divide-border">
            @for (endpoint of group.endpoints; track endpoint.path + endpoint.method) {
              <li class="flex flex-wrap items-baseline gap-3 px-5 py-3">
                <span class="w-14 shrink-0 font-mono text-xs uppercase text-muted-foreground">
                  {{ endpoint.method }}
                </span>
                <span class="font-mono text-sm">{{ endpoint.path }}</span>
                <span class="text-xs text-muted-foreground">{{ endpoint.description }}</span>
              </li>
            }
          </ul>
        </div>
      }
    </div>
  `
})
export class AdminApiPage implements OnInit {
  protected readonly status = signal<AdapterStatus | null>(null);

  protected readonly groups: EndpointGroup[] = [
    {
      title: 'Site endpoints (Local API)',
      note: 'Purpose-built payloads composed on the server with no HTTP hop into the CMS.',
      endpoints: [
        {
          method: 'GET',
          path: '/api/site/home',
          description: 'Blocks + featured treatments + reviews + offer'
        },
        {
          method: 'GET',
          path: '/api/site/services',
          description: 'The treatment menu and its categories'
        },
        {
          method: 'GET',
          path: '/api/site/services/:slug',
          description: 'One treatment, related ones, specialists'
        },
        { method: 'GET', path: '/api/site/team', description: 'Active staff with photos' },
        { method: 'GET', path: '/api/site/journal', description: 'Published journal entries' },
        {
          method: 'GET',
          path: '/api/site/settings',
          description: 'Clinic details and opening hours'
        },
        { method: 'POST', path: '/api/site/bookings', description: 'Public appointment request' }
      ]
    },
    {
      title: 'Generic CRUD (@forge-cms/runtime handlers)',
      note: 'The same handlers apps/www uses. Writes require an admin or editor token.',
      endpoints: [
        {
          method: 'GET',
          path: '/api/v1/:collection',
          description: 'where / sort / limit / depth / status'
        },
        {
          method: 'POST',
          path: '/api/v1/:collection',
          description: 'Create (JSON, or multipart on media)'
        },
        { method: 'GET', path: '/api/v1/:collection/:id', description: 'Read one' },
        { method: 'PUT', path: '/api/v1/:collection/:id', description: 'Partial update' },
        { method: 'DELETE', path: '/api/v1/:collection/:id', description: 'Delete' },
        {
          method: 'GET',
          path: '/api/v1/collections',
          description: 'Schema metadata for the admin form'
        }
      ]
    },
    {
      title: 'Auth',
      note: 'Signed tokens over the users collection.',
      endpoints: [
        { method: 'POST', path: '/api/auth/login', description: 'email + password → token' },
        { method: 'GET', path: '/api/auth/me', description: 'The current user' },
        { method: 'GET', path: '/api/auth/users', description: 'List users (admin only)' }
      ]
    }
  ];

  ngOnInit(): void {
    // `/api/status` is this app's own endpoint, not part of the CMS surface, so it stays a fetch.
    void fetch('/api/status')
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { data: AdapterStatus } | null) => this.status.set(body?.data ?? null))
      .catch(() => this.status.set(null));
  }
}
