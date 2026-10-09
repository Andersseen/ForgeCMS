import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Spec 087: the reusable admin must not depend on `/api/v1`, `/api/auth` (or any `/api/` literal) as a
 * deployment location. Every request goes through `CmsApiService`, whose bases come only from
 * `provideForgeCms()`. Comments are ignored; code and templates are checked.
 */
const dir = import.meta.dirname;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('@forge-cms/admin source', () => {
  it('names no API base in code or templates', () => {
    const offenders = readdirSync(dir)
      .filter((file) => file.endsWith('.ts') && !/\.test(-helpers)?\.ts$/.test(file))
      .filter((file) =>
        /\/api\/|api\/v1|\/account-api|\/content-api/.test(
          stripComments(readFileSync(join(dir, file), 'utf8'))
        )
      );
    expect(offenders).toEqual([]);
  });
});
