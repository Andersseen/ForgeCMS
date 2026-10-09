---
title: Admin UI
description: The admin components you import, how to configure the sidebar, and what is still app-local.
group: Client & deploy
order: 2
---

`@forge-cms/admin` is not a mounted black box — it is a set of Angular components and route helpers you
compose into your own router. The URLs, the guards and the API locations stay yours.

Peer dependencies: `@angular/cdk`, `@voltui/components`, `lumen-icons`, `rxjs` (plus Angular itself).

## Mounting the admin

The whole reusable admin — sign-in, shell, collections, the document editor and the users workspace —
is route composition, with no host-written CRUD or auth code:

```ts
// admin.routes.ts — lazy-loaded under whatever path you choose, e.g. `{ path: 'admin', loadChildren }`
import type { Routes } from '@angular/router';
import {
  ForgeAdminLayoutComponent,
  ForgeUsersWorkspaceComponent,
  forgeAdminAuthRoutes,
  forgeAdminContentRoutes
} from '@forge-cms/admin';
import { forgeAuthGuard } from '@forge-cms/angular';

export const ADMIN_ROUTES: Routes = [
  ...forgeAdminAuthRoutes({ signup: false }), // login (+ signup when true)
  {
    path: '',
    component: ForgeAdminLayoutComponent,
    canActivate: [forgeAuthGuard()],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'collections' },
      ...forgeAdminContentRoutes(), // collections, collections/:collection(/new|/:id)
      {
        path: 'users',
        component: ForgeUsersWorkspaceComponent,
        canActivate: [forgeAuthGuard({ roles: ['admin'] })]
      }
    ]
  }
];
```

`forgeAdminContentRoutes()` and `forgeAdminAuthRoutes()` return **relative** subtrees, so they work
wherever you nest them. `/admin` is only the default _assumption_ the pieces make about where you did.

### Mounting somewhere other than `/admin`

Say the admin lives at `/studio` (or a nested `/ops/cms`). Tell the pieces that name a URL where that is,
using the same path everywhere:

```ts
const MOUNT = '/studio';

export const ADMIN_ROUTES: Routes = [
  ...forgeAdminAuthRoutes({ signup: true, basePath: MOUNT }),
  {
    path: '',
    component: ForgeAdminLayoutComponent,
    data: { config: { title: 'Studio', basePath: MOUNT } satisfies ForgeAdminConfig },
    canActivate: [forgeAuthGuard({ signInPath: `${MOUNT}/login`, forbiddenPath: MOUNT })],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'collections' },
      ...forgeAdminContentRoutes(),
      {
        path: 'users',
        component: ForgeUsersWorkspaceComponent,
        canActivate: [
          forgeAuthGuard({ roles: ['admin'], signInPath: `${MOUNT}/login`, forbiddenPath: MOUNT })
        ]
      }
    ]
  }
];
```

- `basePath` (`ForgeAdminConfig.basePath` and `forgeAdminAuthRoutes({ basePath })`) is a same-app
  absolute path; a trailing slash is ignored. It roots the breadcrumbs, the built-in nav, the default
  sign-in path (`{basePath}/login`), and where sign-in/sign-up land. A return URL is honoured only if
  it is `basePath` itself or a real child (`/studio/...`) — never `/admin/...`, `/studio-evil`,
  `//host` or `https://…`. `forgeAdminAuthRoutes` throws on an invalid value.
- `forgeAuthGuard()` takes the existing `signInPath` / `forbiddenPath` options (defaults
  `/admin/login` and `/admin`).
- The layout's config is also found by the collections index when you set it as route `data.config`
  on the layout route, as above.
- Where the **APIs** live is a separate matter and only `provideForgeCms()` knows it:
  `provideForgeCms({ baseUrl: '/content-api', authBaseUrl: '/account-api', credentials: 'include' })`.
  The admin package contains no API URL of its own.
- Use `withComponentInputBinding()` in `provideRouter(...)`: route `data` reaches the sign-in page and
  the layout as component inputs.

## Configuring the shell

```ts
import { type ForgeAdminConfig } from '@forge-cms/admin';

const adminConfig: ForgeAdminConfig = {
  title: 'Lumea Admin',
  nav: [
    {
      label: 'Content',
      items: [
        { label: 'Dashboard', routerLink: '/admin', icon: 'dashboard', exact: true },
        { label: 'Bookings', routerLink: '/admin/collections/bookings', icon: 'collections' },
        { label: 'Media', routerLink: '/admin/media', icon: 'media' }
      ]
    },
    {
      label: 'Access',
      items: [{ label: 'Users', routerLink: '/admin/users', icon: 'users', adminOnly: true }]
    }
  ]
};
```

