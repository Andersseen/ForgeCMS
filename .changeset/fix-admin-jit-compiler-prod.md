---
'@forge-cms/admin': patch
---

Fixed a production-only crash (`Error: JIT compiler unavailable`) affecting every `@forge-cms/admin`
component. The package built with `angularCompilerOptions.compilationMode: "partial"`, which requires
the consuming app's build tooling to run the Angular linker over `node_modules`. `apps/www`'s
Vite/Analog.js build has no linker step, so unlinked `ɵɵngDeclareComponent` calls shipped to
production, where AOT builds tree-shake out `@angular/compiler` and Angular's runtime JIT fallback
throws on first use of any component. Switched to `compilationMode: "full"` so components ship
fully-compiled Ivy definitions that need no downstream linking.

Note: the same issue affects `@voltui/components` (published separately); it needs `>=0.6.1` for this
fix to take full effect in `apps/www`.
