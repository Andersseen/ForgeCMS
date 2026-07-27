import { signal, type Signal, type WritableSignal } from '@angular/core';

export interface AsyncState<T> {
  data: Signal<T | null>;
  loading: Signal<boolean>;
  error: Signal<string | null>;
  reload: (load: () => Promise<T>) => void;
}

/**
 * The three signals every page needs around one `fetch`.
 *
 * FINDING 15: `@forge-cms/angular` ships a promise-based `CmsApiService` and nothing else, so each
 * app re-invents loading/error state. Roadmap 036 (signals-based `resource()` clients) is the fix.
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
