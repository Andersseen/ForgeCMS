---
'@forge-cms/admin': minor
---

Support Angular 22 in `@forge-cms/admin` (spec 103). The `@angular/{cdk,common,compiler-cli,core,forms,platform-browser,router}` peers widen from `^21.2.0` to `^21.2.0 || ^22.0.0`, the optional `@babel/core` peer to `^7.28.0 || ^8.0.0` (Angular 22.1+ links with Babel 8), and `lumen-icons` to `^0.2.0 || ^0.3.0`. Angular 21 consumers are unaffected: every existing range is still accepted and `@voltui/components` stays `^1.0.1`. On Angular 22 install `@voltui/components` 1.3.2 or newer (the first VoltUI release that peers Angular 22). `lumen-icons` 0.2.x still declares an Angular 21 peer, so a strict-peer pnpm install on Angular 22 needs `pnpm.peerDependencyRules.allowedVersions` entries for `lumen-icons>@angular/core` and `lumen-icons>@angular/common` until `lumen-icons` 0.3 is published.
