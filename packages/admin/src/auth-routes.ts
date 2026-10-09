import type { Routes } from '@angular/router';
import { parseAdminBasePath } from './mount-path.js';
import { ForgeSignInComponent } from './signin.component.js';
import { ForgeSignUpComponent } from './signup.component.js';

export interface ForgeAdminAuthRoutesOptions {
  /** Mount the sign-up route. Defaults to `false` — structurally absent unless enabled, matching the
   *  server's own `handleSignup` opt-in default (spec 054 §7). */
  signup?: boolean;
  /**
   * Where the admin is mounted (spec 087), e.g. `/studio`. Successful sign-in/sign-up lands there and
   * a `returnUrl` is honoured only under it. Defaults to `/admin`. Use the same value as
   * `ForgeAdminConfig.basePath` and the `forgeAuthGuard()` paths. Throws on an invalid mount root.
   */
  basePath?: string;
}

/**
 * The sign-in (and optional sign-up) routes, following the same zero-assumption convention as
 * `forgeAdminContentRoutes()` — no base path, no host component, meant to be spread into a host's own
 * `Routes` alongside a guarded content subtree:
 *
 * ```ts
 * {
 *   path: 'admin',
 *   children: [
 *     ...forgeAdminAuthRoutes({ signup: true }),
 *     { path: '', canActivate: [forgeAuthGuard()], children: [...forgeAdminContentRoutes()] }
 *   ]
 * }
 * ```
 */
export function forgeAdminAuthRoutes(options?: ForgeAdminAuthRoutesOptions): Routes {
  const signup = options?.signup ?? false;
  const basePath =
    options?.basePath === undefined ? undefined : parseAdminBasePath(options.basePath);
  if (options?.basePath !== undefined && basePath === null) {
    throw new Error(
      `forgeAdminAuthRoutes: basePath "${options.basePath}" must be a same-app absolute path such as "/admin" or "/studio".`
    );
  }
  const data = {
    ...(signup && { signUpPath: '../signup' }),
    ...(basePath && { basePath })
  };
  return [
    {
      path: 'login',
      component: ForgeSignInComponent,
      // `../signup`, not `signup`: `ForgeSignInComponent`'s [routerLink] resolves relative to its
      // own activated route (`login`), so an unprefixed `signup` appended as *login's own child*
      // (`/admin/login/signup`, not a registered route — a real bug found building spec 055's
      // fixture, whose "Sign up" link 404'd via the wildcard redirect) instead of the sibling route
      // `signup` actually is in the array below. `../` steps back up to the shared parent first.
      ...(Object.keys(data).length > 0 && { data })
    },
    ...(signup
      ? [
          {
            path: 'signup',
            component: ForgeSignUpComponent,
            ...(basePath && { data: { basePath } })
          }
        ]
      : [])
  ];
}
