import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CmsApiService, type CollectionMeta } from '@forge-cms/angular';
import { ErrorStateComponent, LoadingStateComponent, PageHeaderComponent } from '@forge-cms/admin';

@Component({
  selector: 'lumea-admin-collections',
  standalone: true,
  imports: [RouterLink, PageHeaderComponent, LoadingStateComponent, ErrorStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <forge-page-header
        title="Collections"
        subtitle="Everything the clinic publishes, defined in src/server/api/collections.ts."
      />

      @if (loading()) {
        <forge-loading-state variant="stat-grid" />
      } @else if (error(); as message) {
        <forge-error-state
          title="Unable to load collections"
          [message]="message"
          (retry)="load()"
        />
      } @else {
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          @for (collection of collections(); track collection.slug) {
            <a
              [routerLink]="['/admin/collections', collection.slug]"
              class="rounded-xl border border-border bg-card p-5 transition-shadow hover:shadow-md"
            >
              <p class="text-sm font-medium">{{ collection.name }}</p>
              <p class="mt-1 text-xs text-muted-foreground">{{ collection.slug }}</p>
              <p class="mt-3 text-xs text-muted-foreground">
                {{ collection.fieldDefinitions.length }} fields
              </p>
            </a>
          }
        </div>
      }
    </div>
  `
})
export class AdminCollectionsPage implements OnInit {
  private readonly api = inject(CmsApiService);

  protected readonly collections = signal<CollectionMeta[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.collections.set(await this.api.getCollections());
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load collections');
    } finally {
      this.loading.set(false);
    }
  }
}
