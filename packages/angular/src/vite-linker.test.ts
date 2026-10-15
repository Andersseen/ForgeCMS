import { describe, expect, it } from 'vitest';
import { angularLinker } from './vite-linker.js';

describe('angularLinker', () => {
  it('bundles Forge Angular packages in SSR builds so the server code is linked too (spec 078)', () => {
    const config = angularLinker().config as () => { ssr: { noExternal: string[] } };
    expect(config().ssr.noExternal).toEqual(['@forge-cms/angular', '@forge-cms/admin']);
  });

  const transform = angularLinker().transform as unknown as (
    code: string,
    id: string
  ) => Promise<{ code: string } | null>;

  it('leaves non-JavaScript modules and already-linked code alone', async () => {
    expect(await transform('export const a = 1;', '/src/app.ts')).toBeNull();
    expect(await transform('export const a = 1;', '/x/file.css?inline')).toBeNull();
    expect(await transform('export const a = 1;', '/node_modules/lib/index.mjs')).toBeNull();
  });

  it('links a partially compiled declaration', async () => {
    const code = [
      "import * as i0 from '@angular/core';",
      'class A {}',
      'A.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "21.0.0", ngImport: i0, type: A, deps: [], target: i0.ɵɵFactoryTarget.Injectable });'
    ].join('\n');
    const result = await transform(code, '/node_modules/@forge-cms/angular/dist/a.js?v=1');
    expect(result?.code).toBeDefined();
    expect(result?.code).not.toContain('ɵɵngDeclareFactory');
    expect(result?.code).toContain('A_Factory');
  });
});
