import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/home.page').then((m) => m.HomePage)
  },
  {
    path: 'posts/:slug',
    loadComponent: () => import('./pages/post-detail.page').then((m) => m.PostDetailPage)
  },
  {
    path: 'setup',
    loadComponent: () => import('./pages/setup.page').then((m) => m.SetupPage)
  },
  {
    path: 'admin',
    loadChildren: () => import('./admin.routes').then((m) => m.ADMIN_ROUTES)
  },
  { path: '**', redirectTo: '', pathMatch: 'full' }
];
