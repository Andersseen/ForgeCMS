import type { Routes } from '@angular/router';
import { localizedRoutes } from './i18n/locale-routing';
import type { SeoRouteData } from './site-head.service';

const seo = (page: 'landing' | 'demo' | 'privacy'): { seo: SeoRouteData } => ({
  seo: { titleKey: `seo.${page}.title`, descriptionKey: `seo.${page}.description` }
});

/**
 * The public pages, served once per locale by `localizedRoutes` (spec 101): `/demo`, `/es/demo` and
 * `/uk/demo` are the same lazily loaded component. Titles and descriptions come from the catalog.
 */
const pages: Routes = [
  {
    path: '',
    pathMatch: 'full',
    data: seo('landing'),
    loadComponent: () => import('./pages/landing.page').then((m) => m.LandingPage)
  },
  {
    path: 'demo',
    data: seo('demo'),
    loadComponent: () => import('./pages/demo.page').then((m) => m.DemoPage)
  },
  {
    path: 'privacy',
    data: seo('privacy'),
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
    path: '**',
    data: { robots: 'noindex, nofollow' },
    loadComponent: () => import('./pages/not-found.page').then((m) => m.NotFoundPage)
  }
];

/** Private routes: English-only and never prerendered (spec 101 keeps the admin out of i18n). */
const outside: Routes = [
  {
    path: 'admin',
    title: 'Admin — ForgeCMS',
    data: { robots: 'noindex, nofollow' },
    loadChildren: () => import('./admin.routes').then((m) => m.ADMIN_ROUTES)
  }
];

export const routes: Routes = localizedRoutes(pages, outside);
