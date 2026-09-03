import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { ForgeAuthSession } from './auth-session.js';
import { userRole, type UserRole } from './types.js';

export interface ForgeAuthGuardOptions {
  /** Restrict to these roles on top of "must be authenticated". Omit to allow any authenticated user. */
  roles?: UserRole[];
  /** Redirect target for an anonymous visitor. Defaults to `'/admin/login'`. */
  signInPath?: string;
  /** Redirect target for an authenticated visitor failing the role check. Defaults to `'/admin'`. */
  forbiddenPath?: string;
}

/**
 * Functional Angular Router guard (`CanActivateFn`) gating access on {@link ForgeAuthSession}. This is
 * UX, not security — every check here is redundant with, never a substitute for, the server's own
 * `access`/`requireRole` enforcement (spec 053), which runs regardless of whether this guard exists.
 *
 * Awaits `session.ready()` (the session's *shared* bootstrap promise) rather than calling `refresh()`,
 * so several guarded route subtrees active at once still resolve exactly one `/api/auth/me` call, and a
 * page reload never flashes an anonymous state before the real session status is known.
 */
export function forgeAuthGuard(options?: ForgeAuthGuardOptions): CanActivateFn {
  return async (_route, state) => {
    const session = inject(ForgeAuthSession);
    const router = inject(Router);

    await session.ready();

    if (!session.authenticated()) {
      return router.createUrlTree([options?.signInPath ?? '/admin/login'], {
        queryParams: { returnUrl: state.url }
      });
    }

    if (options?.roles && !options.roles.includes(userRole(session.user()))) {
      return router.createUrlTree([options?.forbiddenPath ?? '/admin']);
    }

    return true;
  };
}
