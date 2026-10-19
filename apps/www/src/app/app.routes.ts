import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'ForgeCMS — the Angular-native headless CMS',
    data: {
      description:
        'ForgeCMS is the Angular-native, TypeScript code-first headless CMS. Model content in code, use the Local API, and give editors a reusable Angular admin. Stable 1.0.0.'
    },
    loadComponent: () => import('./pages/landing.page').then((m) => m.LandingPage)
  },
  {
    path: 'demo',
    title: 'Demo — ForgeCMS',
    data: {
      description:
        'Explore Lumea, a working clinic site built with ForgeCMS. Browse its content and admin workflow, including treatments, staff, bookings, and a journal.'
    },
    loadComponent: () => import('./pages/demo.page').then((m) => m.DemoPage)
  },
  {
    path: 'privacy',
    title: 'Privacy — ForgeCMS',
    data: {
      description:
        'Learn about optional, consent-gated audience measurement on the ForgeCMS website and how to change your choice.'
    },
    loadComponent: () => import('./pages/privacy.page').then((m) => m.PrivacyPage)
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
    title: 'Admin — ForgeCMS',
    data: { robots: 'noindex, nofollow' },
    loadChildren: () => import('./admin.routes').then((m) => m.ADMIN_ROUTES)
  },
  {
    path: '**',
    title: 'Page not found — ForgeCMS',
    data: { robots: 'noindex, nofollow' },
    loadComponent: () => import('./pages/not-found.page').then((m) => m.NotFoundPage)
  }
];
