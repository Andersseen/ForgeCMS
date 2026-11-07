import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RESPONSE } from '@analogjs/router/tokens';
import { RouterLink } from '@angular/router';

/** Unknown document URLs answer a real HTTP 404, not a 200 shell. */
@Component({
  selector: 'app-not-found-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `<main id="not-found">
    <h1>Page not found</h1>
    <a routerLink="/">Editorial desk</a>
  </main>`
})
export default class NotFoundPage {
  constructor() {
    const response = inject(RESPONSE, { optional: true });
    if (response) response.statusCode = 404;
  }
}
