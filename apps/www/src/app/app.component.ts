import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet, type ActivatedRouteSnapshot } from '@angular/router';
import { SiteThemeService } from './site-theme.service';
import { AnalyticsConsentComponent } from './components/analytics-consent.component';
import { filter } from 'rxjs';
import { SiteHeadService } from './site-head.service';

@Component({
  selector: 'forge-cms-root',
  standalone: true,
  imports: [RouterOutlet, AnalyticsConsentComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<router-outlet /><forge-analytics-consent />`
})
export class AppComponent {
  private readonly theme = inject(SiteThemeService);
  private readonly head = inject(SiteHeadService);
  private readonly router = inject(Router);

  constructor() {
    // Keeps the shared-link metadata (spec 075) honest per route and per locale (spec 101): the
    // localized title/description, canonical, `og:url`, `hreflang` and `<html lang>` name the current
    // page. Docs articles set their own (translated) title and description once their markdown loads.
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed()
      )
      .subscribe((event) => {
        this.theme.restore();
        this.head.update(event.urlAfterRedirects, this.deepestRoute());
      });
  }

  private deepestRoute(): ActivatedRouteSnapshot {
    let route = this.router.routerState.snapshot.root;
    while (route.firstChild) route = route.firstChild;
    return route;
  }
}
