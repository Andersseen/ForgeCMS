import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  ApiAuthError,
  ApiValidationError,
  CmsApiService,
  canWriteContent,
  type AuthUser,
  type CollectionMeta
} from '@forge-cms/angular';
import {
  ErrorStateComponent,
  ForgeCollectionFormComponent,
  ForgeCollectionListComponent,
  LoadingStateComponent
} from '@forge-cms/admin';
import { AdminApiService } from '../../services/admin-api.service';

/**
 * The editor screen, built from `@forge-cms/admin`'s real components — the list and the
 * schema-driven form are the package's, not the app's.
 *
 * The one thing the app has to supply is the listing itself: see finding 17 in
 * docs/DEMO-FINDINGS.md — `CmsApiService.getDocuments` cannot ask for drafts, so this page loads
 * documents through `AdminApiService` with `?status=all` instead.
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
          [readOnly]="!canWrite()"
          (create)="openCreate()"
          (edit)="openEdit($event)"
          (delete)="removeDocument($event)"
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
  private readonly admin = inject(AdminApiService);

  protected readonly collection = signal<CollectionMeta | null>(null);
  protected readonly documents = signal<Record<string, unknown>[]>([]);
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
      this.documents.set(await this.admin.listDocuments(slug, { status: 'all' }));
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load collection');
    } finally {
      this.loading.set(false);
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
      } else if (err instanceof ApiAuthError) {
        await this.router.navigate(['/login']);
      } else {
        window.alert(err instanceof Error ? err.message : 'Failed to save');
      }
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
      if (err instanceof ApiAuthError) {
        await this.router.navigate(['/login']);
      } else {
        window.alert(err instanceof Error ? err.message : 'Failed to delete');
      }
    }
  }
}
