import { afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { runSchemaDriftContractTests } from '@forge-cms/testing/contracts';
import { LibSqlDatabaseAdapter } from './libsql.adapter.js';

// Spec 070 — schema drift on a real on-disk libSQL file. Every `open()` is a new adapter instance and
// client over the same file (a process restart); raw reads/writes go through an independent client.

const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as {
  mkdtempSync(prefix: string): string;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
};
const os = (await import(/* @vite-ignore */ 'node:os' as string)) as { tmpdir(): string };
const directory = fs.mkdtempSync(`${os.tmpdir()}/forge-schema-drift-`);
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
let files = 0;

runSchemaDriftContractTests('LibSqlDatabaseAdapter (on-disk file)', () => {
  const url = `file:${directory}/drift-${++files}.db`;
  const raw = createClient({ url });
  return Promise.resolve({
    open: () => Promise.resolve(new LibSqlDatabaseAdapter(url).init()),
    query: async (sql: string) => (await raw.execute(sql)).rows.map((row) => ({ ...row })),
    exec: async (sql: string) => {
      await raw.execute(sql);
    }
  });
});
