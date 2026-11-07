import analog from '@analogjs/platform';
import { strataServerComponents } from '@strata-sc/server-components/vite';
import { createRequire } from 'node:module';
import { defineConfig } from 'vite';

/**
 * libSQL loads its native binding with a computed `require('@libsql/<platform>')` that Nitro's file
 * tracer cannot follow, so a `node-server` build would ship without it and fail at startup. Resolve the
 * binding(s) actually installed on the build machine through the real dependency chain
 * (@forge-cms/db → @libsql/client → libsql) and trace them explicitly.
 */
function libsqlNativeBindings(): string[] {
  const from = (id: string, parent: NodeRequire) => createRequire(parent.resolve(id));
  try {
    const libsql = from(
      'libsql',
      from('@libsql/client', from('@forge-cms/db', createRequire(import.meta.url)))
    );
    const platforms = [
      'darwin-arm64',
      'darwin-x64',
      'linux-x64-gnu',
      'linux-arm64-gnu',
      'linux-x64-musl',
      'linux-arm64-musl',
      'win32-x64-msvc'
    ];
    return platforms.flatMap((platform) => {
      try {
        return [libsql.resolve(`@libsql/${platform}`)];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

// Stock create-analog setup plus the Strata plugin, exactly as Strata's "Consumer setup" documents it:
//   - the Strata plugin runs before analog();
//   - ssr.noExternal: ['tslib'] (Analog/Nitro requirement for decorated server components).
// EDITORIAL_BUILD_ID gives every release a distinct build identity (SC-BUILD-IDENTITY), so a document and
// a script from two deployments are refused instead of hydrated across versions.
export default defineConfig(() => ({
  build: {
    target: ['es2020'],
    // Hidden maps are written for the confidentiality scan and never referenced from a bundle.
    sourcemap: 'hidden' as const
  },
  resolve: { mainFields: ['module'] },
  ssr: { noExternal: ['tslib'] },
  plugins: [
    strataServerComponents({
      root: import.meta.dirname,
      sourceDir: 'src/app',
      generatedDir: 'src/generated/server-components',
      buildId: process.env['EDITORIAL_BUILD_ID']
    }),
    analog({
      // Every document is rendered per request (no build-time prerender of `/`).
      prerender: { routes: [] },
      // Node (default `node-server`): libSQL is a native client, kept external and traced with its binding.
      // Cloudflare Pages (`BUILD_PRESET=cloudflare-pages`): everything is bundled into the Worker; D1 is used.
      nitro:
        process.env['BUILD_PRESET'] === 'cloudflare-pages'
          ? {}
          : { externals: { external: ['@libsql/client'], traceInclude: libsqlNativeBindings() } }
    })
  ]
}));
