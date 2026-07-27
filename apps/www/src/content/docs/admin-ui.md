---
title: Admin UI
description: The admin components you import, how to configure the sidebar, and what is still app-local.
group: Client & deploy
order: 2
---

`@forge-cms/admin` is not a mounted black box — it is a set of Angular components you import into
your own routes. The pages, the data fetching and the URLs stay yours.

Peer dependencies: `@voltui/components`, `lumen-icons`, `rxjs`.

## Layout

```ts
// app.routes.ts
{
  path: 'admin',
  loadComponent: () => import('@forge-cms/admin').then((m) => m.ForgeAdminLayoutComponent),
  children: [
    { path: '', loadComponent: () => import('./pages/admin/dashboard.page').then((m) => m.DashboardPage) },
    { path: 'collections/:slug', loadComponent: () => import('./pages/admin/collection-detail.page').then((m) => m.CollectionDetailPage) }
  ]
}
```

The layout renders the sidebar, breadcrumbs, theme toggle, the current user and login/logout.

## Configuring the sidebar

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

Omit `nav` and you get `DEFAULT_ADMIN_NAV` (dashboard, collections, media, users, api, settings) —
fine for a demo, wrong for a real app whose editors actually open a booking inbox every morning.
`adminOnly: true` hides an item from non-admins. Icons are drawn by the package, so your app does not
import an icon library: `dashboard`, `collections`, `media`, `users`, `api`, `settings`.

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

The dashboard, media, users, API and settings **pages** are not in the package — they live in
`apps/www` and `apps/demo-aesthetics`. Copy them as a starting point rather than expecting them from
the import.

Still missing in the package: a WYSIWYG richtext editor, saved filters, bulk actions, configurable
columns, conditional fields and live preview.

## Building against it

Both admin packages compile in Angular's **partial** mode, which means the consuming app's build must
run the Angular linker. Analog/Vite does not do that out of the box — `apps/www` adds
`vite-plugins/angular-linker.ts` (running `@angular/compiler-cli/linker/babel` over any dependency
file that needs linking). Without it, production AOT builds crash at runtime with
`Error: JIT compiler unavailable`. Copy that plugin when you wire the admin into another Vite app.
