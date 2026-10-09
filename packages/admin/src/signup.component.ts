import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  DestroyRef,
  inject,
  input,
  signal
} from '@angular/core';
import { afterNextRenderIfAlive } from './after-render.js';
import { Router } from '@angular/router';
import { ForgeAuthSession } from '@forge-cms/angular';
import { VoltButton, VoltCard, VoltInput } from '@voltui/components';
import { LmnEyeIcon, LmnEyeSlashIcon } from 'lumen-icons';
import { describeSessionError } from './admin-error.js';
import { normalizeAdminBasePath } from './mount-path.js';

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
  imports: [VoltButton, VoltCard, VoltInput, LmnEyeIcon, LmnEyeSlashIcon],
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

        <form class="space-y-4" novalidate (submit)="onSubmit($event)">
          <div class="space-y-1.5">
            <label for="forge-signup-name" class="text-sm font-medium leading-none text-foreground"
              >Name</label
            >
            <volt-input
              [id]="'forge-signup-name'"
              autocomplete="name"
              [value]="name()"
              (valueChange)="name.set($event)"
            />
          </div>
          <div class="space-y-1.5">
            <label for="forge-signup-email" class="text-sm font-medium leading-none text-foreground"
              >Email</label
            >
            <volt-input
              [id]="'forge-signup-email'"
              type="email"
              autocomplete="email"
              [value]="email()"
              (valueChange)="email.set($event)"
            />
          </div>
          <div class="space-y-1.5">
            <label
              for="forge-signup-password"
              class="text-sm font-medium leading-none text-foreground"
              >Password</label
            >
            <div class="relative">
              <volt-input
                [id]="'forge-signup-password'"
                [type]="showPassword() ? 'text' : 'password'"
                autocomplete="new-password"
                [value]="password()"
                (valueChange)="password.set($event)"
              />
              <button
                type="button"
                class="absolute right-2 top-1/2 -translate-y-1/2 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            <p class="text-sm font-medium text-error" role="alert">{{ describeError(error) }}</p>
          }
          <p class="sr-only" role="status">{{ session.loading() ? 'Please wait…' : '' }}</p>

          <volt-button type="submit" class="w-full" [disabled]="session.loading()">
            {{ session.loading() ? 'Creating account…' : 'Create account' }}
          </volt-button>
        </form>
      </volt-card>
    </div>
  `
})
export class ForgeSignUpComponent {
  /** Where to land after a successful signup. Defaults to the mount root (`/admin`). Not an `input()` default value —
   *  see `ForgeSignInComponent.redirectTo`'s doc comment for why. */
  readonly redirectTo = input<string>();
  /** The admin mount root (`forgeAdminAuthRoutes({ basePath })` supplies it). Defaults to `/admin`;
   *  it is where signup lands when `redirectTo` is not set. */
  readonly basePath = input<string>();

  protected readonly session = inject(ForgeAuthSession);
  protected readonly describeError = describeSessionError;

  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly showPassword = signal(false);

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.session.loading()) return;
    const name = this.name().trim();
    await this.session.signup({
      email: this.email(),
      password: this.password(),
      ...(name && { name })
    });
    if (this.session.authenticated()) {
      await this.router.navigateByUrl(this.redirectTo() ?? normalizeAdminBasePath(this.basePath()));
      return;
    }
    // The submit button was disabled while the request ran, which dropped focus: put it back on the form.
    afterNextRenderIfAlive(this.injector, this.destroyRef, () =>
      this.host.nativeElement.querySelector<HTMLElement>('#forge-signup-email')?.focus()
    );
  }
}
