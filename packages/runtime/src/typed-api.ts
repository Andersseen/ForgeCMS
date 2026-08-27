import type {
  CollectionBySlug,
  CollectionDefinition,
  CollectionDocument,
  CollectionInput,
  CollectionRegistry,
  CollectionSlug
} from '@forge-cms/core';
import type { WhereCondition } from '@forge-cms/db';
import type {
  CountArgs,
  CreateArgs,
  DeleteArgs,
  FindArgs,
  FindByIDArgs,
  PaginatedDocs,
  UpdateArgs
} from './operations.js';

/**
 * The Local API generic arg/result wiring for the typed collection surface (`runtime.ts`). Kept in
 * one file, isolated from `operations.ts` (untyped, unchanged) and from the method bodies in
 * `runtime.ts` (a one-line delegate-and-cast each), so the generic machinery doesn't spread.
 */

/** `sort`/`where`-key candidates: the collection's declared fields plus standard document metadata. */
export type TypedSortField<TCollection extends CollectionDefinition> = Extract<
  keyof CollectionDocument<TCollection>,
  string
>;

/** A `where` clause narrowed to known field names; values stay loosely typed (see spec non-goals). */
export type TypedWhere<TCollection extends CollectionDefinition> = Partial<
  Record<TypedSortField<TCollection>, WhereCondition>
>;

export type TypedFindArgs<
  TCollections extends CollectionRegistry,
  TSlug extends CollectionSlug<TCollections>
> = Omit<FindArgs, 'collection' | 'where' | 'sort'> & {
  collection: TSlug;
  where?: TypedWhere<CollectionBySlug<TCollections, TSlug>>;
  sort?: TypedSortField<CollectionBySlug<TCollections, TSlug>>;
};

export type TypedFindByIDArgs<
  TCollections extends CollectionRegistry,
  TSlug extends CollectionSlug<TCollections>
> = Omit<FindByIDArgs, 'collection'> & { collection: TSlug };

export type TypedCountArgs<
  TCollections extends CollectionRegistry,
  TSlug extends CollectionSlug<TCollections>
> = Omit<CountArgs, 'collection' | 'where'> & {
  collection: TSlug;
  where?: TypedWhere<CollectionBySlug<TCollections, TSlug>>;
};

export type TypedCreateArgs<
  TCollections extends CollectionRegistry,
  TSlug extends CollectionSlug<TCollections>
> = Omit<CreateArgs, 'collection' | 'data'> & {
  collection: TSlug;
  data: CollectionInput<CollectionBySlug<TCollections, TSlug>>;
};

export type TypedUpdateArgs<
  TCollections extends CollectionRegistry,
  TSlug extends CollectionSlug<TCollections>
> = Omit<UpdateArgs, 'collection' | 'data'> & {
  collection: TSlug;
  data: CollectionInput<CollectionBySlug<TCollections, TSlug>>;
};

export type TypedDeleteArgs<
  TCollections extends CollectionRegistry,
  TSlug extends CollectionSlug<TCollections>
> = Omit<DeleteArgs, 'collection'> & { collection: TSlug };

export type TypedPreviewArgs<
  TCollections extends CollectionRegistry,
  TSlug extends CollectionSlug<TCollections>
> = {
  collection: TSlug;
  data: CollectionInput<CollectionBySlug<TCollections, TSlug>>;
  id?: string;
  depth?: 0 | 1;
};

export type TypedPaginatedDocs<
  TCollections extends CollectionRegistry,
  TSlug extends CollectionSlug<TCollections>
> = Omit<PaginatedDocs, 'docs'> & {
  docs: CollectionDocument<CollectionBySlug<TCollections, TSlug>>[];
};
