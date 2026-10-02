import { effect, inject, signal } from '@angular/core';
import type { Signal } from '@angular/core';
import { CmsApiService } from './api.service.js';
import type { PaginatedDocuments } from './types.js';
import type {
  ForgeCollectionSlug,
  ForgeDocument,
  ForgeQueryOptions,
  ForgeSchema,
  UntypedForgeSchema
} from './schema.js';

/**
 * A reactive read: the three signals every screen needs around one request, plus `reload()`.
 *
 * Shaped like `@angular/core`'s `resource()` but implemented with plain signals, because `resource`
 * is still experimental and this package supports Angular 19 and up.
 */
export interface ForgeResource<T> {
  value: Signal<T>;
  isLoading: Signal<boolean>;
  error: Signal<Error | null>;
  reload(): void;
}

/** A list request: the collection plus its query options (schema-aware when `S` is a typed schema). */
export type CollectionRequest<
  S extends ForgeSchema = UntypedForgeSchema,
  TSlug extends ForgeCollectionSlug<S> = ForgeCollectionSlug<S>,
  D extends 0 | 1 = 0,
  L extends string | undefined = undefined
> = ForgeQueryOptions<S, TSlug, D, L> & { collection: TSlug };

export interface DocumentRequest<
  S extends ForgeSchema = UntypedForgeSchema,
  TSlug extends ForgeCollectionSlug<S> = ForgeCollectionSlug<S>,
  D extends 0 | 1 = 0
> {
  collection: TSlug;
  id: string;
  depth?: D;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * The shared machinery: re-run `load` whenever `params` changes, drop out-of-order responses, and
 * stay idle while `params` returns `undefined` (the "no id in the route yet" case).
 */
function createResource<TRequest, TValue>(
  params: () => TRequest | undefined,
  load: (request: TRequest) => Promise<TValue>
): ForgeResource<TValue | undefined> {
  const value = signal<TValue | undefined>(undefined);
  const isLoading = signal(false);
  const error = signal<Error | null>(null);
  const reloadCount = signal(0);

  let latest = 0;

  effect(() => {
    const request = params();
    reloadCount();

    if (request === undefined) {
      isLoading.set(false);
      return;
    }

    const attempt = ++latest;
    isLoading.set(true);
    error.set(null);

    void load(request)
      .then((result) => {
        if (attempt !== latest) return;
        value.set(result);
      })
      .catch((err: unknown) => {
        if (attempt !== latest) return;
        error.set(toError(err));
      })
      .finally(() => {
        if (attempt !== latest) return;
        isLoading.set(false);
      });
  });

  return {
    value: value.asReadonly(),
    isLoading: isLoading.asReadonly(),
    error: error.asReadonly(),
    reload: () => reloadCount.update((count) => count + 1)
  };
}

/**
 * A page of documents as signals. Call in an injection context. Untyped by default; pass the schema and
 * the slug (and `depth`/`locale` literals when used) to type the value:
 *
 * ```ts
 * readonly services = collectionResource<SiteSchema, 'services'>(() => ({
 *   collection: 'services',
 *   where: { featured: true },
 *   sort: 'order',
 *   limit: this.pageSize()
 * }));
 * ```
 */
export function collectionResource<
  S extends ForgeSchema = UntypedForgeSchema,
  TSlug extends ForgeCollectionSlug<S> = ForgeCollectionSlug<S>,
  D extends 0 | 1 = 0,
  L extends string | undefined = undefined
>(
  params: () => CollectionRequest<S, TSlug, D, L> | undefined
): ForgeResource<PaginatedDocuments<ForgeDocument<S, TSlug, D, L>> | undefined> {
  const api = inject(CmsApiService) as unknown as CmsApiService<S>;
  return createResource(params, ({ collection, ...query }) =>
    api.listDocuments<TSlug, D, L>(collection, query as ForgeQueryOptions<S, TSlug, D, L>)
  );
}

/** One document as signals. Returns `undefined` until `params` yields a request. */
export function documentResource<
  S extends ForgeSchema = UntypedForgeSchema,
  TSlug extends ForgeCollectionSlug<S> = ForgeCollectionSlug<S>,
  D extends 0 | 1 = 0
>(
  params: () => DocumentRequest<S, TSlug, D> | undefined
): ForgeResource<ForgeDocument<S, TSlug, D> | undefined> {
  const api = inject(CmsApiService) as unknown as CmsApiService<S>;
  return createResource(params, ({ collection, id, depth }) =>
    api.getDocument<TSlug, D>(collection, id, ...(depth !== undefined ? [{ depth }] : []))
  );
}
