import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { StrataDocumentNavigator } from '@strata-sc/server-components/navigation';

/** Only same-app paths are accepted as a post-login destination (no open redirect). */
const SAFE_RETURN = /^\/(?:posts\/[a-z0-9-]+)?$/;

/** A conventional Angular page posting to ForgeCMS's native login route. */
@Component({
  selector: 'app-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <main id="login">
      <h1>Editor sign-in</h1>
      <form (submit)="$event.preventDefault(); submit(email.value, password.value)">
        <label
          >Email <input #email name="email" type="email" autocomplete="username" required
        /></label>
        <label
          >Password
          <input #password name="password" type="password" autocomplete="current-password" required
        /></label>
        <button type="submit" data-login-submit [disabled]="pending()">Sign in</button>
      </form>
      <output data-login-result aria-live="polite">{{ message() }}</output>
      <p><a routerLink="/">Back to the desk</a></p>
    </main>
  `
})
export default class LoginPage {
  private readonly navigator = inject(StrataDocumentNavigator);
  private readonly returnTo = inject(ActivatedRoute).snapshot.queryParamMap.get('returnTo') ?? '/';
  protected readonly pending = signal(false);
  protected readonly message = signal('');

  protected async submit(email: string, password: string): Promise<void> {
    if (this.pending()) return;
    this.pending.set(true);
    this.message.set('');
    try {
      const response = await fetch('/api/account/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      if (!response.ok) {
        this.message.set('Sign-in failed.');
        return;
      }
      this.navigator.navigate(SAFE_RETURN.test(this.returnTo) ? this.returnTo : '/');
    } catch {
      this.message.set('Sign-in is unavailable right now.');
    } finally {
      this.pending.set(false);
    }
  }
}
