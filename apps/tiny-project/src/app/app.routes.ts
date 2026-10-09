import type { Routes } from '@angular/router';
import { CmsApiService, provideForgeCms } from '@forge-cms/angular';

export const routes: Routes = [
  {
    // The public site reads as an anonymous visitor in the browser and during SSR alike, whoever is
    // signed in: its own `CmsApiService` that never sends the session cookie (drafts and the author's
    // `users` record stay hidden from an editor browsing the public pages too). On the server the render
    // forwards no identity anyway (`provideForgeCmsServer` in main.server.ts, no `forwardCookies`).
    path: '',
    providers: [
      provideForgeCms({
        baseUrl: '/api/content',
        authBaseUrl: '/api/account',
        credentials: 'omit'
      }),
      CmsApiService
    ],
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () => import('./pages/home.page').then((m) => m.HomePage)
      },
      {
        path: 'posts/:slug',
        loadComponent: () => import('./pages/post-detail.page').then((m) => m.PostDetailPage)
      }
    ]
  },
  {
    path: 'setup',
    loadComponent: () => import('./pages/setup.page').then((m) => m.SetupPage)
  },
  {
    path: 'studio',
    loadChildren: () => import('./admin.routes').then((m) => m.ADMIN_ROUTES)
  },
  { path: '**', redirectTo: '', pathMatch: 'full' }
];
