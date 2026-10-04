import * as babel from '@babel/core';
import angularLinkerPlugin from '@angular/compiler-cli/linker/babel';
import { needsLinking } from '@angular/compiler-cli/linker';
import type { Plugin } from 'vite';

const JS_FILE = /\.[cm]?js$/;

/**
 * A Vite plugin required by every Vite/Analog app that consumes `@forge-cms/angular` or
 * `@forge-cms/admin` (or any other Angular library built with `compilationMode: "partial"`, the
 * recommended mode for anything published to npm since it isn't pinned to one exact Angular compiler
 * version). Partial-Ivy libraries ship `ɵɵngDeclareFactory`/`ɵɵngDeclareComponent`-style calls that
 * must be resolved by the Angular linker at each consuming app's build time. The Angular CLI links
 * every dependency; Analog's Vite plugin only links Angular Package Format files (`fesm2022/`), and
 * Forge's packages are plain `ngc` output. Omitting it produces a production-only
 * `Error: JIT compiler unavailable` crash, because AOT production builds tree-shake `@angular/compiler`
 * out entirely, so Angular's runtime JIT fallback for an unlinked declaration has nothing to fall back
 * to. `pnpm release:compat` (spec 077) proves a bundle built with it has no partial declarations left.
 *
 * Add it to `vite.config.ts` (before `@analogjs/platform`'s `analog()`/`@angular/build`'s plugin):
 *
 * ```ts
 * import { angularLinker } from '@forge-cms/angular/vite';
 *
 * export default defineConfig({
 *   plugins: [angularLinker(), analog(), ...]
 * });
 * ```
 *
 * `@forge-cms/admin/vite` re-exports the same plugin. Requires `@angular/compiler-cli`, `@babel/core`
 * and `vite` in the consumer's own devDependencies (optional peer dependencies of this package — only
 * needed if this subpath is actually imported).
 */
export function angularLinker(): Plugin {
  return {
    name: 'forge-cms:angular-linker',
    async transform(code, id) {
      const path = id.split('?')[0] ?? id;
      if (!JS_FILE.test(path) || !needsLinking(path, code)) {
        return null;
      }

      const result = await babel.transformAsync(code, {
        filename: path,
        babelrc: false,
        configFile: false,
        compact: false,
        sourceMaps: true,
        plugins: [[angularLinkerPlugin, { linkerJitMode: false }]]
      });

      if (!result?.code) {
        return null;
      }

      return { code: result.code, map: result.map };
    }
  };
}
