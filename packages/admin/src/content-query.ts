import type { CollectionDefinition } from '@forge-cms/core';
import type { CollectionMeta, QueryOptions } from '@forge-cms/angular';
import type { ForgeAdminConfig } from './config.js';
import type { SortRequest } from './collection-list.component.js';

/** Field kinds worth offering as a search target. Mirrors `ForgeRelationPickerComponent`. */
const SEARCHABLE_KINDS = new Set(['text', 'slug', 'email']);

/**
 * The field a collection's search box should query, preferring `useAsTitle` (an explicit config
 * beats a guess) and otherwise the first text-ish field. `null` means "hide search" — a broken
 * query is worse than no search box.
 */
export function findSearchableField(
  collection: Pick<CollectionMeta, 'useAsTitle' | 'fieldDefinitions'>
): string | null {
  if (
    collection.useAsTitle !== undefined &&
    collection.fieldDefinitions.some((field) => field.name === collection.useAsTitle)
  ) {
    return collection.useAsTitle;
  }
  return (
    collection.fieldDefinitions.find((field) => SEARCHABLE_KINDS.has(field.kind))?.name ?? null
  );
}

export interface WorkspaceQueryState {
  page: number;
  sort: SortRequest | null;
  /** Ignored (never sent) for a collection without `drafts: true`. */
  status: 'all' | 'draft' | 'published';
  search: string;
  searchField: string | null;
  hasDrafts: boolean;
}

/** Builds the `listDocuments` query from a workspace's query-state signals. */
export function buildListQuery(state: WorkspaceQueryState): QueryOptions {
  const term = state.search.trim();
  return {
    page: state.page,
    ...(state.sort !== null && { sort: state.sort.field, order: state.sort.order }),
    ...(state.hasDrafts && { status: state.status }),
    ...(term !== '' &&
      state.searchField !== null && { where: { [state.searchField]: { contains: term } } })
  };
}

/**
 * After deleting a document, whether the workspace should step back one page — the deleted row was
 * the last one on a page beyond the first.
 */
export function pageAfterDelete(currentPage: number, remainingOnPage: number): number {
  return remainingOnPage === 0 && currentPage > 1 ? currentPage - 1 : currentPage;
}

/** Filters and orders `all` to just the collections a host's config allows, config order first. */
export function visibleCollections(
  all: CollectionMeta[],
  config: Pick<ForgeAdminConfig, 'collections'> | null | undefined
): CollectionMeta[] {
  const restriction = config?.collections;
  if (restriction === undefined) return all;

  const bySlug = new Map(all.map((meta) => [meta.slug, meta]));
  return restriction
    .map((collection: CollectionDefinition) => bySlug.get(collection.slug))
    .filter((meta): meta is CollectionMeta => meta !== undefined);
}
