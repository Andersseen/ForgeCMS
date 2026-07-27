import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  ApiAuthError,
  ApiValidationError,
  CmsApiService,
  canWriteContent,
  type AuthUser,
  type CollectionMeta,
  type ListMeta
} from '@forge-cms/angular';
import {
  ErrorStateComponent,
  ForgeCollectionFormComponent,
  ForgeCollectionListComponent,
  LoadingStateComponent,
  type SortRequest,
  type StatusChangeRequest
} from '@forge-cms/admin';

const PAGE_SIZE = 20;

/**
 * The editor screen, built entirely from `@forge-cms/admin`'s components and `CmsApiService`.
 *
 * Everything this page needs from the API — drafts included, sorted, paginated, with relations and
 * uploads populated — goes through the client now (spec 041). It used to need an app-local service
 * with hand-built query strings.
 */
@Component({
  selector: 'lumea-admin-collection-detail',
  standalone: true,
  imports: [
    RouterLink,
    LoadingStateComponent,
    ErrorStateComponent,
    ForgeCollectionListComponent,
    ForgeCollectionFormComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <a routerLink="/admin/collections" class="text-sm text-muted-foreground hover:underline">
        ← Back to collections
      </a>

      @if (loading()) {
        <forge-loading-state variant="table" />
      } @else if (error(); as message) {
        <forge-error-state title="Unable to load collection" [message]="message" (retry)="load()" />
      } @else if (collection(); as meta) {
        <forge-collection-list
          [collection]="meta"
          [documents]="documents()"
          [meta]="pagination()"
          [sort]="sort()"
          [readOnly]="!canWrite()"
          (create)="openCreate()"
          (edit)="openEdit($event)"
          (delete)="removeDocument($event)"
          (sortChange)="changeSort($event)"
          (pageChange)="changePage($event)"
          (statusChange)="changeStatus($event)"
        />

        @if (showForm() && canWrite()) {
          <forge-collection-form
            [fields]="meta.fieldDefinitions"
            [initialValue]="editing() ?? {}"
            [fieldErrors]="fieldErrors()"
            [submitLabel]="editing() ? 'Save' : 'Create'"
            (save)="save($event)"
            (cancel)="closeForm()"
          />
        }
      }
    </div>
  `
})
export class AdminCollectionDetailPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly cms = inject(CmsApiService);

  protected readonly collection = signal<CollectionMeta | null>(null);
  protected readonly documents = signal<Record<string, unknown>[]>([]);
  protected readonly pagination = signal<ListMeta | null>(null);
  protected readonly sort = signal<SortRequest | null>(null);
  protected readonly page = signal(1);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly currentUser = signal<AuthUser | null>(null);
  protected readonly canWrite = computed(() => canWriteContent(this.currentUser()));

  protected readonly showForm = signal(false);
  protected readonly editing = signal<Record<string, unknown> | null>(null);
  protected readonly fieldErrors = signal<Record<string, string>>({});

  ngOnInit(): void {
    void this.loadUser();
    void this.load();
  }

  private async loadUser(): Promise<void> {
    try {
      this.currentUser.set(await this.cms.getCurrentUser());
    } catch {
      this.currentUser.set(null);
    }
  }

  protected async load(): Promise<void> {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (!slug) {
      this.error.set('Missing collection slug');
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      const collections = await this.cms.getCollections();
      const meta = collections.find((entry) => entry.slug === slug);
      if (!meta) {
        this.error.set(`Collection '${slug}' not found`);
        return;
      }
      this.collection.set(meta);

      const sort = this.sort();
      const result = await this.cms.listDocuments(slug, {
        // Editors work on drafts; that is the whole reason they are here.
        status: 'all',
        depth: 1,
        limit: PAGE_SIZE,
        page: this.page(),
        ...(sort ? { sort: sort.field, order: sort.order } : {})
      });

      this.documents.set(result.docs);
      this.pagination.set(result.meta);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load collection');
    } finally {
      this.loading.set(false);
    }
  }

  protected changeSort(sort: SortRequest): void {
    this.sort.set(sort);
    this.page.set(1);
    void this.load();
  }

  protected changePage(page: number): void {
    this.page.set(page);
    void this.load();
  }

  protected async changeStatus(request: StatusChangeRequest): Promise<void> {
    const slug = this.collection()?.slug;
    if (!slug) return;

    try {
      await this.cms.updateDocument(slug, String(request.document['id']), {
        _status: request.status
      });
      await this.load();
    } catch (err) {
      this.reportWriteError(err);
    }
  }

  protected openCreate(): void {
    this.editing.set(null);
    this.fieldErrors.set({});
    this.showForm.set(true);
  }

  protected openEdit(document: Record<string, unknown>): void {
    this.editing.set(document);
    this.fieldErrors.set({});
    this.showForm.set(true);
  }

  protected closeForm(): void {
    this.showForm.set(false);
    this.editing.set(null);
    this.fieldErrors.set({});
  }

  protected async save(value: Record<string, unknown>): Promise<void> {
    const slug = this.collection()?.slug;
    if (!slug) return;

    try {
      const editing = this.editing();
      if (editing) {
        await this.cms.updateDocument(slug, String(editing['id']), value);
      } else {
        await this.cms.createDocument(slug, value);
      }
      this.closeForm();
      await this.load();
    } catch (err) {
      if (err instanceof ApiValidationError) {
        const errors: Record<string, string> = {};
        for (const detail of err.details) errors[detail.field] = detail.message;
        this.fieldErrors.set(errors);
        return;
      }
      this.reportWriteError(err);
    }
  }

  protected async removeDocument(document: Record<string, unknown>): Promise<void> {
    const slug = this.collection()?.slug;
    if (!slug) return;
    if (!window.confirm('Delete this document? This cannot be undone.')) return;

    try {
      await this.cms.deleteDocument(slug, String(document['id']));
      await this.load();
    } catch (err) {
      this.reportWriteError(err);
    }
  }

  private reportWriteError(err: unknown): void {
    if (err instanceof ApiAuthError) {
      void this.router.navigate(['/login']);
      return;
    }
    window.alert(err instanceof Error ? err.message : 'The change could not be saved');
  }
}
