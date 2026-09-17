import type { Routes } from '@angular/router';

/**
 * Experimental, opt-in analytics route subtree (spec 057). Nothing is added to
 * `DEFAULT_ADMIN_NAV` — a host spreads this into its own admin children *and* adds its own nav item,
 * the same opt-in shape as `forgeAdminContentRoutes()`:
 *
 * ```ts
 * {
 *   path: 'admin',
 *   component: ForgeAdminLayoutComponent,
 *   children: [...forgeAdminContentRoutes(), ...forgeAdminAnalyticsRoutes()]
 * }
 * ```
 *
 * Uses `loadComponent`, not `component:` — unlike `forgeAdminContentRoutes()`, this can't assume
 * every consumer isolates its whole admin subtree behind its own lazy `loadChildren` boundary the way
 * `apps/www`/`apps/tiny-project` do. `apps/demo-aesthetics` builds its admin children directly inside
 * an eagerly-loaded root `app.routes.ts`, and a static `component:` reference there pulled the whole
 * dashboard (and its `VoltCard`/loading-state/error-state imports) into the public site's entry
 * chunk — caught by inspecting the built output, not by any test.
 */
export function forgeAdminAnalyticsRoutes(): Routes {
  return [
    {
      path: 'analytics',
      loadComponent: () =>
        import('./analytics-dashboard.component.js').then((m) => m.ForgeAnalyticsDashboardComponent)
    }
  ];
}
