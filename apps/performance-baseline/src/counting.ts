import type { DatabaseAdapter } from '@forge-cms/db';

/**
 * A test-only wrapper at the DatabaseAdapter boundary that counts calls per method. Nothing in a
 * `@forge-cms/*` package knows it exists — Forge has no production telemetry for this (spec 089).
 */
export interface CountingDatabase {
  readonly database: DatabaseAdapter;
  /** Calls per adapter method since the last {@link CountingDatabase.reset}. */
  readonly calls: Record<string, number>;
  reset(): void;
  total(): number;
  /** Copy of the counts, for storing next to a measurement. */
  snapshot(): Record<string, number>;
}

export function countCalls(inner: DatabaseAdapter): CountingDatabase {
  const calls: Record<string, number> = {};
  const database = new Proxy(inner, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== 'function' || typeof property !== 'string') return value;
      return (...args: unknown[]) => {
        calls[property] = (calls[property] ?? 0) + 1;
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    }
  });
  return {
    database,
    calls,
    reset() {
      for (const key of Object.keys(calls)) delete calls[key];
    },
    total: () => Object.values(calls).reduce((sum, n) => sum + n, 0),
    snapshot: () => ({ ...calls })
  };
}
