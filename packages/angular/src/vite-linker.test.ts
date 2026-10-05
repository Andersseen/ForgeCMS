import { describe, expect, it } from 'vitest';
import { angularLinker } from './vite-linker.js';

describe('angularLinker', () => {
  it('bundles Forge Angular packages in SSR builds so the server code is linked too (spec 078)', () => {
    const config = angularLinker().config as () => { ssr: { noExternal: string[] } };
    expect(config().ssr.noExternal).toEqual(['@forge-cms/angular', '@forge-cms/admin']);
  });
});
