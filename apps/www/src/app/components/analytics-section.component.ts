import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { DecimalPipe, PercentPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { VoltNativeButton } from '@voltui/components';
import { MoveAnimateDirective, MoveStaggerDirective } from 'angular-movement';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { analyticsFacts } from '../landing-data';
import {
  analyticsPreview,
  analyticsRanges,
  formatChange,
  type AnalyticsRange
} from '../showcase-data';

/**
 * Spec 097: the experimental Analytics vertical as a compact dashboard preview. Every number is
 * illustrative, deterministic and labelled so; only the metrics the vertical really has are drawn
 * (pageviews, change vs previous period, timeline, top pages, referrers, countries). Changing the range
 * re-creates the bars, so Movement's entrance plays as feedback for the switch.
 */
@Component({
  selector: 'forge-cms-analytics-section',
  standalone: true,
  imports: [
    DecimalPipe,
    PercentPipe,
    RouterLink,
    VoltNativeButton,
    MoveAnimateDirective,
    MoveStaggerDirective,
    LmnArrowRightIcon
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="analytics" class="forge-analytics-section" aria-labelledby="analytics-title">
      <div class="mx-auto w-full max-w-7xl px-5 py-20 md:px-8 md:py-28">
        <div class="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <div>
            <p class="forge-section-mark">
              Analytics <span class="forge-experimental-badge ml-1">Experimental</span>
            </p>
            <h2 id="analytics-title" class="forge-section-title mt-5">
              Is anyone visiting? The client can see.
            </h2>
            <p class="mt-5 max-w-[46ch] leading-7 text-muted-foreground">
              Optional pageview analytics inside the same admin, built on Cloudflare Analytics
              Engine. Private by construction:
            </p>
            <ul class="forge-privacy-chips" aria-label="Privacy guarantees">
              @for (item of facts.privacy; track item) {
                <li>{{ item }}</li>
              }
            </ul>
            <a voltButton class="mt-8" routerLink="/docs/analytics">
              Analytics docs
              <lmn-arrow-right [size]="16" />
            </a>
          </div>

          <div class="forge-dash" role="group" aria-labelledby="dash-title">
            <div class="forge-dash-head">
              <div>
                <p id="dash-title" class="font-semibold">Analytics</p>
                <p class="forge-dash-label">Illustrative preview · not live data</p>
              </div>
              <div class="forge-dash-ranges" role="group" aria-label="Date range">
                @for (option of ranges; track option) {
                  <button
                    type="button"
                    [attr.aria-pressed]="range() === option"
                    (click)="range.set(option)"
                  >
                    {{ option }}
                  </button>
                }
              </div>
            </div>

            <div class="forge-dash-grid">
              <div class="forge-dash-card forge-dash-metric">
                <p class="forge-dash-card-title">Pageviews</p>
                <p class="forge-dash-value">{{ data().pageviews | number }}</p>
                <p class="forge-dash-change" [class.is-down]="data().change < 0">
                  {{ change() }} <span>vs previous {{ range() }}</span>
                </p>
              </div>

              <div class="forge-dash-card forge-dash-timeline">
                <p class="forge-dash-card-title">Timeline</p>
                @for (snapshot of [data()]; track snapshot.range) {
                  <div class="forge-dash-bars" moveStagger="35ms" aria-hidden="true">
                    @for (bar of snapshot.timeline; track $index) {
                      <span [style.height.%]="bar * 100" [move]="grow" moveDuration="420ms"></span>
                    }
                  </div>
                }
              </div>

              <div class="forge-dash-card">
                <p class="forge-dash-card-title">Top pages</p>
                <ul class="forge-dash-list">
                  @for (page of data().topPages; track page.path) {
                    <li>
                      <span>{{ page.path }}</span
                      ><span>{{ page.share | percent }}</span>
                      <i [style.width.%]="page.share * 100" aria-hidden="true"></i>
                    </li>
                  }
                </ul>
              </div>

              <div class="forge-dash-card">
                <p class="forge-dash-card-title">Referrers</p>
                <ul class="forge-dash-list">
                  @for (ref of data().referrers; track ref.host) {
                    <li>
                      <span>{{ ref.host }}</span
                      ><span>{{ ref.share | percent }}</span>
                      <i [style.width.%]="ref.share * 100" aria-hidden="true"></i>
                    </li>
                  }
                </ul>
              </div>

              <div class="forge-dash-card">
                <p class="forge-dash-card-title">Countries</p>
                <ul class="forge-dash-list">
                  @for (country of data().countries; track country.code) {
                    <li>
                      <span>{{ country.code }}</span
                      ><span>{{ country.share | percent }}</span>
                      <i [style.width.%]="country.share * 100" aria-hidden="true"></i>
                    </li>
                  }
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `
})
export class AnalyticsSectionComponent {
  protected readonly facts = analyticsFacts;
  protected readonly ranges = analyticsRanges;
  protected readonly range = signal<AnalyticsRange>('7d');
  protected readonly data = computed(() => analyticsPreview[this.range()]);
  protected readonly change = computed(() => formatChange(this.data().change));
  protected readonly grow = { opacity: [0, 1], transform: ['scaleY(0.15)', 'scaleY(1)'] };
}
