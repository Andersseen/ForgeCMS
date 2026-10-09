import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { forgeAdminAuthRoutes } from './auth-routes.js';
import { ForgeSignInComponent } from './signin.component.js';
import { ForgeSignUpComponent } from './signup.component.js';

describe('forgeAdminAuthRoutes', () => {
  it('mounts only "login" by default — no signup route at all', () => {
    const routes = forgeAdminAuthRoutes();

    expect(routes).toHaveLength(1);
    const login = routes.find((route) => route.path === 'login');
    expect(login?.component).toBe(ForgeSignInComponent);
    expect(routes.find((route) => route.path === 'signup')).toBeUndefined();
  });

  it('does not pass a signUpPath to the login route when signup is disabled', () => {
    const [login] = forgeAdminAuthRoutes();
    expect(login?.data?.['signUpPath']).toBeUndefined();
  });

  it('mounts "signup" and wires signUpPath when signup: true', () => {
    const routes = forgeAdminAuthRoutes({ signup: true });

    const login = routes.find((route) => route.path === 'login');
    const signup = routes.find((route) => route.path === 'signup');
    expect(signup?.component).toBe(ForgeSignUpComponent);
    // `../signup`, not `signup`: `login` and `signup` are siblings in this same route array, but
    // ForgeSignInComponent's `[routerLink]` resolves relative to its own activated route (`login`)
    // — an unprefixed `signup` would append as *login's own child* (`/admin/login/signup`, not a
    // registered route) instead of reaching the sibling. Real bug, found building spec 055's fixture.
    expect(login?.data).toEqual({ signUpPath: '../signup' });
  });

  it('threads a custom basePath into both pages and rejects an invalid one (spec 087)', () => {
    const routes = forgeAdminAuthRoutes({ signup: true, basePath: '/studio/' });
    expect(routes.find((r) => r.path === 'login')?.data).toEqual({
      signUpPath: '../signup',
      basePath: '/studio'
    });
    expect(routes.find((r) => r.path === 'signup')?.data).toEqual({ basePath: '/studio' });
    expect(() => forgeAdminAuthRoutes({ basePath: 'https://evil.example' })).toThrow(/basePath/);
    expect(forgeAdminAuthRoutes()[0]?.data).toBeUndefined();
  });
});
