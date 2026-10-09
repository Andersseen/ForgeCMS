import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import type { Routes } from '@angular/router';
import { forgeAuthGuard, provideForgeCms, type ForgeAuthGuardOptions } from '@forge-cms/angular';
import {
  DEFAULT_ADMIN_NAV,
  forgeAdminAnalyticsRoutes,
  forgeAdminAuthRoutes,
  forgeAdminContentRoutes,
  type ForgeAdminAuthRoutesOptions,
  type ForgeAdminConfig
} from './index.js';

/**
 * Spec 087: the signatures and defaults the 1.0 surface freezes (docs/1.0-PUBLIC-SURFACE.md). The API
 * baseline only records export _names_; these pin the shapes. A compile error here is a contract change.
 */
describe('frozen 1.0 admin signatures', () => {
  it('the custom-mount composition compiles and the helpers return Routes', () => {
    const config: ForgeAdminConfig = {
      title: 'Studio',
      basePath: '/studio',
      signInPath: '/studio/login',
      collections: [{ slug: 'posts' }],
      nav: [
        { label: 'Content', items: [{ label: 'Posts', routerLink: '/studio/collections/posts' }] }
      ]
    };
    const authOptions: ForgeAdminAuthRoutesOptions = { signup: true, basePath: '/studio' };
    const guardOptions: ForgeAuthGuardOptions = {
      roles: ['admin'],
      signInPath: '/studio/login',
      forbiddenPath: '/studio'
    };
    const routes: Routes = [
      ...forgeAdminAuthRoutes(authOptions),
      {
        path: '',
        data: { config },
        canActivate: [forgeAuthGuard(guardOptions)],
        children: [...forgeAdminContentRoutes(), ...forgeAdminAnalyticsRoutes()]
      }
    ];
    expect(routes.length).toBeGreaterThan(1);
    expect(provideForgeCms({ baseUrl: '/content-api', authBaseUrl: '/account-api' })).toBeDefined();
  });

  it('the legacy /admin composition compiles with no new options', () => {
    const routes: Routes = [...forgeAdminAuthRoutes(), ...forgeAdminContentRoutes()];
    expect(routes.map((route) => route.path)).toEqual([
      'login',
      'collections',
      'collections/:collection'
    ]);
    const legacy: ForgeAdminConfig = {
      title: 'Admin',
      nav: DEFAULT_ADMIN_NAV,
      signInPath: '/login'
    };
    expect(legacy.nav).toBe(DEFAULT_ADMIN_NAV);
  });

  it('content routes are relative and keep the editor children', () => {
    const [index, workspace] = forgeAdminContentRoutes();
    expect(index?.path).toBe('collections');
    expect(workspace?.children?.map((child) => child.path)).toEqual(['new', ':id']);
    expect(forgeAdminContentRoutes().every((route) => !route.path?.startsWith('/'))).toBe(true);
  });
});
