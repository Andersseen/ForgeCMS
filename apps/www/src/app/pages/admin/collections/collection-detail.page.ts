import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiAuthError, ApiValidationError, CmsApiService } from '@forge-cms/angular';
import type { CollectionMeta } from '@forge-cms/angular';
import {
  ErrorStateComponent,
  ForgeCollectionFormComponent,
  ForgeCollectionListComponent,
  LoadingStateComponent
} from '@forge-cms/admin';
import { LmnArrowLeftIcon } from 'lumen-icons';

@Component({
  selector: 'forge-cms-collection-detail',
  standalone: true,
  imports: [
    RouterLink,
    LmnArrowLeftIcon,
    LoadingStateComponent,
    ErrorStateComponent,
    ForgeCollectionListComponent,
    ForgeCollectionFormComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <a
        routerLink="/admin/collections"
        class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:underline"
      >
        <lmn-arrow-left [size]="14" />
        Back to collections
      </a>

      @if (loading()) {
        <forge-loading-state variant="table" />
      } @else if (error()) {
        <forge-error-state title="Unable to load collection" [message]="error()" (retry)="load()" />
      } @else if (collection(); as col) {
        <forge-collection-list
          [collection]="col"
          [documents]="documents()"
          (create)="openCreate()"
          (edit)="openEdit($event)"
          (delete)="deleteDoc($event)"
        />

        @if (showForm()) {
          <forge-collection-form
            [fields]="col.fieldDefinitions"
            [initialValue]="editingDoc() ?? {}"
            [fieldErrors]="fieldErrors()"
            [submitLabel]="editingDoc() ? 'Save' : 'Create'"
            (save)="onSave($event)"
            (cancel)="closeForm()"
          />
        }
      }
    </div>
  `
})
export class CollectionDetailPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(CmsApiService);

  readonly collection = signal<CollectionMeta | null>(null);
  readonly documents = signal<Record<string, unknown>[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly showForm = signal(false);
  readonly editingDoc = signal<Record<string, unknown> | null>(null);
  readonly fieldErrors = signal<Record<string, string>>({});

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (!slug) {
      this.error.set('Missing collection slug');
      this.loading.set(false);
      return;
    }

    try {
      this.loading.set(true);
      this.error.set(null);

      const collections = await this.api.getCollections();
      const meta = collections.find((c) => c.slug === slug);
      if (!meta) {
        this.error.set(`Collection '${slug}' not found`);
        return;
      }

      this.collection.set(meta);

      const docs = await this.api.getDocuments(slug);
      this.documents.set(docs);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load collection');
    } finally {
      this.loading.set(false);
    }
  }

  openCreate(): void {
    this.editingDoc.set(null);
    this.fieldErrors.set({});
    this.showForm.set(true);
  }

  openEdit(doc: Record<string, unknown>): void {
    this.editingDoc.set(doc);
    this.fieldErrors.set({});
    this.showForm.set(true);
  }

  closeForm(): void {
    this.showForm.set(false);
    this.editingDoc.set(null);
    this.fieldErrors.set({});
  }

  async onSave(value: Record<string, unknown>): Promise<void> {
    const slug = this.collection()?.slug;
    if (!slug) return;

    try {
      const editing = this.editingDoc();
      if (editing) {
        await this.api.updateDocument(slug, String(editing['id']), value);
      } else {
        await this.api.createDocument(slug, value);
      }
      this.closeForm();
      await this.load();
    } catch (err) {
      if (err instanceof ApiValidationError) {
        const errors: Record<string, string> = {};
        for (const detail of err.details) {
          errors[detail.field] = detail.message;
        }
        this.fieldErrors.set(errors);
      } else if (err instanceof ApiAuthError) {
        await this.router.navigate(['/login']);
      } else {
        // Unexpected (non-validation) failure — keep the form open with its data intact.
        window.alert(err instanceof Error ? err.message : 'Failed to save document');
      }
    }
  }

  async deleteDoc(doc: Record<string, unknown>): Promise<void> {
    const slug = this.collection()?.slug;
    if (!slug) return;

    const confirmed = window.confirm('Delete this document? This cannot be undone.');
    if (!confirmed) return;

    try {
      await this.api.deleteDocument(slug, String(doc['id']));
      await this.load();
    } catch (err) {
      if (err instanceof ApiAuthError) {
        await this.router.navigate(['/login']);
      } else {
        window.alert(err instanceof Error ? err.message : 'Failed to delete document');
      }
    }
  }
}
