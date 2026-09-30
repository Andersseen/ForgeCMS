import { signal, type Signal, type WritableSignal } from '@angular/core';
import { ForgeApiError } from '@forge-cms/angular';

export interface AsyncState<T> {
  data: Signal<T | null>;
  loading: Signal<boolean>;
  /** The structured failure (spec 075). Templates show copy for visitors, never its message. */
  error: Signal<ForgeApiError | null>;
  /** `true` only for a real `404` — an outage is never presented as "not found". */
  notFound: Signal<boolean>;
  reload: (load: () => Promise<T>) => void;
  /** Re-runs the last loader (the Retry button). */
  retry: () => void;
}

/**
 * The signals a page needs around one `fetch`.
 *
 * `@forge-cms/angular` now ships `collectionResource`/`documentResource` (spec 041) with the same
 * shape, and the admin uses those. This stays for the public site only, because those pages read
 * the app's own composed `/api/site/*` payloads rather than a single collection.
 */
export function asyncState<T>(load?: () => Promise<T>): AsyncState<T> {
  const data: WritableSignal<T | null> = signal<T | null>(null);
  const loading = signal(load !== undefined);
  const error = signal<ForgeApiError | null>(null);
  const notFound = signal(false);
  let last = load;

  const run = (loader: () => Promise<T>): void => {
    last = loader;
    loading.set(true);
    error.set(null);
    notFound.set(false);
    void loader()
      .then((value) => data.set(value))
      .catch((err: unknown) => {
        const failure =
          err instanceof ForgeApiError
            ? err
            : new ForgeApiError({ kind: 'network', code: 'UNKNOWN', message: 'Request failed' });
        error.set(failure);
        notFound.set(failure.status === 404);
      })
      .finally(() => loading.set(false));
  };

  if (load) run(load);

  return {
    data: data.asReadonly(),
    loading: loading.asReadonly(),
    error: error.asReadonly(),
    notFound: notFound.asReadonly(),
    reload: run,
    retry: () => {
      if (last) run(last);
    }
  };
}
