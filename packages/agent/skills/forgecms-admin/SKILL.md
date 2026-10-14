---
name: forgecms-admin
description: Mount and configure the reusable ForgeCMS Angular admin - routes, base path (for example /studio), users workspace, navigation, direct component composition and client-specific pages.
---

# ForgeCMS admin (`@forge-cms/admin`)

The admin is a set of reusable Angular components and route factories. It supports **Angular ^21.2** (not Angular 22 yet) and needs the peers `@angular/cdk`, `rxjs`, `@voltui/components` and `lumen-icons`. It contains no API URL: `provideForgeCms()` is the only place that names the APIs.

## Required wiring

- `provideRouter(routes, withComponentInputBinding())` - route data reaches the pages as component inputs. Without it the admin breaks.
- The official linker in Vite: `angularLinker()` from `@forge-cms/admin/vite`.

## Default mount (`/admin`)

```ts
export const ADMIN_ROUTES: Routes = [
  ...forgeAdminAuthRoutes(), // /admin/login
  {
    path: '',
    component: ForgeAdminLayoutComponent,
    data: { config: { title: 'My site' } },
    canActivate: [forgeAuthGuard()],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'collections' },
      ...forgeAdminContentRoutes() // /collections, /collections/:collection, .../new, .../:id
    ]
  }
];
// app.routes.ts:  { path: 'admin', loadChildren: () => import('./admin.routes').then((m) => m.ADMIN_ROUTES) }
```

## Another mount (for example `/studio`)

Use one constant everywhere: `forgeAdminAuthRoutes({ signup: true, basePath: MOUNT })`, the layout `data: { config: { title, basePath: MOUNT } satisfies ForgeAdminConfig }`, and `forgeAuthGuard({ signInPath: `${MOUNT}/login`, forbiddenPath: MOUNT })`. `basePath` must be a same-app absolute path; the return URL after sign-in is honoured only inside it. The mounted `app.routes.ts` path must match.

## Users workspace and navigation

- Add `{ path: 'users', component: ForgeUsersWorkspaceComponent, canActivate: [forgeAuthGuard({ roles: ['admin'], ... })] }` for user management and keep it **admin-only**.
- The default navigation is built in; a host may define its own navigation items (`routerLink`, `label`, `icon`) in the layout config. Client-specific pages (dashboard, settings, media tools) are plain Angular routes the host adds around Forge's reusable parts.
- You may compose components directly (`ForgeCollectionWorkspaceComponent`, `ForgeCollectionFormComponent`...) instead of the route factories.
- The form warns about **unsaved changes** before navigating away; do not bypass it.

## Do not

- Do not present a visual page builder as existing: the developer owns the site UI; the client edits **content** here.
- Do not use `ForgeAdminConfig.logo` / `.features` (deprecated no-ops).
- Do not run the admin on Angular 22 or without the peer dependencies.
- Do not hardcode API URLs inside admin pages.
