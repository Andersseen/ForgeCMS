---
'@forge-cms/angular': patch
---

Fixed a production-only crash (`Error: JIT compiler unavailable`) triggered the first time
`CmsApiService` was injected anywhere in `apps/www`'s admin UI. The package built with plain `tsc`,
so `@Injectable({ providedIn: 'root' })` was never processed by Angular's compiler — it shipped as a
raw, un-linked decorator that only resolves via Angular's JIT compiler at runtime. AOT production
builds don't load `@angular/compiler`, so the decorator's lazy `ɵprov` getter threw on first
resolution.

Switched the build to `ngc` with `angularCompilerOptions.compilationMode: "partial"` (consistent with
`@forge-cms/admin`), so `CmsApiService` ships a real (partial-Ivy) `ɵprov`. `apps/www` resolves the
partial declaration at build time via a new Angular linker Vite plugin (`apps/www/vite-plugins/angular-linker.ts`,
using `@angular/compiler-cli/linker/babel` — the officially documented way to run the linker outside
the Angular CLI). That same plugin also links any other partial-Ivy dependency in the graph
(`@forge-cms/admin`, and third-party libraries like `@voltui/components`), without requiring any of
those libraries to change their compilation mode.
