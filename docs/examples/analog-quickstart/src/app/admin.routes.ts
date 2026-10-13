import type { Routes } from '@angular/router';
import {
  ForgeAdminLayoutComponent,
  forgeAdminAuthRoutes,
  forgeAdminContentRoutes
} from '@forge-cms/admin';
import { forgeAuthGuard } from '@forge-cms/angular';

export const ADMIN_ROUTES: Routes = [
  // /admin/login
  ...forgeAdminAuthRoutes(),
  {
    path: '',
    component: ForgeAdminLayoutComponent,
    data: { config: { title: 'My site' } },
    canActivate: [forgeAuthGuard()],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'collections' },
      // /admin/collections, /admin/collections/:collection, …/new, …/:id
      ...forgeAdminContentRoutes()
    ]
  }
];
