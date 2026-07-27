import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { CollectionMeta, FieldMeta, ListMeta } from '@forge-cms/angular';
import {
  VoltBadge,
  VoltButton,
  VoltTable,
  VoltTableBody,
  VoltTableCell,
  VoltTableHead,
  VoltTableHeader,
  VoltTableRow
} from '@voltui/components';
import { LmnPencilIcon, LmnPlusIcon, LmnTrashIcon } from 'lumen-icons';
import { PageHeaderComponent } from './page-header.component.js';
import { EmptyStateComponent } from './empty-state.component.js';
import { toCellView } from './cell-value.js';
import { shortId } from './document-label.js';

const MAX_COLUMNS = 6;

/** A sort request from a column header. `null` order means "stop sorting by this". */
export interface SortRequest {
  field: string;
  order: 'asc' | 'desc';
}

/** A publish/unpublish request from the status column. */
export interface StatusChangeRequest {
  document: Record<string, unknown>;
  status: 'draft' | 'published';
}

/**
 * Presentational document list for one collection: schema-driven table, no data-fetching.
 *
 * Spec 042 added the three things an editor cannot work without — cells that render each field kind
 * properly, a draft/published column that can be toggled in place, and sorting and pagination
 * controls (driven by the caller, which owns the query).
 */
