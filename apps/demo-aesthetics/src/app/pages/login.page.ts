import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ForgeAuthSession } from '@forge-cms/angular';
import { VoltButton, VoltCard, VoltError, VoltInput, VoltLabel } from '@voltui/components';

const DEMO_EMAIL = 'demo@lumea.clinic';
const DEMO_PASSWORD = 'lumea-demo';

@Component({
  selector: 'lumea-login-page',
  standalone: true,
  imports: [RouterLink, VoltButton, VoltCard, VoltInput, VoltLabel, VoltError],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex min-h-screen items-center justify-center bg-background p-4">
      <volt-card class="w-full max-w-sm space-y-5 p-6">
        <div>
          <h1 class="lumea-display text-xl">Lumea staff area</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            The clinic's content, bookings and team live behind this login.
          </p>
        </div>

        <div
          class="space-y-1 rounded-md border border-border bg-muted p-3 text-xs text-muted-foreground"
        >
          <p>
            Admin — <span class="font-medium text-foreground">{{ demoEmail }}</span> /
            <span class="font-medium text-foreground">{{ demoPassword }}</span>
          </p>
          <p>
            Front desk (editor) —
            <span class="font-medium text-foreground">frontdesk&#64;lumea.clinic</span> /
            <span class="font-medium text-foreground">lumea-desk</span>
          </p>
        </div>

        <form class="space-y-4" (submit)="submit($event)">
          <div class="space-y-1.5">
            <volt-label htmlFor="email">Email</volt-label>
            <volt-input
              id="email"
              type="email"
              autocomplete="email"
              [value]="email()"
              (valueChange)="email.set($event)"
            />
          </div>
          <div class="space-y-1.5">
            <volt-label htmlFor="password">Password</volt-label>
            <volt-input
              id="password"
              type="password"
              autocomplete="current-password"
              [value]="password()"
              (valueChange)="password.set($event)"
            />
          </div>

          @if (session.error(); as error) {
            <volt-error role="alert">{{ error.message }}</volt-error>
          }

          <volt-button type="submit" class="w-full" [disabled]="session.loading()">
            {{ session.loading() ? 'Signing in…' : 'Sign in' }}
          </volt-button>
        </form>

        <a
          routerLink="/"
          class="block text-center text-xs text-muted-foreground hover:text-foreground"
        >
          ← Back to the site
        </a>
      </volt-card>
    </div>
  `
})
/**
 * The clinic's own sign-in screen. It stays app-local rather than `forgeAdminAuthRoutes()` because a
 * public demo has to print its accounts next to the form; the session itself is the package's
 * cookie-based `ForgeAuthSession` (spec 054) — nothing is written to `localStorage`.
 */
export class LoginPage {
  protected readonly session = inject(ForgeAuthSession);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly demoEmail = DEMO_EMAIL;
  protected readonly demoPassword = DEMO_PASSWORD;

  protected readonly email = signal(DEMO_EMAIL);
  protected readonly password = signal(DEMO_PASSWORD);

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    await this.session.login(this.email(), this.password());
    if (!this.session.authenticated()) return;

    // `forgeAuthGuard` sends visitors here with `?returnUrl=`; only follow it inside the admin.
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    const inAdmin = returnUrl === '/admin' || returnUrl?.startsWith('/admin/') === true;
    await this.router.navigateByUrl(inAdmin && returnUrl ? returnUrl : '/admin');
  }
}
