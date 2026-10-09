import type { Routes } from '@angular/router';
import {
  type ForgeAdminConfig,
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
 *
 * Spec 087 (roadmap 0.11 / U03): this consumer deliberately mounts the admin at `/studio`, not
 * `/admin`, with its APIs at `/api/content` and `/api/account` (see `app.config.ts`), so a regression
 * back to a hardcoded `/admin` or `/api/*` fails this app's e2e instead of a customer's.
 */
const MOUNT = '/studio';

const ADMIN_CONFIG: ForgeAdminConfig = { title: 'Tiny Project', basePath: MOUNT };
const GUARD_PATHS = { signInPath: `${MOUNT}/login`, forbiddenPath: MOUNT };

export const ADMIN_ROUTES: Routes = [
  ...forgeAdminAuthRoutes({ signup: true, basePath: MOUNT }),
  {
    path: '',
    component: ForgeAdminLayoutComponent,
    data: { config: ADMIN_CONFIG },
    canActivate: [forgeAuthGuard(GUARD_PATHS)],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'collections' },
      ...forgeAdminContentRoutes(),
      {
        path: 'users',
        component: ForgeUsersWorkspaceComponent,
        canActivate: [forgeAuthGuard({ ...GUARD_PATHS, roles: ['admin'] })]
      }
    ]
  }
];
