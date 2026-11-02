import analog from '@analogjs/platform';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { angularLinker } from '@forge-cms/admin/vite';
import { escapeCodespans } from './vite-plugins/escape-codespans';
import { CANONICAL_ORIGIN } from './src/app/site-config.mjs';
import { prerenderRoutes } from './scripts/public-routes.mjs';

// Spec 101: every public page once per locale it really exists in (translated docs only where a
// `src/content/<locale>/docs/<slug>.md` exists), plus the English 404 page.
const publicRoutes = [...prerenderRoutes(import.meta.dirname), '/404.html'];

export default defineConfig(({ mode }) => ({
  plugins: [
    angularLinker(),
    analog({
      // Keep the local e2e renderer client-only; production builds still prerender/hydrate the
      // public routes. This avoids a Volt tabs hydration mismatch in Analog's development server.
      ssr: mode === 'production',
      // Only the public, source-controlled site is generated at build time. Nitro remains enabled
      // for APIs and request-time routes; private admin routes stay client-rendered.
      prerender: { routes: publicRoutes },
      nitro: {
        preset: 'cloudflare-pages',
        routeRules: { '/admin/**': { ssr: false } }
      },
      // Parses `src/content/**/*.md` at build time (marked + Prism), so `/docs` ships pre-rendered,
      // pre-highlighted HTML instead of a markdown parser. See docs/specs/043.
      content: { highlighter: 'prism', markedOptions: { extensions: [escapeCodespans] } }
    }),
    tailwindcss(),
    tsconfigPaths(),
    {
      name: 'forge-site-origin',
      transformIndexHtml(html) {
        return html.replaceAll('%SITE_ORIGIN%', CANONICAL_ORIGIN);
      }
    }
  ],
  optimizeDeps: {
    include: [
      '@angular/common',
      '@angular/core',
      '@angular/platform-browser',
      '@angular/router',
      'rxjs'
    ],
    exclude: ['@angular/compiler']
  },
  ssr: {
    noExternal: ['@angular/**']
  },
  test: {
    include: ['src/**/*.test.ts', 'vite-plugins/**/*.test.ts'],
    environment: 'jsdom',
    // `@angular/**` is inlined (ssr.noExternal above); Etyma's Angular bindings must share that one
    // `@angular/core` instance, or DI sees two cores in the router tests (spec 101).
    server: { deps: { inline: [/@etyma\/angular/] } }
  }
}));
