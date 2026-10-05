import { ChangeDetectionStrategy, Component, DOCUMENT, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Meta } from '@angular/platform-browser';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { SiteThemeService } from './site-theme.service';
import { filter } from 'rxjs';

const SITE_ORIGIN = 'https://forge-cms.pages.dev';
const DEFAULT_DESCRIPTION =
  'Define content in TypeScript, call it through a Local API, and mount a reusable Angular admin with ForgeCMS.';

@Component({
  selector: 'forge-cms-root',
  standalone: true,
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<router-outlet />`
})
export class AppComponent {
  private readonly theme = inject(SiteThemeService);
  private readonly document = inject(DOCUMENT);
  private readonly meta = inject(Meta);

  constructor() {
    // Keeps the shared-link metadata (spec 075) honest per route: the canonical URL and `og:url` name
    // the current page, and pages without their own description (docs articles set one) fall back to
    // the site's instead of keeping the last article's. Titles come from the routes / docs article.
    inject(Router)
      .events.pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed()
      )
      .subscribe((event) => {
        this.theme.restore();
        const path = event.urlAfterRedirects.split(/[?#]/)[0] ?? '/';
        const url = `${SITE_ORIGIN}${path}`;
        this.document.querySelector('link[rel="canonical"]')?.setAttribute('href', url);
        this.meta.updateTag({ property: 'og:url', content: url });
        if (!path.startsWith('/docs/')) {
          this.meta.updateTag({ name: 'description', content: DEFAULT_DESCRIPTION });
        }
      });
  }
}
