import { signal, type Signal, type WritableSignal } from '@angular/core';

export interface AsyncState<T> {
  data: Signal<T | null>;
  loading: Signal<boolean>;
  error: Signal<string | null>;
  reload: (load: () => Promise<T>) => void;
}

/**
 * The three signals a page needs around one `fetch`.
 *
 * `@forge-cms/angular` now ships `collectionResource`/`documentResource` (spec 041) with the same
 * shape, and the admin uses those. This stays for the public site only, because those pages read
 * the app's own composed `/api/site/*` payloads rather than a single collection.
 */
export function asyncState<T>(load?: () => Promise<T>): AsyncState<T> {
  const data: WritableSignal<T | null> = signal<T | null>(null);
  const loading = signal(load !== undefined);
  const error = signal<string | null>(null);

  const run = (loader: () => Promise<T>): void => {
    loading.set(true);
    error.set(null);
    void loader()
      .then((value) => data.set(value))
      .catch((err: unknown) =>
        error.set(err instanceof Error ? err.message : 'Something went wrong')
      )
      .finally(() => loading.set(false));
  };

  if (load) run(load);

  return {
    data: data.asReadonly(),
    loading: loading.asReadonly(),
    error: error.asReadonly(),
    reload: run
  };
}