@Component({
  selector: 'forge-collection-list',
  standalone: true,
  imports: [
    VoltBadge,
    VoltButton,
    VoltTable,
    VoltTableHeader,
    VoltTableBody,
    VoltTableRow,
    VoltTableHead,
    VoltTableCell,
    LmnPlusIcon,
    LmnPencilIcon,
    LmnTrashIcon,
    PageHeaderComponent,
    EmptyStateComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <forge-page-header [title]="collection().name" [subtitle]="collection().description">
      <div actions>
        @if (!readOnly()) {
          <volt-button size="sm" (click)="create.emit()">
            <lmn-plus [size]="14" class="mr-1.5" />
            New
          </volt-button>
        }
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
            @if (showStatus()) {
              <volt-table-head>Status</volt-table-head>
            }
            @for (field of columns(); track field.name) {
              <volt-table-head>
                @if (sortable()) {
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 hover:text-foreground"
                    (click)="toggleSort(field.name)"
                  >
                    {{ field.label }}
                    <span class="text-xs text-muted-foreground">{{
                      sortIndicator(field.name)
                    }}</span>
                  </button>
                } @else {
                  {{ field.label }}
                }
              </volt-table-head>
            }
            <volt-table-head class="text-right">Actions</volt-table-head>
          </volt-table-row>
        </volt-table-header>
        <volt-table-body>
          @for (doc of documents(); track doc['id']) {
            <volt-table-row>
              <volt-table-cell class="font-mono text-xs text-muted-foreground">
                {{ shortId(asString(doc['id'])) }}
              </volt-table-cell>

              @if (showStatus()) {
                <volt-table-cell>
                  @if (isPublished(doc)) {
                    <volt-badge variant="secondary">Published</volt-badge>
                  } @else {
                    <volt-badge variant="outline">Draft</volt-badge>
                  }
                </volt-table-cell>
              }

              @for (field of columns(); track field.name) {
                @let cell = cellFor(field, doc);
                <volt-table-cell>
                  @switch (cell.kind) {
                    @case ('image') {
                      <span class="flex items-center gap-2">
                        <img
                          [src]="cell.url"
                          [alt]="cell.text"
                          class="h-8 w-8 rounded object-cover"
                        />
                        <span class="truncate text-xs text-muted-foreground">{{ cell.text }}</span>
                      </span>
                    }
                    @case ('count') {
                      <span class="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {{ cell.text }}
                      </span>
                    }
                    @case ('muted') {
                      <span class="text-muted-foreground">{{ cell.text }}</span>
                    }
                    @default {
                      {{ cell.text }}
                    }
                  }
                </volt-table-cell>
              }

              <volt-table-cell class="text-right">
                @if (!readOnly()) {
                  <div class="flex items-center justify-end gap-1">
                    @if (showStatus()) {
                      <volt-button
                        variant="ghost"
                        size="sm"
                        class="h-7 text-xs"
                        (click)="toggleStatus(doc)"
                      >
                        {{ isPublished(doc) ? 'Unpublish' : 'Publish' }}
                      </volt-button>
                    }
                    <volt-button
                      variant="ghost"
                      size="icon"
                      class="h-7 w-7"
                      (click)="edit.emit(doc)"
                    >
                      <lmn-pencil [size]="14" />
                    </volt-button>
                    <volt-button
                      variant="ghost"
                      size="icon"
                      class="h-7 w-7"
                      (click)="delete.emit(doc)"
                    >
                      <lmn-trash [size]="14" />
                    </volt-button>
                  </div>
                }
              </volt-table-cell>
            </volt-table-row>
          }
        </volt-table-body>
      </volt-table>

      @if (meta(); as pagination) {
        @if (pagination.totalPages > 1) {
          <div class="mt-4 flex items-center justify-between text-sm">
            <span class="text-muted-foreground">
              Page {{ pagination.page }} of {{ pagination.totalPages }} ·
              {{ pagination.totalDocs }} documents
            </span>
            <div class="flex items-center gap-2">
              <volt-button
                variant="outline"
                size="sm"
                [disabled]="!pagination.hasPrevPage"
                (click)="pageChange.emit(pagination.page - 1)"
              >
                Previous
              </volt-button>
              <volt-button
                variant="outline"
                size="sm"
                [disabled]="!pagination.hasNextPage"
                (click)="pageChange.emit(pagination.page + 1)"
              >
                Next
              </volt-button>
            </div>
          </div>
        }
      }
    }
  `
})
export class ForgeCollectionListComponent {
  collection = input.required<CollectionMeta>();
  documents = input.required<Record<string, unknown>[]>();
  readOnly = input<boolean>(false);
  /** Pagination metadata from `listDocuments`. Omit to hide the pager. */
  meta = input<ListMeta | null>(null);
  /** The column currently sorted, so headers can show direction. */
  sort = input<SortRequest | null>(null);

  create = output<void>();
  edit = output<Record<string, unknown>>();
  delete = output<Record<string, unknown>>();
  /** Emitted when a column header is clicked. The caller owns the query and re-fetches. */
  sortChange = output<SortRequest>();
  pageChange = output<number>();
  statusChange = output<StatusChangeRequest>();

  protected readonly shortId = shortId;
  protected readonly asString = (value: unknown): string =>
    value === undefined ? '' : String(value);

  protected readonly columns = computed<FieldMeta[]>(() =>
    this.collection().fieldDefinitions.slice(0, MAX_COLUMNS)
  );

  /** Only a `drafts: true` collection has a status to show. */
  protected readonly showStatus = computed(() => this.collection().drafts === true);

  /** Sorting is only offered when the caller wired up the output. */
  protected readonly sortable = computed(() => this.sort() !== null || this.meta() !== null);

  protected cellFor(field: FieldMeta, doc: Record<string, unknown>) {
    return toCellView(field, doc[field.name]);
  }

  protected isPublished(doc: Record<string, unknown>): boolean {
    return doc['_status'] === 'published';
  }

  protected sortIndicator(field: string): string {
    const sort = this.sort();
    if (!sort || sort.field !== field) return '';
    return sort.order === 'asc' ? '↑' : '↓';
  }

  protected toggleSort(field: string): void {
    const sort = this.sort();
    const order = sort?.field === field && sort.order === 'asc' ? 'desc' : 'asc';
    this.sortChange.emit({ field, order });
  }

  protected toggleStatus(doc: Record<string, unknown>): void {
    this.statusChange.emit({
      document: doc,
      status: this.isPublished(doc) ? 'draft' : 'published'
    });
  }
}
