import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ForgeAuthSession } from '@forge-cms/angular';
import { VoltButton, VoltCard, VoltError, VoltInput, VoltLabel } from '@voltui/components';
import { LmnEyeIcon, LmnEyeSlashIcon } from 'lumen-icons';
import { safeAdminRedirect } from './safe-redirect.js';

/**
 * Reusable sign-in page for `@forge-cms/admin` consumers, replacing the app-local login page every
 * host previously hand-rolled (spec 054). Trusts the `forge_session` cookie the server sets on success
 * (`ForgeAuthSession.login`) — never touches `localStorage`/`sessionStorage`.
 */
@Component({
  selector: 'forge-sign-in',
  standalone: true,
  imports: [
    RouterLink,
    VoltButton,
    VoltCard,
    VoltInput,
    VoltLabel,
    VoltError,
    LmnEyeIcon,
    LmnEyeSlashIcon
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex min-h-screen items-center justify-center bg-background p-4">
      <volt-card class="w-full max-w-sm space-y-5 p-6">
        <div>
          <h1 class="text-lg font-semibold">Sign in</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            Enter your email and password to continue.
          </p>
        </div>

        @if (session.expired()) {
          <div class="rounded-md border border-border bg-muted p-3 text-xs text-muted-foreground">
            Your session has expired — please sign in again.
          </div>
        }

        <form class="space-y-4" (submit)="onSubmit($event)">
          <div class="space-y-1.5">
            <volt-label htmlFor="forge-signin-email">Email</volt-label>
            <volt-input
              id="forge-signin-email"
              type="email"
              autocomplete="email"
              [value]="email()"
              (valueChange)="email.set($event)"
            />
          </div>
          <div class="space-y-1.5">
            <volt-label htmlFor="forge-signin-password">Password</volt-label>
            <div class="relative">
              <volt-input
                id="forge-signin-password"
                [type]="showPassword() ? 'text' : 'password'"
                autocomplete="current-password"
                [value]="password()"
                (valueChange)="password.set($event)"
              />
              <button
                type="button"
                class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'"
                (click)="showPassword.set(!showPassword())"
              >
                @if (showPassword()) {
                  <lmn-eye-slash [size]="16" />
                } @else {
                  <lmn-eye [size]="16" />
                }
              </button>
            </div>
          </div>

          @if (session.error(); as error) {
            <volt-error role="alert">{{ error.message }}</volt-error>
          }

          <volt-button type="submit" class="w-full" [disabled]="session.loading()">
            {{ session.loading() ? 'Signing in…' : 'Sign in' }}
          </volt-button>
        </form>

        @if (signUpPath(); as path) {
          <p class="text-center text-sm text-muted-foreground">
            Don't have an account?
            <a [routerLink]="path" class="font-medium text-foreground hover:underline">Sign up</a>
          </p>
        }
      </volt-card>
    </div>
  `
})
export class ForgeSignInComponent {
  /** Route to a sign-up page. Omit (the default) to render no sign-up link at all. */
  readonly signUpPath = input<string>();
  /** Where to land after a successful sign-in when no `returnUrl` query param is present. Defaults
   *  to `/admin`. Deliberately not an `input()` default value: Angular Router's
   *  `withComponentInputBinding()` calls `setInput(name, data[name])` for every declared input on
   *  every route-data emission, which overwrites an `input()` default with `undefined` the moment a
   *  route-instantiated component like this one activates with no matching route data/param/query key
   *  — the fallback has to be applied on read instead. */
  readonly redirectTo = input<string>();

  protected readonly session = inject(ForgeAuthSession);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly showPassword = signal(false);

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    await this.session.login(this.email(), this.password());
    if (this.session.authenticated()) {
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
      const fallback = safeAdminRedirect(this.redirectTo(), '/admin');
      await this.router.navigateByUrl(safeAdminRedirect(returnUrl, fallback));
    }
  }
}
