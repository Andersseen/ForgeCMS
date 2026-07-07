import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  VoltButton,
  VoltTable,
  VoltTableBody,
  VoltTableCell,
  VoltTableHead,
  VoltTableHeader,
  VoltTableRow
} from '@voltui/components';
import { ApiValidationError, CmsApiService } from '@forge-cms/angular';
import type { CollectionMeta, FieldMeta } from '@forge-cms/angular';
import { LmnArrowLeftIcon } from 'lumen-icons';
import { IconEdit, IconPlus, IconTrash } from '../../../components/icons';
import {
  PageHeaderComponent,
  LoadingStateComponent,
  ErrorStateComponent,
  EmptyStateComponent
} from '../components';
import { DocumentFormComponent } from './document-form.component';

const MAX_COLUMNS = 6;

function formatCellValue(kind: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  switch (kind) {
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'date': {
      const date = new Date(value as string);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
    }
    case 'json':
    case 'relation':
      return Array.isArray(value) ? value.join(', ') : String(value);
    default:
      return String(value);
  }
}

@Component({
  selector: 'forge-cms-collection-detail',
  standalone: true,
  imports: [
    RouterLink,
    VoltButton,
    VoltTable,
    VoltTableHeader,
    VoltTableBody,
    VoltTableRow,
    VoltTableHead,
    VoltTableCell,
    IconPlus,
    IconEdit,
    IconTrash,
    LmnArrowLeftIcon,
    PageHeaderComponent,
    LoadingStateComponent,
    ErrorStateComponent,
    EmptyStateComponent,
    DocumentFormComponent
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
        <forge-page-header [title]="col.name" [subtitle]="col.description">
          <div actions>
            <volt-button size="sm" (click)="openCreate()">
              <icon-plus class="h-3.5 w-3.5 mr-1.5" />
              New
            </volt-button>
          </div>
        </forge-page-header>

        @if (documents().length === 0) {
          <forge-empty-state
            title="No documents yet"
            message="Documents you create in this collection will show up here."
          />
        } @else {
          <volt-table>
            <volt-table-header>
              <volt-table-row>
                <volt-table-head>ID</volt-table-head>
                @for (field of columns(); track field.name) {
                  <volt-table-head>{{ field.label }}</volt-table-head>
                }
                <volt-table-head class="text-right">Actions</volt-table-head>
              </volt-table-row>
            </volt-table-header>
            <volt-table-body>
              @for (doc of documents(); track doc['id']) {
                <volt-table-row>
                  <volt-table-cell class="font-mono text-xs text-muted-foreground">
                    {{ String(doc['id']).slice(0, 8) }}
                  </volt-table-cell>
                  @for (field of columns(); track field.name) {
                    <volt-table-cell>{{ formatCellValue(field.kind, doc[field.name]) }}</volt-table-cell>
                  }
                  <volt-table-cell class="text-right">
                    <div class="flex items-center justify-end gap-1">
                      <volt-button variant="ghost" size="icon" class="h-7 w-7" (click)="openEdit(doc)">
                        <icon-edit class="h-3.5 w-3.5" />
                      </volt-button>
                      <volt-button variant="ghost" size="icon" class="h-7 w-7" (click)="deleteDoc(doc)">
                        <icon-trash class="h-3.5 w-3.5" />
                      </volt-button>
                    </div>
                  </volt-table-cell>
                </volt-table-row>
              }
            </volt-table-body>
          </volt-table>
        }

        @if (showForm()) {
          <forge-document-form
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
  private readonly api = inject(CmsApiService);

  protected readonly String = String;
  protected readonly formatCellValue = formatCellValue;

  readonly collection = signal<CollectionMeta | null>(null);
  readonly documents = signal<Record<string, unknown>[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly columns = signal<FieldMeta[]>([]);

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
      this.columns.set(meta.fieldDefinitions.slice(0, MAX_COLUMNS));

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
      window.alert(err instanceof Error ? err.message : 'Failed to delete document');
    }
  }
}
