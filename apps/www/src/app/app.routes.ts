import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/landing.page').then((m) => m.LandingPage)
  },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage)
  },
  {
    path: 'admin',
    loadComponent: () => import('@forge-cms/admin').then((m) => m.ForgeAdminLayoutComponent),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/admin/dashboard/dashboard.page').then((m) => m.DashboardPage)
      },
      {
        path: 'collections',
        loadComponent: () =>
          import('./pages/admin/collections/collections.page').then((m) => m.CollectionsPage)
      },
      {
        path: 'collections/:slug',
        loadComponent: () =>
          import('./pages/admin/collections/collection-detail.page').then(
            (m) => m.CollectionDetailPage
          )
      },
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
  },
  { path: '**', redirectTo: '', pathMatch: 'full' }
];
