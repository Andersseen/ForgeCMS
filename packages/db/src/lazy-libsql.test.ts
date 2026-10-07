import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LibSqlDatabaseAdapter } from './index.js';

const srcDir = dirname(fileURLToPath(import.meta.url));

/** Specifiers whose evaluation resolves libSQL's platform-specific native package (spec 081). */
const NATIVE_LOADING = ['@libsql/client', 'drizzle-orm/libsql'];

/** Value imports/re-exports (`import x from 'm'`, `import 'm'`, `export … from 'm'`) — not `import type` or `import('m')`. */
function staticValueImports(source: string): string[] {
  const found: string[] = [];
  const pattern = /^\s*(?:import|export)\s+(?!type\b)(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
  for (const match of source.matchAll(pattern)) found.push(match[1] ?? '');
  return found;
}

describe('the package entry does not load libSQL (spec 081)', () => {
  it('has no static value import of a libSQL-loading module in any non-test source file', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(srcDir).filter(
      (f) => f.endsWith('.ts') && !f.includes('.test.')
    )) {
      for (const specifier of staticValueImports(readFileSync(join(srcDir, file), 'utf8'))) {
        if (NATIVE_LOADING.some((name) => specifier === name || specifier.startsWith(`${name}/`))) {
          offenders.push(`${file} → ${specifier}`);
        }
      }
    }
    // A static import makes Nitro/Vite/wrangler resolve libSQL's native binary for every app that imports
    // `@forge-cms/db`, including InMemory-only ones. Load it lazily, where it is used.
    expect(offenders).toEqual([]);
  });

  it('the detector sees what it is meant to see', () => {
    expect(
      staticValueImports(`import { a } from '@libsql/client';\nimport type { B } from 'x';`)
    ).toEqual(['@libsql/client']);
    expect(staticValueImports(`export { X } from 'drizzle-orm/libsql';`)).toEqual([
      'drizzle-orm/libsql'
    ]);
    expect(staticValueImports(`const m = await import('@libsql/client');`)).toEqual([]);
    expect(staticValueImports(`import type { Client } from '@libsql/client';`)).toEqual([]);
  });

  it('still opens a real database on first use and reports a bad URL as a rejection, not at init()', async () => {
    const bad = new LibSqlDatabaseAdapter('not-a-valid-scheme:oops');
    expect(() => bad.init()).not.toThrow();
    await expect(bad.count('anything')).rejects.toThrow();

    const good = new LibSqlDatabaseAdapter('file::memory:').init();
    await expect(good.planSchema([])).resolves.toBeDefined();
  });

  it('reports an adapter that was never initialized with the same message as before', async () => {
    await expect(new LibSqlDatabaseAdapter('file::memory:').planSchema([])).rejects.toThrow(
      'LibSqlDatabaseAdapter not initialized. Call init() first.'
    );
  });

  it('opens one connection for concurrent first operations', async () => {
    const adapter = new LibSqlDatabaseAdapter('file::memory:').init();
    await Promise.all([adapter.planSchema([]), adapter.planSchema([]), adapter.planSchema([])]);
    const internals = adapter as unknown as { client: unknown };
    expect(internals.client).toBeDefined();
  });
});
