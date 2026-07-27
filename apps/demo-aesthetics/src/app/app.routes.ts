import type { Routes } from '@angular/router';

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
              { label: 'All collections', routerLink: '/admin/collections', icon: 'collections' },
              { label: 'Media', routerLink: '/admin/media', icon: 'media' }
            ]
          },
          {
            label: 'Administration',
            items: [
              {
                label: 'Staff accounts',
                routerLink: '/admin/users',
                icon: 'users',
                adminOnly: true
              },
              { label: 'API', routerLink: '/admin/api', icon: 'api' },
              { label: 'Clinic settings', routerLink: '/admin/settings', icon: 'settings' }
            ]
          }
        ]
      }
    },
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/admin/dashboard.page').then((m) => m.AdminDashboardPage)
      },
      {
        path: 'collections',
        loadComponent: () =>
          import('./pages/admin/collections.page').then((m) => m.AdminCollectionsPage)
      },
      {
        path: 'collections/:slug',
        loadComponent: () =>
          import('./pages/admin/collection-detail.page').then((m) => m.AdminCollectionDetailPage)
      },
      {
        path: 'media',
        loadComponent: () => import('./pages/admin/media.page').then((m) => m.AdminMediaPage)
      },
      {
        path: 'users',
        loadComponent: () => import('./pages/admin/users.page').then((m) => m.AdminUsersPage)
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
