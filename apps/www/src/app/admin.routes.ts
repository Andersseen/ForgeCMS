import type { Routes } from '@angular/router';
import { ForgeAdminLayoutComponent, forgeAdminContentRoutes } from '@forge-cms/admin';

/**
 * The whole `/admin` section as one lazily-loaded chunk (matching the previous behaviour, where
 * everything under `/admin` was already pulled in together the moment `@forge-cms/admin` was
 * imported for the layout). `forgeAdminContentRoutes()` (spec 052) replaces this app's own
 * `collections`/`collections/:slug` pages — it wires the same URLs to the package's reusable
 * collections index, collection workspace, and document editor.
 */
export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    component: ForgeAdminLayoutComponent,
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/admin/dashboard/dashboard.page').then((m) => m.DashboardPage)
      },
      ...forgeAdminContentRoutes(),
      {
        path: 'media',
        loadComponent: () => import('./pages/admin/media/media.page').then((m) => m.MediaPage)
      },
      {
        path: 'users',
        loadComponent: () => import('./pages/admin/users/users.page').then((m) => m.UsersPage)
      },
      {
        path: 'api',
        loadComponent: () => import('./pages/admin/api/api.page').then((m) => m.ApiPage)
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./pages/admin/settings/settings.page').then((m) => m.SettingsPage)
      }
    ]
  }
];
