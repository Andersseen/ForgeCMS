import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

/**
 * First-run admin bootstrap — the UI half of `POST /api/bootstrap-admin` (see that route's own
 * comment for why this is app-local, not a new Forge capability). Once an admin exists, the route
 * answers 409 and this page shows a message instead of a form — there is no separate "is this
 * installation already initialized?" check to keep in sync with the create route's own guard.
 */
@Component({
  selector: 'tiny-setup-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Create the first admin</h1>

    @if (alreadyInitialized()) {
      <p>This installation already has an admin. <a href="/admin/login">Sign in</a> instead.</p>
    } @else {
      <form class="tiny-form" (submit)="submit($event)">
        <label>
          Email
          <input type="email" name="email" required autocomplete="username" />
        </label>
        <label>
          Password
          <input
            type="password"
            name="password"
            required
            minlength="8"
            autocomplete="new-password"
          />
        </label>
        <button type="submit" [disabled]="submitting()">Create admin</button>
        @if (error(); as message) {
          <p class="tiny-error">{{ message }}</p>
        }
      </form>
    }
  `
})
export class SetupPage {
  private readonly router = inject(Router);

  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly alreadyInitialized = signal(false);

  protected async submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    this.submitting.set(true);
    this.error.set(null);

    try {
      const res = await fetch('/api/bootstrap-admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: String(data.get('email') ?? ''),
          password: String(data.get('password') ?? '')
        })
      });

      if (res.status === 409) {
        this.alreadyInitialized.set(true);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `Request failed: ${res.status}`);
      }

      await this.router.navigateByUrl('/admin');
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      this.submitting.set(false);
    }
  }
}
