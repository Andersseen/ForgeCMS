import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FooterComponent } from '../components/footer.component';
import { HeaderComponent } from '../components/header.component';
import { SiteAnalyticsConsentService } from '../site-analytics-consent.service';
import { RichMessageComponent } from '../components/rich-message.component';
import { SiteLocaleService } from '../i18n/site-locale.service';

@Component({
  selector: 'forge-cms-privacy-page',
  standalone: true,
  imports: [HeaderComponent, FooterComponent, RichMessageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="forge-public min-h-screen">
      <forge-cms-header />
      <main class="mx-auto w-full max-w-4xl px-5 py-16 md:px-8 md:py-24">
        <p class="forge-section-mark">{{ t('privacy.mark') }}</p>
        <h1 class="mt-4 text-4xl font-semibold tracking-[-0.04em] md:text-5xl">
          {{ t('privacy.title') }}
        </h1>
        <div class="mt-8 space-y-8 leading-7 text-muted-foreground">
          <section>
            <h2 class="text-xl font-semibold text-foreground">{{ t('privacy.useTitle') }}</h2>
            <p class="mt-2">
              <forge-cms-rich-message
                [parts]="i18n.parts('privacy.useBody', { host: 'umami.andersseen.dev' })"
              />
            </p>
          </section>
          <section>
            <h2 class="text-xl font-semibold text-foreground">{{ t('privacy.infoTitle') }}</h2>
            <p class="mt-2">{{ t('privacy.infoBody') }}</p>
            <p class="mt-2">{{ t('privacy.storageBody') }}</p>
          </section>
          <section>
            <h2 class="text-xl font-semibold text-foreground">{{ t('privacy.choiceTitle') }}</h2>
            <p class="mt-2">{{ t('privacy.choiceBody') }}</p>
            <div class="mt-4 flex flex-wrap gap-3">
              @if (analytics.consent() === 'accepted') {
                <button class="privacy-choice" type="button" (click)="analytics.revoke()">
                  {{ t('privacy.disable') }}
                </button>
              } @else {
                <button
                  class="privacy-choice is-primary"
                  type="button"
                  (click)="analytics.accept()"
                >
                  {{ t('privacy.allow') }}
                </button>
                <button class="privacy-choice" type="button" (click)="analytics.decline()">
                  {{ t('privacy.keepDisabled') }}
                </button>
              }
            </div>
          </section>
          <section>
            <h2 class="text-xl font-semibold text-foreground">{{ t('privacy.rightsTitle') }}</h2>
            <p class="mt-2">{{ t('privacy.rightsBody') }}</p>
          </section>
          <p class="text-sm">
            <forge-cms-rich-message
              [parts]="i18n.parts('privacy.references')"
              [hrefs]="references"
            />
          </p>
        </div>
      </main>
      <forge-cms-footer />
    </div>
  `
})
export class PrivacyPage {
  protected readonly analytics = inject(SiteAnalyticsConsentService);
  protected readonly i18n = inject(SiteLocaleService).i18n;
  protected readonly t = this.i18n.t;
  protected readonly references = {
    tracker: 'https://docs.umami.is/docs/tracker-configuration',
    metrics: 'https://docs.umami.is/docs/metric-definitions',
    aepd: 'https://www.aepd.es/guias/guia-cookies-analiticas-externas.pdf'
  };
}
