import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import {
  shouldShowAnalyticsChoices,
  SiteAnalyticsConsentService
} from '../site-analytics-consent.service';
import { SiteLocaleService } from '../i18n/site-locale.service';
import { RichMessageComponent } from './rich-message.component';

@Component({
  selector: 'forge-analytics-consent',
  standalone: true,
  imports: [RichMessageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (showChoices()) {
      <aside
        class="forge-public forge-analytics-consent"
        aria-labelledby="analytics-consent-title"
        aria-describedby="analytics-consent-description"
      >
        <div class="forge-analytics-consent-inner">
          <img src="/logo.svg" alt="" width="36" height="36" />
          <div class="forge-analytics-consent-copy">
            <h2 id="analytics-consent-title">{{ t('consent.title') }}</h2>
            <p id="analytics-consent-description">
              <forge-cms-rich-message [parts]="i18n.parts('consent.body')" [link]="privacyPath()" />
            </p>
          </div>
          <div class="forge-analytics-consent-actions">
            <button type="button" (click)="analytics.decline()">{{ t('consent.decline') }}</button>
            <button type="button" class="is-primary" (click)="analytics.accept()">
              {{ t('consent.allow') }}
            </button>
          </div>
        </div>
      </aside>
    }
  `
})
export class AnalyticsConsentComponent {
  protected readonly analytics = inject(SiteAnalyticsConsentService);
  private readonly site = inject(SiteLocaleService);
  protected readonly i18n = this.site.i18n;
  protected readonly t = this.i18n.t;
  protected readonly privacyPath = computed(() => this.site.path('/privacy'));
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly currentUrl = signal(this.router.url);
  private readonly host = this.document.location.hostname;
  protected readonly showChoices = computed(() => {
    const path = this.currentUrl().split(/[?#]/, 1)[0] ?? '/';
    return shouldShowAnalyticsChoices(this.analytics.consent(), this.host, path);
  });

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(inject(DestroyRef))
      )
      .subscribe((event) => this.currentUrl.set(event.urlAfterRedirects));
  }
}
