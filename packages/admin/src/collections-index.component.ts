import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CmsApiService } from '@forge-cms/angular';
import type { CollectionMeta } from '@forge-cms/angular';
import { VoltCard } from '@voltui/components';
import { LoadingStateComponent } from './loading-state.component.js';
import { ErrorStateComponent } from './error-state.component.js';
import { EmptyStateComponent } from './empty-state.component.js';
import { visibleCollections } from './content-query.js';
import { describeAdminError } from './admin-error.js';
import type { ForgeAdminConfig } from './config.js';

interface CollectionCard {
  meta: CollectionMeta;
  count: number | null;
}

/**
 * The "Content" home: every collection a host exposes, with a live document count and a link into
 * its workspace — so a consumer never hand-writes one nav entry/page per collection (spec 052 §7).
 */
@Component({
  selector: 'forge-collections-index',
  standalone: true,
  imports: [RouterLink, VoltCard, LoadingStateComponent, ErrorStateComponent, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">Content</h1>
        <p class="text-sm text-muted-foreground mt-1">Collections available to manage.</p>
      </div>

      @if (loading()) {
        <forge-loading-state variant="stat-grid" />
      } @else if (error(); as message) {
        <forge-error-state title="Couldn't load collections" [message]="message" (retry)="load()" />
      } @else if (cards().length === 0) {
        <forge-empty-state
          title="No collections"
          message="No collections are configured for this admin."
        />
      } @else {
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          @for (card of cards(); track card.meta.slug) {
            <a [routerLink]="['./', card.meta.slug]" class="block">
              <volt-card class="p-4 h-full hover:border-primary/50 transition-colors">
                <h2 class="font-semibold">{{ card.meta.name }}</h2>
                @if (card.meta.description) {
                  <p class="text-xs text-muted-foreground mt-1">{{ card.meta.description }}</p>
                }
                <p class="text-sm text-muted-foreground mt-3">
                  {{ card.count === null ? '—' : card.count }}
                  {{ card.count === 1 ? 'document' : 'documents' }}
                </p>
              </volt-card>
            </a>
          }
        </div>
      }
    </div>
  `
})
export class ForgeCollectionsIndexComponent implements OnInit {
  private readonly api = inject(CmsApiService);

  config = input<ForgeAdminConfig | null>(null);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly cards = signal<CollectionCard[]>([]);

  ngOnInit(): void {
    void this.load();
  }

  /** Latest-wins: a slow earlier load (a Retry clicked twice) cannot replace a newer result. */
  private loadToken = 0;
  private loadAbort: AbortController | null = null;

  protected async load(): Promise<void> {
    const token = ++this.loadToken;
    this.loadAbort?.abort();
    const abort = new AbortController();
    this.loadAbort = abort;

    this.loading.set(true);
    this.error.set(null);

    try {
      const all = await this.api.getCollections({ signal: abort.signal });
      if (token !== this.loadToken) return;
      const visible = visibleCollections(all, this.config());

      const cards = await Promise.all(
        visible.map(async (meta): Promise<CollectionCard> => {
          try {
            const { meta: listMeta } = await this.api.listDocuments(
              meta.slug,
              { limit: 1 },
              { signal: abort.signal }
            );
            return { meta, count: listMeta.totalDocs };
          } catch {
            // A count that fails to load costs a "—", not the whole index.
            return { meta, count: null };
          }
        })
      );
      if (token !== this.loadToken) return;
      this.cards.set(cards);
    } catch (err) {
      if (token !== this.loadToken) return;
      this.error.set(describeAdminError(err));
    } finally {
      if (token === this.loadToken) this.loading.set(false);
    }
  }
}
