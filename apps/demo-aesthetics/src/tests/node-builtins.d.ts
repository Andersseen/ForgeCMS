// This app's tsconfig deliberately carries no Node types. The policy tests need two builtins to run the
// budget's real SQL against SQLite, so declare just the surface they use.
declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      get(...values: unknown[]): unknown;
      all(...values: unknown[]): unknown[];
      run(...values: unknown[]): unknown;
    };
  }
}
declare module 'node:module' {
  export function createRequire(url: string): (id: string) => unknown;
}
