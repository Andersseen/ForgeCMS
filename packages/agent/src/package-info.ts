import { readFileSync } from 'node:fs';

/** Absolute paths of the assets shipped inside this package (docs corpus, skills), resolved from the build output. */
export const PACKAGE_ROOT = new URL('../', import.meta.url);
export const DOCS_DIR = new URL('docs/', PACKAGE_ROOT);
export const SKILLS_DIR = new URL('skills/', PACKAGE_ROOT);

/** The version of this package — and therefore of the Forge release whose docs and skills it ships. */
export function packageVersion(): string {
  const parsed: unknown = JSON.parse(readFileSync(new URL('package.json', PACKAGE_ROOT), 'utf8'));
  const version =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { version?: unknown }).version
      : undefined;
  return typeof version === 'string' ? version : 'unknown';
}
