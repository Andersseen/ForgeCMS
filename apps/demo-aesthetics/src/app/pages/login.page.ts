import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CmsApiService } from '@forge-cms/angular';
import { VoltButton, VoltCard, VoltError, VoltInput, VoltLabel } from '@voltui/components';
import { AUTH_TOKEN_KEY } from '../auth-token';

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
              [value]="email()"
              (valueChange)="email.set($event)"
            />
          </div>
          <div class="space-y-1.5">
            <volt-label htmlFor="password">Password</volt-label>
            <volt-input
              id="password"
              type="password"
              [value]="password()"
              (valueChange)="password.set($event)"
            />
          </div>

          @if (error(); as message) {
            <volt-error>{{ message }}</volt-error>
          }

          <volt-button type="submit" class="w-full" [disabled]="loading()">
            {{ loading() ? 'Signing in…' : 'Sign in' }}
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
export class LoginPage {
  private readonly api = inject(CmsApiService);
  private readonly router = inject(Router);

  protected readonly demoEmail = DEMO_EMAIL;
  protected readonly demoPassword = DEMO_PASSWORD;

  protected readonly email = signal(DEMO_EMAIL);
  protected readonly password = signal(DEMO_PASSWORD);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    this.loading.set(true);
    this.error.set(null);

    try {
      const { token } = await this.api.login(this.email(), this.password());
      localStorage.setItem(AUTH_TOKEN_KEY, token);
      await this.router.navigate(['/admin']);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Login failed');
    } finally {
      this.loading.set(false);
    }
  }
}
