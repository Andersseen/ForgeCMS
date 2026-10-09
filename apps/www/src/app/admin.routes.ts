import type { Routes } from '@angular/router';
import {
  type ForgeAdminConfig,
  ForgeAdminLayoutComponent,
  ForgeUsersWorkspaceComponent,
  forgeAdminAuthRoutes,
  forgeAdminContentRoutes
} from '@forge-cms/admin';
import { forgeAuthGuard } from '@forge-cms/angular';

/**
 * Dashboard, media, API and settings are this app's own pages, so the nav lists them explicitly —
 * the package's default nav only offers destinations the package itself mounts (spec 087).
 */
const ADMIN_CONFIG: ForgeAdminConfig = {
  nav: [
    {
      label: 'Content',
      items: [
        { label: 'Dashboard', routerLink: '/admin', icon: 'dashboard', exact: true },
        { label: 'Collections', routerLink: '/admin/collections', icon: 'collections' },
        { label: 'Media Library', routerLink: '/admin/media', icon: 'media' }
      ]
    },
    {
      label: 'Users & Access',
      items: [
        { label: 'Users', routerLink: '/admin/users', icon: 'users', adminOnly: true },
        { label: 'API', routerLink: '/admin/api', icon: 'api' }
      ]
    },
    {
      label: 'System',
      items: [{ label: 'Settings', routerLink: '/admin/settings', icon: 'settings' }]
    }
  ]
};

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
    data: { config: ADMIN_CONFIG },
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
