---
'@forge-cms/admin': patch
'@forge-cms/angular': patch
---

Fix mismatched Angular peer dependency pins that caused pnpm to install a second, duplicate copy of `@angular/common`/`@angular/platform-browser` inside any app depending on `@forge-cms/admin` (e.g. `apps/demo-aesthetics`). The duplicate copy's DOM adapter was never initialized by `bootstrapApplication`, so `PlatformLocation.getBaseHrefFromDOM()` threw `Cannot read properties of null (reading 'getBaseHref')` at runtime — reproduced in production on `/login` at `forge-cms-demo.pages.dev`. `@forge-cms/admin` and `@forge-cms/angular` now pin `@angular/*` peers to `21.2.10`, matching every consumer app, and `@forge-cms/admin` now declares `@angular/platform-browser` as an explicit peer so it dedupes against the host app's copy instead of resolving its own via a transitive `@angular/cdk` peer requirement.
