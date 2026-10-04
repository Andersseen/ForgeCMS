# @forge-cms/admin

Embeddable Angular admin for ForgeCMS: layout, collections index, collection workspace, document
editor, sign-in/sign-up and users workspace, plus the route helpers `forgeAdminContentRoutes()` and
`forgeAdminAuthRoutes()`. Built on `@forge-cms/angular`.

```sh
pnpm add @forge-cms/admin @forge-cms/angular @voltui/components lumen-icons @angular/cdk
```

Guide: https://forge-cms.pages.dev/docs/small-project-guide

## Compatibility

Peers: `@angular/{common,core,forms,platform-browser,router}` `^21.2.0`, `rxjs` `^7.8.0`,
`@voltui/components` `^1.0.1`, `lumen-icons` `^0.2.0`; optional `@angular/compiler-cli` `^21.2.0`,
`@babel/core` `^7.28.0` and `vite` `^7.0.0 || ^8.0.0` for the linker. Proven by strict packed-consumer
builds (`pnpm release:compat`: Angular 21.2.0, 21.2.10 and 21.2.25). Angular 22 is not supported yet:
VoltUI 1.x peers `@angular/* ^21.2.0`. VoltUI's dependency `ng-primitives` also needs `@angular/cdk`.

Vite/Analog apps must add the Angular linker (the same plugin as `@forge-cms/angular/vite`):

```ts
import { angularLinker } from '@forge-cms/admin/vite';

export default defineConfig({ plugins: [angularLinker(), analog()] });
```
