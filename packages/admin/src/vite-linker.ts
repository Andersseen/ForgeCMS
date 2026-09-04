import * as babel from '@babel/core';
import angularLinkerPlugin from '@angular/compiler-cli/linker/babel';
import { needsLinking } from '@angular/compiler-cli/linker';
import type { Plugin } from 'vite';

const JS_FILE = /\.[cm]?js$/;

/**
 * A Vite plugin required by every app that consumes `@forge-cms/admin` (or any other Angular
 * library built with `compilationMode: "partial"`, the recommended mode for anything published to
 * npm since it isn't pinned to one exact Angular compiler version). Partial-Ivy libraries ship
 * `ɵɵngDeclareComponent`-style calls that must be resolved by the Angular linker at each consuming
 * app's build time — the Angular CLI runs this automatically, Vite does not. Omitting it produces a
 * production-only `Error: JIT compiler unavailable` crash, because AOT production builds tree-shake
 * `@angular/compiler` out entirely, so Angular's runtime JIT fallback for an unlinked declaration has
 * nothing to fall back to.
 *
 * Add it to `vite.config.ts` (before `@analogjs/platform`'s `analog()`/`@angular/build`'s plugin):
 *
 * ```ts
 * import { angularLinker } from '@forge-cms/admin/vite';
 *
 * export default defineConfig({
 *   plugins: [angularLinker(), analog(), ...]
 * });
 * ```
 *
 * Requires `@angular/compiler-cli` and `@babel/core` in the consumer's own devDependencies (both are
 * optional peer dependencies of this package — only needed if this subpath is actually imported).
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
