import type { Routes } from '@angular/router';
import {
  ForgeUsersWorkspaceComponent,
  forgeAdminAnalyticsRoutes,
  forgeAdminContentRoutes
} from '@forge-cms/admin';
import { forgeAuthGuard } from '@forge-cms/angular';

/** The clinic keeps its branded `/login` (it prints the demo accounts), so the guards point there. */
const SIGN_IN_PATH = '/login';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/site/site-shell.component').then((m) => m.SiteShell),
    children: [
      {
        path: '',
        loadComponent: () => import('./pages/site/home.page').then((m) => m.HomePage)
      },
      {
        path: 'services',
        loadComponent: () => import('./pages/site/services.page').then((m) => m.ServicesPage)
      },
      {
        path: 'services/:slug',
        loadComponent: () =>
          import('./pages/site/service-detail.page').then((m) => m.ServiceDetailPage)
      },
      {
        path: 'team',
        loadComponent: () => import('./pages/site/team.page').then((m) => m.TeamPage)
      },
      {
        path: 'journal',
        loadComponent: () => import('./pages/site/journal.page').then((m) => m.JournalPage)
      },
      {
        path: 'journal/:slug',
        loadComponent: () => import('./pages/site/post-detail.page').then((m) => m.PostDetailPage)
      },
      {
        path: 'booking',
        loadComponent: () => import('./pages/site/booking.page').then((m) => m.BookingPage)
      }
    ]
  },
  {
    path: 'login',
    loadComponent: () => import('./pages/login.page').then((m) => m.LoginPage)
  },
  {
    path: 'admin',
    loadComponent: () => import('@forge-cms/admin').then((m) => m.ForgeAdminLayoutComponent),
    // Sidebar title *and* navigation come from the app (spec 042): a clinic opens the booking
    // inbox every morning, so that is the first item, and there is no "API Keys" page to link to.
    data: {
      config: {
        title: 'Lumea Aesthetics',
        // The branded `/login` stays top-level, so the shared layout is told where "Log in" and
        // post-logout go instead of assuming `forgeAdminAuthRoutes()`'s `/admin/login`.
        signInPath: SIGN_IN_PATH,
        nav: [
          {
            label: 'Clinic',
            items: [
              { label: 'Overview', routerLink: '/admin', icon: 'dashboard', exact: true },
              { label: 'Bookings', routerLink: '/admin/collections/bookings', icon: 'collections' },
              {
                label: 'Treatments',
                routerLink: '/admin/collections/services',
                icon: 'collections'
              }
            ]
          },
          {
            label: 'Content',
            items: [
              {
                label: 'All collections',
                routerLink: '/admin/collections',
                icon: 'collections',
                exact: true
              },
              { label: 'Media', routerLink: '/admin/media', icon: 'media', exact: true },
              // Forge Analytics (spec 057, experimental) — opt-in, not part of DEFAULT_ADMIN_NAV.
              { label: 'Analytics', routerLink: '/admin/analytics', icon: 'analytics', exact: true }
            ]
          },
          {
            label: 'Administration',
            items: [
              {
                label: 'Staff accounts',
                routerLink: '/admin/users',
                icon: 'users',
                adminOnly: true,
                exact: true
              },
              { label: 'API', routerLink: '/admin/api', icon: 'api', exact: true },
              {
                label: 'Clinic settings',
                routerLink: '/admin/settings',
                icon: 'settings',
                exact: true
              }
            ]
          }
        ]
      }
    },
    // Guarded as a whole: an anonymous visitor is sent to `/login?returnUrl=…` before any admin
    // request is made. UX only — every write is still decided by the server's access rules.
    canActivate: [forgeAuthGuard({ signInPath: SIGN_IN_PATH })],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/admin/dashboard.page').then((m) => m.AdminDashboardPage)
      },
      // The collections index, list (drafts, publish-from-row, sort, pagination) and document editor
      // come from the package (spec 052); the clinic only supplies the sidebar that links into them.
      ...forgeAdminContentRoutes(),
      {
        path: 'media',
        loadComponent: () => import('./pages/admin/media.page').then((m) => m.AdminMediaPage)
      },
      // Forge Analytics (spec 057, experimental) — reusable route from @forge-cms/admin.
      ...forgeAdminAnalyticsRoutes(),
      {
        path: 'users',
        component: ForgeUsersWorkspaceComponent,
        canActivate: [forgeAuthGuard({ signInPath: SIGN_IN_PATH, roles: ['admin'] })]
      },
      {
        path: 'api',
        loadComponent: () => import('./pages/admin/api.page').then((m) => m.AdminApiPage)
      },
      {
        path: 'settings',
        loadComponent: () => import('./pages/admin/settings.page').then((m) => m.AdminSettingsPage)
      }
    ]
  },
  { path: '**', redirectTo: '', pathMatch: 'full' }
];
