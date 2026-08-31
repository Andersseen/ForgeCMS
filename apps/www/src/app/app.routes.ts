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
    // The shell (header + sidebar) stays mounted across pages so the sidebar keeps its scroll.
    path: 'docs',
    loadComponent: () => import('./pages/docs/docs.page').then((m) => m.DocsPage),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'introduction' },
      {
        path: ':slug',
        loadComponent: () => import('./pages/docs/docs-article.page').then((m) => m.DocsArticlePage)
      }
    ]
  },
  {
    path: 'admin',
    loadChildren: () => import('./admin.routes').then((m) => m.ADMIN_ROUTES)
  },
  { path: '**', redirectTo: '', pathMatch: 'full' }
];
