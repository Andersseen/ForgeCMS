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
  FindOneArgs,
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

/**
 * A `where` clause narrowed to known field names; values stay loosely typed (see spec non-goals).
 * Recursive `and`/`or` groups (spec 050) keep the same field-name narrowing at every nesting level.
 */
export type TypedWhere<TCollection extends CollectionDefinition> =
  | Partial<Record<TypedSortField<TCollection>, WhereCondition>>
  | { and: TypedWhere<TCollection>[] }
  | { or: TypedWhere<TCollection>[] };

/** `sort`: a single typed field name (legacy), or a multi-field sort list (spec 050). */
export type TypedSortInput<TCollection extends CollectionDefinition> =
  | TypedSortField<TCollection>
  | { field: TypedSortField<TCollection>; order?: 'asc' | 'desc' }[];

export type TypedFindArgs<
  TCollections extends CollectionRegistry,
  TSlug extends CollectionSlug<TCollections>
> = Omit<FindArgs, 'collection' | 'where' | 'sort'> & {
  collection: TSlug;
  where?: TypedWhere<CollectionBySlug<TCollections, TSlug>>;
  sort?: TypedSortInput<CollectionBySlug<TCollections, TSlug>>;
};

export type TypedFindByIDArgs<
  TCollections extends CollectionRegistry,
  TSlug extends CollectionSlug<TCollections>
> = Omit<FindByIDArgs, 'collection'> & { collection: TSlug };

/** Typed `findOne` args — same shape as {@link TypedFindArgs} minus pagination (spec 050 §5). */
export type TypedFindOneArgs<
  TCollections extends CollectionRegistry,
  TSlug extends CollectionSlug<TCollections>
> = Omit<FindOneArgs, 'collection' | 'where' | 'sort'> & {
  collection: TSlug;
  where?: TypedWhere<CollectionBySlug<TCollections, TSlug>>;
  sort?: TypedSortInput<CollectionBySlug<TCollections, TSlug>>;
};

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
