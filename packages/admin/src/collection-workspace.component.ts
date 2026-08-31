import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';
import { CmsApiService, canWriteContent, collectionResource } from '@forge-cms/angular';
import type { AuthUser, CollectionMeta } from '@forge-cms/angular';
import { VoltInput } from '@voltui/components';
import {
  ForgeCollectionListComponent,
  type SortRequest,
  type StatusChangeRequest
} from './collection-list.component.js';
import { ForgeConfirmDialogComponent } from './confirm-dialog.component.js';
import { LoadingStateComponent } from './loading-state.component.js';
import { ErrorStateComponent } from './error-state.component.js';
import { documentLabel, shortId } from './document-label.js';
import { buildListQuery, findSearchableField, pageAfterDelete } from './content-query.js';
import { debounce } from './debounce.js';
import { describeAdminError } from './admin-error.js';
import { ForgeContentRefresh } from './content-refresh.js';

type StatusFilter = 'all' | 'draft' | 'published';

const STATUS_OPTIONS: StatusFilter[] = ['all', 'published', 'draft'];
const STATUS_LABELS: Record<StatusFilter, string> = {
  all: 'All',
  published: 'Published',
  draft: 'Draft'
};

/**
 * Orchestrates one collection: loads its metadata and documents, owns search/sort/filter/pagination
 * query state, and drives create/edit navigation, delete confirmation, and publish/unpublish —
 * everything `apps/www`'s `collection-detail.page.ts` used to hand-roll (spec 052).
 *
 * The presentational `ForgeCollectionListComponent` stays untouched; this component only feeds it
 * data and reacts to its outputs. Create/edit render through the `<router-outlet>` below, as a
 * `ForgeDocumentEditorComponent` overlay on the child routes `forgeAdminContentRoutes()` wires up.
 */
