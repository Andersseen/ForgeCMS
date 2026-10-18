import { ChangeDetectionStrategy, Component, DOCUMENT, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Meta } from '@angular/platform-browser';
import { NavigationEnd, Router, RouterOutlet, type ActivatedRoute } from '@angular/router';
import { SiteThemeService } from './site-theme.service';
import { filter } from 'rxjs';
import { CANONICAL_ORIGIN, DEFAULT_SITE_DESCRIPTION, SOCIAL_IMAGE_PATH } from './site-config.mjs';
import { canonicalUrl } from './site-meta';

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
  private readonly router = inject(Router);

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
        const path = new URL(event.urlAfterRedirects, CANONICAL_ORIGIN).pathname;
        const url = canonicalUrl(event.urlAfterRedirects);
        this.document.querySelector('link[rel="canonical"]')?.setAttribute('href', url);
        this.meta.updateTag({ property: 'og:url', content: url });
        this.meta.updateTag({ property: 'og:title', content: this.document.title });
        this.meta.updateTag({ name: 'twitter:title', content: this.document.title });
        this.meta.updateTag({
          property: 'og:image',
          content: `${CANONICAL_ORIGIN}${SOCIAL_IMAGE_PATH}`
        });
        this.meta.updateTag({
          name: 'twitter:image',
          content: `${CANONICAL_ORIGIN}${SOCIAL_IMAGE_PATH}`
        });
        const activeRoute = this.deepestRoute();
        const routeDescription = activeRoute.snapshot.data['description'];
        if (typeof routeDescription === 'string') {
          this.meta.updateTag({ name: 'description', content: routeDescription });
        } else if (!path.startsWith('/docs/')) {
          this.meta.updateTag({ name: 'description', content: DEFAULT_SITE_DESCRIPTION });
        }
        const description =
          this.meta.getTag('name="description"')?.content ?? DEFAULT_SITE_DESCRIPTION;
        this.meta.updateTag({ property: 'og:description', content: description });
        this.meta.updateTag({ name: 'twitter:description', content: description });
        const robots = activeRoute.snapshot.data['robots'];
        if (typeof robots === 'string') this.meta.updateTag({ name: 'robots', content: robots });
        else this.meta.removeTag('name="robots"');
      });
  }

  private deepestRoute(): ActivatedRoute {
    let route = this.router.routerState.root;
    while (route.firstChild) route = route.firstChild;
    return route;
  }
}
