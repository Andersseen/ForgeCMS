import type { Routes } from '@angular/router';
import {
  ForgeAdminLayoutComponent,
  ForgeUsersWorkspaceComponent,
  forgeAdminAuthRoutes,
  forgeAdminContentRoutes
} from '@forge-cms/admin';
import { forgeAuthGuard } from '@forge-cms/angular';

/**
 * Exactly the composition ForgeCMS's public API already provides — no host-written CRUD or auth
 * glue. Proves brief section 7 / spec 055's acceptance criterion 10 (reusable protected admin
 * routing works with zero additional abstraction).
 */
export const ADMIN_ROUTES: Routes = [
  ...forgeAdminAuthRoutes({ signup: true }),
  {
    path: '',
    component: ForgeAdminLayoutComponent,
    canActivate: [forgeAuthGuard()],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'collections' },
      ...forgeAdminContentRoutes(),
      {
        path: 'users',
        component: ForgeUsersWorkspaceComponent,
        canActivate: [forgeAuthGuard({ roles: ['admin'] })]
      }
    ]
  }
];
