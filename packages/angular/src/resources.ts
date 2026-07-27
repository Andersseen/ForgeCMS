import { effect, inject, signal } from '@angular/core';
import type { Signal } from '@angular/core';
import { CmsApiService } from './api.service.js';
import type { PaginatedDocuments } from './types.js';
import type { QueryOptions } from './query.js';

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

export interface CollectionRequest extends QueryOptions {
  collection: string;
}

export interface DocumentRequest {
  collection: string;
  id: string;
  depth?: 0 | 1;
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
 * A page of documents as signals. Call in an injection context:
 *
 * ```ts
 * readonly services = collectionResource<Service>(() => ({
 *   collection: 'services',
 *   where: { featured: true },
 *   sort: 'order',
 *   limit: this.pageSize()
 * }));
 * ```
 */
export function collectionResource<T = Record<string, unknown>>(
  params: () => CollectionRequest | undefined
): ForgeResource<PaginatedDocuments<T> | undefined> {
  const api = inject(CmsApiService);
  return createResource(params, ({ collection, ...query }) =>
    api.listDocuments<T>(collection, query)
  );
}

/** One document as signals. Returns `undefined` until `params` yields a request. */
export function documentResource<T = Record<string, unknown>>(
  params: () => DocumentRequest | undefined
): ForgeResource<T | undefined> {
  const api = inject(CmsApiService);
  return createResource(params, ({ collection, id, depth }) =>
    api.getDocument<T>(collection, id, ...(depth !== undefined ? [{ depth }] : []))
  );
}
