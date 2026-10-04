import { Injectable, computed, inject, signal } from '@angular/core';
import type { Signal } from '@angular/core';
import { CmsApiService } from './api.service.js';
import { credentialBoundary } from './credentials.js';
import { ForgeApiError, type AuthUser } from './types.js';

export type ForgeAuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'error';

/**
 * Signals-based browser session state, cookie-first (spec 053's `forge_session`). Bootstraps once via
 * `GET /api/auth/me` and keeps that promise around so `forgeAuthGuard` (`auth-guard.ts`) never triggers
 * a second bootstrap just because more than one guarded route mounted — a page refresh does exactly one
 * session check no matter how many guards are active.
 */
@Injectable({ providedIn: 'root' })
export class ForgeAuthSession {
  private readonly api = inject(CmsApiService);

  private readonly userState = signal<AuthUser | null>(null);
  private readonly statusState = signal<ForgeAuthStatus>('loading');
  private readonly errorState = signal<Error | null>(null);
  private readonly expiredState = signal(false);

  readonly user: Signal<AuthUser | null> = this.userState.asReadonly();
  readonly status: Signal<ForgeAuthStatus> = this.statusState.asReadonly();
  readonly error: Signal<Error | null> = this.errorState.asReadonly();
  readonly expired: Signal<boolean> = this.expiredState.asReadonly();

  readonly authenticated = computed(() => this.statusState() === 'authenticated');
  readonly loading = computed(() => this.statusState() === 'loading');

  /** The initial bootstrap — `ready()` returns this same promise, never triggers a second one. */
  private readonly bootstrap: Promise<void>;

  /**
   * Resources commit only against the current credential revision (spec 077). Every identity change
   * this session controls invalidates it, so no resource keeps or accepts another identity's data.
   */
  private readonly credentials = credentialBoundary(this.api);
  /** `undefined` until the first `/me` settles: learning who is signed in is not an identity change. */
  private knownUserId: string | null | undefined = undefined;

  constructor() {
    this.bootstrap = this.refresh();

    // A 401 observed anywhere while we believe the session is authenticated means it no longer is —
    // no extra `/me` round trip, and a 403 (a single forbidden operation) never reaches this callback
    // (CmsApiService only calls its 401 listeners for a 401, never a 403 — see api.service.ts).
    this.api.onUnauthorized(() => {
      if (this.statusState() === 'authenticated') {
        this.userState.set(null);
        this.statusState.set('anonymous');
        this.expiredState.set(true);
        this.identityChanged(null);
      }
    });
  }

  /** Resolves once the initial session bootstrap has settled past `'loading'`. */
  ready(): Promise<void> {
    return this.bootstrap;
  }

  /**
   * Re-runs the `/me` bootstrap. `401` → `'anonymous'`; any other failure (`403`, `5xx`, network,
   * malformed response) → `'error'` with the `ForgeApiError` in {@link error} — an outage never
   * pretends the visitor signed out. The previously known user is kept on failure.
   */
  async refresh(): Promise<void> {
    this.statusState.set('loading');
    this.errorState.set(null);
    try {
      const user = await this.api.getCurrentUser();
      this.userState.set(user);
      this.statusState.set(user ? 'authenticated' : 'anonymous');
      // The first answer only reveals who the existing cookie belongs to; a later different answer
      // (another tab signed in or out) is an identity change.
      if (this.knownUserId === undefined) this.knownUserId = user?.id ?? null;
      else this.identityChanged(user?.id ?? null);
    } catch (err) {
      this.errorState.set(err instanceof Error ? err : new Error('Failed to load session'));
      this.statusState.set('error');
    }
  }

  /**
   * Never throws — check `authenticated()`/`error()` afterwards. Sets state directly from the
   * response's `user`, no follow-up `/me` call.
   */
  async login(email: string, password: string): Promise<void> {
    this.statusState.set('loading');
    this.errorState.set(null);
    try {
      const { user } = await this.api.login(email, password);
      this.userState.set(user);
      this.statusState.set('authenticated');
      this.expiredState.set(false);
      this.identityChanged(user.id, true);
    } catch (err) {
      this.userState.set(null);
      this.statusState.set('anonymous');
      this.errorState.set(err instanceof Error ? err : new Error('Login failed'));
      this.identityChanged(null);
    }
  }

  /** Same contract as {@link login}. The signup input never carries a `role`. */
  async signup(input: { email: string; password: string; name?: string }): Promise<void> {
    this.statusState.set('loading');
    this.errorState.set(null);
    try {
      const { user } = await this.api.signup(input);
      this.userState.set(user);
      this.statusState.set('authenticated');
      this.expiredState.set(false);
      this.identityChanged(user.id, true);
    } catch (err) {
      this.userState.set(null);
      this.statusState.set('anonymous');
      this.errorState.set(err instanceof Error ? err : new Error('Signup failed'));
      this.identityChanged(null);
    }
  }

  /**
   * Never throws. Local state always clears — this browser stops presenting itself as signed in even if
   * the request fails. If the server call fails, `status()` is `'anonymous'` but {@link error} holds the
   * `ForgeApiError`: the server session (or its cookie) may still exist, so a UI must not report a clean
   * sign-out. On success `error()` is `null`.
   */
  async logout(): Promise<void> {
    let failure: Error | null = null;
    try {
      await this.api.logout();
    } catch (err) {
      failure =
        err instanceof Error
          ? err
          : new ForgeApiError({ kind: 'network', code: 'NETWORK_ERROR', message: 'Logout failed' });
    } finally {
      this.userState.set(null);
      this.statusState.set('anonymous');
      this.errorState.set(failure);
      this.expiredState.set(false);
      // Always: even a failed request may have cleared the cookie, and this browser stopped
      // presenting the previous user either way.
      this.identityChanged(null, true);
    }
  }

  /**
   * Records the identity the browser now presents and invalidates resources when it differs from the
   * last known one. `always` is for a successful login/signup/logout: the session cookie itself
   * was replaced, even when the user id happens to be the same.
   */
  private identityChanged(userId: string | null, always = false): void {
    const previous = this.knownUserId;
    this.knownUserId = userId;
    if (always || (previous !== undefined && previous !== userId)) this.credentials.invalidate();
  }
}
