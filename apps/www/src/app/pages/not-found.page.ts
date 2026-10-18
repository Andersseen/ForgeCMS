import { ChangeDetectionStrategy, Component, RESPONSE_INIT, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { FooterComponent } from '../components/footer.component';
import { HeaderComponent } from '../components/header.component';

@Component({
  selector: 'forge-cms-not-found-page',
  standalone: true,
  imports: [RouterLink, HeaderComponent, FooterComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="forge-public min-h-screen landing-bg">
      <forge-cms-header />
      <main class="mx-auto w-full max-w-7xl px-5 py-20 md:px-8 md:py-28">
        <p class="forge-section-mark">404</p>
        <h1 class="forge-display mt-4 text-4xl md:text-6xl">Page not found</h1>
        <p class="mt-5 max-w-[60ch] text-muted-foreground">
          That page is not part of the ForgeCMS site.
        </p>
        <a class="mt-8 inline-flex underline" routerLink="/">Return to ForgeCMS</a>
      </main>
      <forge-cms-footer />
    </div>
  `
})
export class NotFoundPage {
  constructor() {
    const response = inject(RESPONSE_INIT, { optional: true });
    if (response) response.status = 404;
    inject(Meta).updateTag({ name: 'robots', content: 'noindex, nofollow' });
    inject(Title).setTitle('Page not found — ForgeCMS');
  }
}
