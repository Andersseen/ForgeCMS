import { Injectable, computed, inject, signal } from '@angular/core';
import type { Signal } from '@angular/core';
import { CmsApiService } from './api.service.js';
import type { AuthUser } from './types.js';

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
      }
    });
  }

  /** Resolves once the initial session bootstrap has settled past `'loading'`. */
  ready(): Promise<void> {
    return this.bootstrap;
  }

  /** Re-runs the `/api/auth/me` bootstrap. */
  async refresh(): Promise<void> {
    this.statusState.set('loading');
    this.errorState.set(null);
    try {
      const user = await this.api.getCurrentUser();
      this.userState.set(user);
      this.statusState.set(user ? 'authenticated' : 'anonymous');
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
    } catch (err) {
      this.userState.set(null);
      this.statusState.set('anonymous');
      this.errorState.set(err instanceof Error ? err : new Error('Login failed'));
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
    } catch (err) {
      this.userState.set(null);
      this.statusState.set('anonymous');
      this.errorState.set(err instanceof Error ? err : new Error('Signup failed'));
    }
  }

  /** Never throws — local state clears even if the network request fails. */
  async logout(): Promise<void> {
    try {
      await this.api.logout();
    } catch {
      // The point of logging out client-side is to stop presenting this browser as authenticated,
      // which must not depend on the network round trip succeeding.
    } finally {
      this.userState.set(null);
      this.statusState.set('anonymous');
      this.errorState.set(null);
      this.expiredState.set(false);
    }
  }
}
