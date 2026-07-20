import * as babel from '@babel/core';
import angularLinkerPlugin from '@angular/compiler-cli/linker/babel';
import { needsLinking } from '@angular/compiler-cli/linker';
import type { Plugin } from 'vite';

const JS_FILE = /\.[cm]?js$/;

/**
 * Angular libraries built with `compilationMode: "partial"` (the recommended mode for anything
 * published to npm, since it isn't pinned to one exact Angular compiler version) ship
 * `ɵɵngDeclareComponent`-style calls that must be resolved by the Angular linker at each
 * consuming app's build time. The Angular CLI runs this automatically; Vite does not, so without
 * this plugin those declarations reach the production bundle unlinked. AOT production builds
 * tree-shake `@angular/compiler` out entirely, so Angular's runtime JIT fallback for unlinked
 * declarations throws `Error: JIT compiler unavailable` on first use.
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