@Component({
  selector: 'forge-collection-workspace',
  standalone: true,
  imports: [
    RouterOutlet,
    VoltInput,
    ForgeCollectionListComponent,
    ForgeConfirmDialogComponent,
    LoadingStateComponent,
    ErrorStateComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (metaLoading()) {
      <forge-loading-state variant="table" />
    } @else if (metaError(); as message) {
      <forge-error-state
        title="Couldn't load this collection"
        [message]="message"
        (retry)="loadMeta()"
      />
    } @else if (meta(); as collectionMeta) {
      <div class="space-y-4">
        <div class="flex flex-wrap items-center gap-3">
          @if (searchField()) {
            <volt-input
              type="text"
              [value]="searchTerm()"
              (valueChange)="onSearchInput($event)"
              placeholder="Search…"
              class="max-w-xs"
            />
          }
          @if (collectionMeta.drafts) {
            <div class="inline-flex rounded-md border border-border p-0.5 text-xs">
              @for (option of statusOptions; track option) {
                <button
                  type="button"
                  class="rounded px-2.5 py-1"
                  [class.bg-muted]="status() === option"
                  (click)="onStatusChange(option)"
                >
                  {{ statusLabels[option] }}
                </button>
              }
            </div>
          }
        </div>

        @if (actionError(); as message) {
          <p class="text-xs text-destructive">{{ message }}</p>
        }

        @if (documentsResource.error(); as error) {
          <forge-error-state
            title="Couldn't load documents"
            [message]="describeAdminError(error)"
            (retry)="documentsResource.reload()"
          />
        } @else if (documentsResource.isLoading() && !documentsResource.value()) {
          <forge-loading-state variant="table" />
        } @else {
          <forge-collection-list
            [collection]="collectionMeta"
            [documents]="documentsResource.value()?.docs ?? []"
            [readOnly]="readOnly()"
            [meta]="documentsResource.value()?.meta ?? null"
            [sort]="sort()"
            (create)="create()"
            (edit)="edit($event)"
            (delete)="requestDelete($event)"
            (sortChange)="onSortChange($event)"
            (pageChange)="onPageChange($event)"
            (statusChange)="onStatusToggle($event)"
          />
        }
      </div>
    }

    <forge-confirm-dialog
      [open]="deleteTarget() !== null"
      title="Delete this document?"
      [message]="deleteMessage()"
      (confirm)="confirmDelete()"
      (cancel)="cancelDelete()"
    />

    <router-outlet />
  `
})
export class ForgeCollectionWorkspaceComponent {
  private readonly api = inject(CmsApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly refresh = inject(ForgeContentRefresh, { optional: true });

  /** Overrides the `:collection` route param, for standalone embedding outside the route helper. */
  collection = input<string | undefined>(undefined);

  private readonly routeCollection = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('collection') ?? undefined)),
    { initialValue: undefined }
  );

  protected readonly collectionSlug = computed(() => this.collection() ?? this.routeCollection());

  protected readonly meta = signal<CollectionMeta | null>(null);
  protected readonly metaLoading = signal(true);
  protected readonly metaError = signal<string | null>(null);
  private metaToken = 0;

  protected readonly page = signal(1);
  protected readonly sort = signal<SortRequest | null>(null);
  protected readonly status = signal<StatusFilter>('all');
  protected readonly searchTerm = signal('');
  private readonly debouncedSearch = signal('');
  private readonly applyDebouncedSearch = debounce(
    (term: string) => this.debouncedSearch.set(term),
    300
  );

  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly statusLabels = STATUS_LABELS;

  protected readonly searchField = computed(() => {
    const collectionMeta = this.meta();
    return collectionMeta ? findSearchableField(collectionMeta) : null;
  });

  protected readonly documentsResource = collectionResource<Record<string, unknown>>(() => {
    const slug = this.collectionSlug();
    if (slug === undefined) return undefined;
    this.refresh?.version();

    return {
      collection: slug,
      ...buildListQuery({
        page: this.page(),
        sort: this.sort(),
        status: this.status(),
        search: this.debouncedSearch(),
        searchField: this.searchField(),
        hasDrafts: this.meta()?.drafts === true
      })
    };
  });

  protected readonly deleteTarget = signal<Record<string, unknown> | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly describeAdminError = describeAdminError;

  private readonly currentUser = signal<AuthUser | null>(null);
  /** Hides create/edit/delete/publish affordances for a viewer who cannot write anyway. */
  protected readonly readOnly = computed(() => !canWriteContent(this.currentUser()));

  protected readonly deleteMessage = computed(() => {
    const doc = this.deleteTarget();
    if (doc === null) return '';
    const id = String(doc['id'] ?? '');
    const label = documentLabel(doc, this.meta()?.useAsTitle);
    return label === shortId(id) || label === '—'
      ? 'This document will be permanently deleted. This action cannot be undone.'
      : `"${label}" will be permanently deleted. This action cannot be undone.`;
  });

  constructor() {
    effect(() => {
      const slug = this.collectionSlug();
      if (slug === undefined) return;
      void this.loadMeta();
    });
    void this.api.getCurrentUser().then((user) => this.currentUser.set(user));
  }

  protected async loadMeta(): Promise<void> {
    const slug = this.collectionSlug();
    if (slug === undefined) return;

    const token = ++this.metaToken;
    this.metaLoading.set(true);
    this.metaError.set(null);

    try {
      const all = await this.api.getCollections();
      if (token !== this.metaToken) return;
      const found = all.find((entry) => entry.slug === slug) ?? null;
      this.meta.set(found);
      if (found === null) this.metaError.set(`Collection "${slug}" was not found.`);
    } catch (err) {
      if (token !== this.metaToken) return;
      this.metaError.set(describeAdminError(err));
    } finally {
      if (token === this.metaToken) this.metaLoading.set(false);
    }
  }

  protected onSearchInput(term: string): void {
    this.searchTerm.set(term);
    this.page.set(1);
    this.applyDebouncedSearch(term);
  }

  protected onStatusChange(next: StatusFilter): void {
    this.status.set(next);
    this.page.set(1);
  }

  protected onSortChange(next: SortRequest): void {
    this.sort.set(next);
    this.page.set(1);
  }

  protected onPageChange(next: number): void {
    this.page.set(next);
  }

  protected create(): void {
    void this.router.navigate(['new'], { relativeTo: this.route });
  }

  protected edit(doc: Record<string, unknown>): void {
    void this.router.navigate([String(doc['id'])], { relativeTo: this.route });
  }

  protected requestDelete(doc: Record<string, unknown>): void {
    this.actionError.set(null);
    this.deleteTarget.set(doc);
  }

  protected cancelDelete(): void {
    this.deleteTarget.set(null);
  }

  protected async confirmDelete(): Promise<void> {
    const doc = this.deleteTarget();
    const slug = this.collectionSlug();
    if (doc === null || slug === undefined) return;
    this.deleteTarget.set(null);

    try {
      await this.api.deleteDocument(slug, String(doc['id']));
      const remainingOnPage = (this.documentsResource.value()?.docs.length ?? 1) - 1;
      this.page.set(pageAfterDelete(this.page(), remainingOnPage));
      this.documentsResource.reload();
    } catch (err) {
      this.actionError.set(describeAdminError(err));
    }
  }

  protected async onStatusToggle(request: StatusChangeRequest): Promise<void> {
    const slug = this.collectionSlug();
    if (slug === undefined) return;

    try {
      await this.api.setDocumentStatus(slug, String(request.document['id']), request.status);
      this.documentsResource.reload();
    } catch (err) {
      this.actionError.set(describeAdminError(err));
    }
  }
}
