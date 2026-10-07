import { computed, effect, inject, signal, untracked } from '@angular/core';
import type { Signal } from '@angular/core';
import { CmsApiService } from './api.service.js';
import { credentialBoundary } from './credentials.js';
import { ForgePublicTransfer, bindPublicTransfer } from './transfer.js';
import { buildQueryString } from './query.js';
import type { QueryOptions } from './query.js';
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
 * Shaped like `@angular/core`'s `resource()` but implemented with plain signals (`resource` is still
 * experimental). Contract (spec 077): `value()` is `undefined` or the result of the **current** request
 * under the **current** credentials; a superseded request is aborted and can never commit; an abort is
 * never an `error()`; nothing is retried. See the Angular client guide for every transition.
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

/**
 * Options of {@link collectionResource} / {@link documentResource}.
 *
 * `transfer: 'public'` (spec 080) opts one read into server → browser result transfer: a successful SSR
 * result is serialized with Angular's `TransferState` and the first browser render reuses it instead of
 * repeating the request. Only an anonymous client may use it (`provideForgeCms({ credentials: 'omit' })`,
 * no `authToken`, no forwarded `Authorization`); otherwise creating the resource throws a `TypeError`.
 * Errors are never transferred. Default: nothing is transferred. A custom `transport` that attaches its
 * own identity is outside this contract: public transfer assumes the client sends none.
 */
export interface ForgeResourceOptions {
  transfer?: 'public';
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/** What the signals show, plus what it belongs to. Replaced as a whole, never mutated. */
interface ResourceState<TValue> {
  /** Key of the request these signals describe; `undefined` while idle. */
  key: string | undefined;
  /** Credential revision the state was produced under (spec 077). */
  revision: object;
  value: TValue | undefined;
  isLoading: boolean;
  error: Error | null;
}

/**
 * The shared machinery (spec 077 — the resource contract in the Angular client guide):
 *
 * - every run of `params()` that yields a request starts one **attempt** with its own `AbortController`;
 *   the effect's cleanup aborts it when the attempt is superseded (new params, `reload()`, idle, a
 *   credential change) or the owner is destroyed;
 * - an attempt commits only while its signal is not aborted and the credential revision it started under
 *   is still current — a custom transport that ignores the signal still cannot overwrite newer state;
 * - `value()` only ever holds a result of the current request key under the current credentials: a new
 *   key, idle and a credential change reset it, a same-key re-run (`reload()`) keeps it while loading;
 * - an aborted attempt never becomes an `error()`; a real failure is surfaced as-is and clears `value()`;
 * - nothing is retried.
 */
function createResource<TRequest, TValue>(
  params: () => TRequest | undefined,
  keyOf: (request: TRequest) => string,
  load: (request: TRequest, signal: AbortSignal) => Promise<TValue>,
  transfer?: {
    hydrating: boolean;
    keyOf(requestKey: string): string;
    coordinator: ForgePublicTransfer;
  }
): ForgeResource<TValue | undefined> {
  const credentials = credentialBoundary(inject(CmsApiService)).revision;
  const reloads = signal(0);
  const state = signal<ResourceState<TValue>>({
    key: undefined,
    revision: untracked(credentials),
    value: undefined,
    isLoading: false,
    error: null
  });

  // A credential change hides the previous identity's result synchronously — before Angular has re-run
  // the effect below — so code reading `value()` right after `await session.logout()` never sees it.
  const visible = computed<ResourceState<TValue>>(() => {
    const current = state();
    if (current.revision === credentials()) return current;
    return { ...current, value: undefined, error: null, isLoading: current.key !== undefined };
  });

  // Initial hydration only: the first request this resource makes may be answered by transferred state.
  let hydrating = transfer?.hydrating === true;

  effect((onCleanup) => {
    const request = params();
    reloads();
    const revision = credentials();

    untracked(() => {
      if (request === undefined) {
        state.set({ key: undefined, revision, value: undefined, isLoading: false, error: null });
        return;
      }

      const key = keyOf(request);
      const previous = state();
      const sameRequest = previous.key === key && previous.revision === revision;
      state.set({
        key,
        revision,
        value: sameRequest ? previous.value : undefined,
        isLoading: true,
        error: null
      });

      const transferKey = transfer?.keyOf(key);
      if (transfer && transferKey !== undefined) {
        const hit = hydrating ? transfer.coordinator.read(transferKey) : undefined;
        hydrating = false;
        if (hit !== undefined) {
          state.set({ key, revision, value: hit.value as TValue, isLoading: false, error: null });
          return;
        }
      }

      const controller = new AbortController();
      onCleanup(() => controller.abort());
      const current = () => !controller.signal.aborted && untracked(credentials) === revision;

      load(request, controller.signal).then(
        (value) => {
          if (!current()) return;
          if (transfer && transferKey !== undefined) transfer.coordinator.put(transferKey, value);
          state.set({ key, revision, value, isLoading: false, error: null });
        },
        (err: unknown) => {
          if (current()) {
            state.set({ key, revision, value: undefined, isLoading: false, error: toError(err) });
          }
        }
      );
    });
  });

  return {
    value: computed(() => visible().value),
    isLoading: computed(() => visible().isLoading),
    error: computed(() => visible().error),
    reload: () => reloads.update((count) => count + 1)
  };
}

/** The transfer binding of one resource (spec 080): `undefined` unless it opted in; throws when not anonymous. */
function transferOf(api: object, kind: string, options: ForgeResourceOptions) {
  if (options.transfer !== 'public') return undefined;
  const coordinator = inject(ForgePublicTransfer);
  return { ...bindPublicTransfer(api, kind, coordinator), coordinator };
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
  params: () => CollectionRequest<S, TSlug, D, L> | undefined,
  options: ForgeResourceOptions = {}
): ForgeResource<PaginatedDocuments<ForgeDocument<S, TSlug, D, L>> | undefined> {
  const api = inject(CmsApiService) as unknown as CmsApiService<S>;
  return createResource(
    params,
    // The wire identity: the same collection and query string is the same request.
    ({ collection, ...query }) =>
      `${collection}${buildQueryString(query as unknown as QueryOptions)}`,
    ({ collection, ...query }, signal) =>
      api.listDocuments<TSlug, D, L>(collection, query as ForgeQueryOptions<S, TSlug, D, L>, {
        signal
      }),
    transferOf(api, 'collection', options)
  );
}

/** One document as signals. Returns `undefined` until `params` yields a request. */
export function documentResource<
  S extends ForgeSchema = UntypedForgeSchema,
  TSlug extends ForgeCollectionSlug<S> = ForgeCollectionSlug<S>,
  D extends 0 | 1 = 0
>(
  params: () => DocumentRequest<S, TSlug, D> | undefined,
  options: ForgeResourceOptions = {}
): ForgeResource<ForgeDocument<S, TSlug, D> | undefined> {
  const api = inject(CmsApiService) as unknown as CmsApiService<S>;
  return createResource(
    params,
    ({ collection, id, depth }) => JSON.stringify([collection, id, depth ?? 0]),
    ({ collection, id, depth }, signal) =>
      api.getDocument<TSlug, D>(collection, id, depth !== undefined ? { depth } : undefined, {
        signal
      }),
    transferOf(api, 'document', options)
  );
}
