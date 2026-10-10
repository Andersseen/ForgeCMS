import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Where measurements are written (gitignored): `<repo>/.quality/performance/`. */
export const OUTPUT_DIR = resolve(here, '..', '..', '..', '.quality', 'performance');

export function writeReport(name: string, value: unknown): string {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const file = join(OUTPUT_DIR, name);
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}
