import type { Routes } from '@angular/router';
import {
  ForgeAdminLayoutComponent,
  ForgeUsersWorkspaceComponent,
  forgeAdminAuthRoutes,
  forgeAdminContentRoutes
} from '@forge-cms/admin';
import { forgeAuthGuard } from '@forge-cms/angular';

/**
 * `admin/login` (public signup is opt-in server-side only — see `signup.post.ts` — so it isn't
 * mounted client-side here, per spec 054 §7) plus a guarded subtree for everything else. The layout
 * (header + sidebar) only wraps the guarded content, matching `forgeAuthGuard()`'s own doc comment: an
 * anonymous visitor never sees the shell flash before being redirected to sign in.
 */
export const ADMIN_ROUTES: Routes = [
  ...forgeAdminAuthRoutes({ signup: false }),
  {
    path: '',
    component: ForgeAdminLayoutComponent,
    canActivate: [forgeAuthGuard()],
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
        component: ForgeUsersWorkspaceComponent,
        canActivate: [forgeAuthGuard({ roles: ['admin'] })]
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
