import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { CollectionMeta, FieldMeta } from '@forge-cms/angular';
import {
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

/** Presentational document list for one collection — schema-driven table, no data-fetching. */
@Component({
  selector: 'forge-collection-list',
  standalone: true,
  imports: [
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
                <volt-table-cell>{{
                  formatCellValue(field.kind, doc[field.name])
                }}</volt-table-cell>
              }
              <volt-table-cell class="text-right">
                @if (!readOnly()) {
                  <div class="flex items-center justify-end gap-1">
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
    }
  `
})
export class ForgeCollectionListComponent {
  collection = input.required<CollectionMeta>();
  documents = input.required<Record<string, unknown>[]>();
  readOnly = input<boolean>(false);

  create = output<void>();
  edit = output<Record<string, unknown>>();
  delete = output<Record<string, unknown>>();

  protected readonly String = String;
  protected readonly formatCellValue = formatCellValue;
  protected readonly columns = computed<FieldMeta[]>(() =>
    this.collection().fieldDefinitions.slice(0, MAX_COLUMNS)
  );
}
