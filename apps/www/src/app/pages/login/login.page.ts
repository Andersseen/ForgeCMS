import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CmsApiService } from '@forge-cms/angular';
import { VoltButton, VoltCard, VoltError, VoltInput, VoltLabel } from '@voltui/components';

const DEMO_EMAIL = 'demo@forgecms.dev';
const DEMO_PASSWORD = 'forgecms-demo';

@Component({
  selector: 'forge-cms-login-page',
  standalone: true,
  imports: [VoltButton, VoltCard, VoltInput, VoltLabel, VoltError],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex min-h-screen items-center justify-center bg-background p-4">
      <volt-card class="w-full max-w-sm space-y-5 p-6">
        <div>
          <h1 class="text-lg font-semibold">Log in to ForgeCMS</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            Reads stay open to everyone; log in to create, edit, or delete documents.
          </p>
        </div>

        <div class="rounded-md border border-border bg-muted p-3 text-xs text-muted-foreground">
          Demo credentials — <span class="font-medium text-foreground">{{ demoEmail }}</span> /
          <span class="font-medium text-foreground">{{ demoPassword }}</span>
        </div>

        <form class="space-y-4" (submit)="onSubmit($event)">
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
            {{ loading() ? 'Logging in…' : 'Log in' }}
          </volt-button>
        </form>
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

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.loading.set(true);
    this.error.set(null);

    try {
      const { token } = await this.api.login(this.email(), this.password());
      localStorage.setItem('forge-auth-token', token);
      await this.router.navigate(['/admin/collections']);
    } catch {
      this.error.set('Invalid email or password.');
    } finally {
      this.loading.set(false);
    }
  }
}
