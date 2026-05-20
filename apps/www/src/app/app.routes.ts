import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/landing.page').then(m => m.LandingPage),
  },
  {
    path: 'admin',
    loadComponent: () => import('./layouts/admin/admin.layout').then(m => m.AdminLayout),
    children: [
      {
        path: '',
        loadComponent: () => import('./pages/admin/dashboard/dashboard.page').then(m => m.DashboardPage),
      },
      {
        path: 'collections',
        loadComponent: () => import('./pages/admin/collections/collections.page').then(m => m.CollectionsPage),
      },
      {
        path: 'media',
        loadComponent: () => import('./pages/admin/media/media.page').then(m => m.MediaPage),
      },
      {
        path: 'users',
        loadComponent: () => import('./pages/admin/users/users.page').then(m => m.UsersPage),
      },
      {
        path: 'api',
        loadComponent: () => import('./pages/admin/api/api.page').then(m => m.ApiPage),
      },
      {
        path: 'settings',
        loadComponent: () => import('./pages/admin/settings/settings.page').then(m => m.SettingsPage),
      },
    ],
  },
  { path: '**', redirectTo: '', pathMatch: 'full' },
];
