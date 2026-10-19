import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FooterComponent } from '../components/footer.component';
import { HeaderComponent } from '../components/header.component';
import { SiteAnalyticsConsentService } from '../site-analytics-consent.service';

@Component({
  selector: 'forge-cms-privacy-page',
  standalone: true,
  imports: [HeaderComponent, FooterComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="forge-public min-h-screen">
      <forge-cms-header />
      <main class="mx-auto w-full max-w-4xl px-5 py-16 md:px-8 md:py-24">
        <p class="forge-section-mark">Privacy</p>
        <h1 class="mt-4 text-4xl font-semibold tracking-[-0.04em] md:text-5xl">
          Website audience measurement
        </h1>
        <div class="mt-8 space-y-8 leading-7 text-muted-foreground">
          <section>
            <h2 class="text-xl font-semibold text-foreground">What we use and why</h2>
            <p class="mt-2">
              The ForgeCMS website offers optional, basic pageview statistics through a self-hosted
              Umami service at <code>umami.andersseen.dev</code>. The tracker is not loaded unless
              you choose “Allow analytics”. We use the statistics to understand visits to public
              website pages.
            </p>
          </section>
          <section>
            <h2 class="text-xl font-semibold text-foreground">Information involved</h2>
            <p class="mt-2">
              When enabled, this site sends the public website identifier and the current public
              page path. Query strings, fragments, page titles, referrers and click events are
              excluded. The request also necessarily exposes network headers such as your IP address
              and browser User-Agent to the service. Umami's published documentation says it uses
              the IP address for approximate location without storing it, and calculates rotating
              session hashes from values including the User-Agent. The exact deployed Umami version
              and server configuration have not yet been independently verified.
            </p>
            <p class="mt-2">
              Umami's tracker documentation says it does not use cookies. This website stores your
              analytics choice in browser local storage so it can remember it; no analytics data is
              stored in that preference.
            </p>
          </section>
          <section>
            <h2 class="text-xl font-semibold text-foreground">Choice, legal basis and retention</h2>
            <p class="mt-2">
              The tracker stays off until you explicitly opt in; consent is the basis used for this
              optional measurement. You can change your choice here. The AEPD's audience-measurement
              exemption has not been established for this service because its processing terms,
              server configuration and retention have not been confirmed. The server-side retention
              period is currently unknown, so analytics remains consent-gated.
            </p>
            <div class="mt-4 flex flex-wrap gap-3">
              @if (analytics.consent() === 'accepted') {
                <button class="privacy-choice" type="button" (click)="analytics.revoke()">
                  Disable analytics
                </button>
              } @else {
                <button
                  class="privacy-choice is-primary"
                  type="button"
                  (click)="analytics.accept()"
                >
                  Allow analytics
                </button>
                <button class="privacy-choice" type="button" (click)="analytics.decline()">
                  Keep analytics disabled
                </button>
              }
            </div>
          </section>
          <section>
            <h2 class="text-xl font-semibold text-foreground">Your rights and contact</h2>
            <p class="mt-2">
              The project has not published a controller identity or privacy contact address. Those
              owner-provided details, together with the service's data-processing and deletion
              arrangements, must be confirmed before this notice can be complete. Once identified,
              contact the controller to exercise applicable data-protection rights, including
              access, erasure, restriction and objection. You may also contact the Spanish Data
              Protection Agency (AEPD).
            </p>
          </section>
          <p class="text-sm">
            References:
            <a href="https://docs.umami.is/docs/tracker-configuration"
              >Umami tracker configuration</a
            >, <a href="https://docs.umami.is/docs/metric-definitions">Umami metric definitions</a>,
            and
            <a href="https://www.aepd.es/guias/guia-cookies-analiticas-externas.pdf">
              AEPD audience-measurement guidance </a
            >.
          </p>
        </div>
      </main>
      <forge-cms-footer />
    </div>
  `
})
export class PrivacyPage {
  protected readonly analytics = inject(SiteAnalyticsConsentService);
}
