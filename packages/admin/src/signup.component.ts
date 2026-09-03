import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ForgeAuthSession } from '@forge-cms/angular';
import { VoltButton, VoltCard, VoltError, VoltInput, VoltLabel } from '@voltui/components';
import { LmnEyeIcon, LmnEyeSlashIcon } from 'lumen-icons';

/**
 * Reusable, optional sign-up page for `@forge-cms/admin` consumers (spec 054). Has no `role` field —
 * structurally, not just visually: `ForgeAuthSession.signup()`'s input type has no such key, mirroring
 * the server's `handleSignup` contract, so a role can never be smuggled through this form even by a
 * DOM/value-injection attempt. Only mount this component's route when the server also has public
 * signup enabled (see `forgeAdminAuthRoutes({ signup: true })`) — a disabled server route makes this
 * component simply show its own generic error on submit, but the route itself shouldn't exist.
 */
@Component({
  selector: 'forge-sign-up',
  standalone: true,
  imports: [VoltButton, VoltCard, VoltInput, VoltLabel, VoltError, LmnEyeIcon, LmnEyeSlashIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex min-h-screen items-center justify-center bg-background p-4">
      <volt-card class="w-full max-w-sm space-y-5 p-6">
        <div>
          <h1 class="text-lg font-semibold">Create an account</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            New accounts start with read/edit access only.
          </p>
        </div>

        <form class="space-y-4" (submit)="onSubmit($event)">
          <div class="space-y-1.5">
            <volt-label htmlFor="forge-signup-name">Name</volt-label>
            <volt-input
              id="forge-signup-name"
              autocomplete="name"
              [value]="name()"
              (valueChange)="name.set($event)"
            />
          </div>
          <div class="space-y-1.5">
            <volt-label htmlFor="forge-signup-email">Email</volt-label>
            <volt-input
              id="forge-signup-email"
              type="email"
              autocomplete="email"
              [value]="email()"
              (valueChange)="email.set($event)"
            />
          </div>
          <div class="space-y-1.5">
            <volt-label htmlFor="forge-signup-password">Password</volt-label>
            <div class="relative">
              <volt-input
                id="forge-signup-password"
                [type]="showPassword() ? 'text' : 'password'"
                autocomplete="new-password"
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
            {{ session.loading() ? 'Creating account…' : 'Create account' }}
          </volt-button>
        </form>
      </volt-card>
    </div>
  `
})
export class ForgeSignUpComponent {
  /** Where to land after a successful signup. Defaults to `/admin`. Not an `input()` default value —
   *  see `ForgeSignInComponent.redirectTo`'s doc comment for why. */
  readonly redirectTo = input<string>();

  protected readonly session = inject(ForgeAuthSession);
  private readonly router = inject(Router);

  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly showPassword = signal(false);

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    const name = this.name().trim();
    await this.session.signup({
      email: this.email(),
      password: this.password(),
      ...(name && { name })
    });
    if (this.session.authenticated()) {
      await this.router.navigateByUrl(this.redirectTo() ?? '/admin');
    }
  }
}