| Key                | Default             | Effect                                                                         |
| ------------------ | ------------------- | ------------------------------------------------------------------------------ |
| `title`            | `ForgeCMS`          | Sidebar heading.                                                               |
| `basePath`         | `/admin`            | Mount root (above).                                                            |
| `nav`              | `DEFAULT_ADMIN_NAV` | Sidebar groups. Your links are used as written — spell the mount into them.    |
| `collections`      | all                 | Slugs (`{ slug }`) shown on the collections index, in that order.              |
| `signInPath`       | `{basePath}/login`  | "Log in" link and post-logout destination (e.g. a branded top-level `/login`). |
| `logo`, `features` | —                   | **Deprecated, no effect.** Kept for compatibility; removed after 1.0.          |

The default nav lists only what the package itself mounts: **Collections** and an admin-only **Users**.
A dashboard, media library, API or settings page is yours — add it to `nav` (the `dashboard`, `media`,
`api`, `settings` and `analytics` icons are drawn by the package). `adminOnly: true` hides an item from
non-admins.

## Document list

```html
<forge-collection-list
  [collection]="collection()"
  [documents]="documents()"
  [meta]="meta()"
  [sort]="sort()"
  [readOnly]="!canWrite()"
  (create)="openCreate()"
  (edit)="openEdit($event)"
  (delete)="remove($event)"
  (sortChange)="sort.set($event)"
  (pageChange)="page.set($event)"
  (statusChange)="publish($event)"
/>
```

Schema-driven: it renders columns from the collection metadata, with per-kind cells (dates, booleans,
relations, uploads as thumbnails, richtext as plain text), sorting, pagination, and — on a
`drafts: true` collection — a status column with publish-in-place.

## Schema-driven form

```html
<forge-collection-form
  [fields]="collection().fieldDefinitions"
  [initialValue]="editing() ?? {}"
  [fieldErrors]="fieldErrors()"
  submitLabel="Save"
  (save)="submit($event)"
  (cancel)="close()"
/>
```

The form is a loop over `ForgeFieldControlComponent`, which recurses into itself for `group`,
`array` and `blocks` — so arbitrary nesting renders, with add/remove row and a block-type picker.
Values flow strictly upward: a nested control emits, the owning branch merges into a fresh object and
re-emits, so the form value stays immutable.

Widgets: `ForgeRelationPickerComponent` (server-side search), `ForgeUploadPickerComponent` (preview,
upload, library), `ForgeRichTextEditorComponent` (block editor with a JSON fallback).

`fieldErrors` takes `{ fieldName: message }` — map it from an `ApiValidationError`'s `details` to
show server-side validation inline.

## State components

`PageHeaderComponent`, `LoadingStateComponent`, `ErrorStateComponent`, `EmptyStateComponent` — so a
page that lists documents does not have to reinvent four states.

## Helpers

```ts
import {
  documentLabel,
  documentImageUrl,
  richTextToPlainText,
  shortId,
  truncate
} from '@forge-cms/admin';
```

`documentLabel(doc)` picks a human label from a document (title, name, filename, …) — useful in
relation pickers and breadcrumbs.

## What is still app-local

Dashboards and the media, API and settings **pages** are not in the package — `apps/www` and
`apps/demo-aesthetics` have their own to copy as a starting point. The reusable **users workspace**
(`ForgeUsersWorkspaceComponent`) _is_ in the package and needs only the auth-API routes. Forge Analytics
(`forgeAdminAnalyticsRoutes()`) is public but **experimental** and outside the 1.0 stability guarantee.

Still missing in the package: a WYSIWYG richtext editor, saved filters, bulk actions, configurable
columns, conditional fields and live preview.

## Building against it

Both admin packages compile in Angular's **partial** mode, so the consuming app's build must run the
Angular linker. Use the one ForgeCMS ships — do not copy a private plugin:

```ts
// vite.config.ts
import { angularLinker } from '@forge-cms/admin/vite'; // or '@forge-cms/angular/vite' — the same plugin

export default defineConfig({ plugins: [angularLinker() /* , analog() … */] });
```

It needs `@angular/compiler-cli`, `@babel/core` and `vite` (all optional peers). Without the linker,
production AOT builds crash at runtime with `Error: JIT compiler unavailable`.
