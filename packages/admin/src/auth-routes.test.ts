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
    expect(login?.data).toEqual({ signUpPath: 'signup' });
    expect(signup?.component).toBe(ForgeSignUpComponent);
  });
});
