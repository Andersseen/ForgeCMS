import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  VoltMeter,
  VoltMeterIndicator,
  VoltMeterTrack,
  VoltNativeButton,
  VoltToggleGroup,
  VoltToggleGroupItem
} from '@voltui/components';
import { MoveAnimateDirective, MoveStaggerDirective } from 'angular-movement';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { analyticsFacts } from '../landing-data';
import { SiteLocaleService } from '../i18n/site-locale.service';
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
    VoltMeter,
    VoltMeterTrack,
    VoltMeterIndicator,
    VoltToggleGroup,
    VoltToggleGroupItem,
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
              {{ t('analytics.mark') }}
              <span class="forge-experimental-badge ml-1">{{ t('common.experimental') }}</span>
            </p>
            <h2 id="analytics-title" class="forge-section-title mt-5">
              {{ t('analytics.title') }}
            </h2>
            <p class="mt-5 max-w-[46ch] leading-7 text-muted-foreground">
              {{ t('analytics.lede') }}
            </p>
            <ul class="forge-privacy-chips" [attr.aria-label]="t('analytics.guarantees')">
              @for (item of facts.privacy; track item) {
                <li>{{ t(item) }}</li>
              }
            </ul>
            <a voltButton class="mt-8" [routerLink]="site.docsPath('analytics')">
              {{ t('analytics.docs') }}
              <lmn-arrow-right [size]="16" />
            </a>
          </div>

          <div class="forge-dash" role="group" aria-labelledby="dash-title">
            <div class="forge-dash-head">
              <div>
                <p id="dash-title" class="font-semibold">{{ t('analytics.mark') }}</p>
                <p class="forge-dash-label">{{ t('analytics.preview') }}</p>
              </div>
              <volt-toggle-group
                class="forge-dash-ranges"
                type="single"
                [attr.aria-label]="t('analytics.range')"
                [value]="[range()]"
                (valueChange)="selectRange($event)"
              >
                @for (option of ranges; track option) {
                  <volt-toggle-group-item [value]="option" size="sm">{{
                    option
                  }}</volt-toggle-group-item>
                }
              </volt-toggle-group>
            </div>

            <div class="forge-dash-grid">
              <div class="forge-dash-card forge-dash-metric">
                <p class="forge-dash-card-title">{{ t('analytics.pageviews') }}</p>
                <p class="forge-dash-value">{{ number(data().pageviews) }}</p>
                <p class="forge-dash-change" [class.is-down]="data().change < 0">
                  {{ change() }} <span>{{ t('analytics.vsPrevious', { range: range() }) }}</span>
                </p>
              </div>

              <div class="forge-dash-card forge-dash-timeline">
                <p class="forge-dash-card-title">{{ t('analytics.timeline') }}</p>
                @for (snapshot of [data()]; track snapshot.range) {
                  <div class="forge-dash-bars" moveStagger="35ms" aria-hidden="true">
                    @for (bar of snapshot.timeline; track $index) {
                      <span [style.height.%]="bar * 100" [move]="grow" moveDuration="420ms"></span>
                    }
                  </div>
                }
              </div>

              <div class="forge-dash-card">
                <p class="forge-dash-card-title">{{ t('analytics.topPages') }}</p>
                <ul class="forge-dash-list">
                  @for (page of data().topPages; track page.path) {
                    <li>
                      <span>{{ page.path }}</span
                      ><span>{{ percent(page.share) }}</span>
                      <volt-meter
                        class="forge-dash-meter"
                        [attr.aria-label]="t('analytics.share', { item: page.path })"
                        [value]="page.share * 100"
                        [valueLabel]="shareLabel"
                        ><volt-meter-track><volt-meter-indicator /></volt-meter-track
                      ></volt-meter>
                    </li>
                  }
                </ul>
              </div>

              <div class="forge-dash-card">
                <p class="forge-dash-card-title">{{ t('analytics.referrers') }}</p>
                <ul class="forge-dash-list">
                  @for (ref of data().referrers; track ref.host) {
                    <li>
                      <span>{{ ref.host }}</span
                      ><span>{{ percent(ref.share) }}</span>
                      <volt-meter
                        class="forge-dash-meter"
                        [attr.aria-label]="t('analytics.share', { item: ref.host })"
                        [value]="ref.share * 100"
                        [valueLabel]="shareLabel"
                        ><volt-meter-track><volt-meter-indicator /></volt-meter-track
                      ></volt-meter>
                    </li>
                  }
                </ul>
              </div>

              <div class="forge-dash-card">
                <p class="forge-dash-card-title">{{ t('analytics.countries') }}</p>
                <ul class="forge-dash-list">
                  @for (country of data().countries; track country.code) {
                    <li>
                      <span>{{ country.code }}</span
                      ><span>{{ percent(country.share) }}</span>
                      <volt-meter
                        class="forge-dash-meter"
                        [attr.aria-label]="t('analytics.share', { item: country.code })"
                        [value]="country.share * 100"
                        [valueLabel]="shareLabel"
                        ><volt-meter-track><volt-meter-indicator /></volt-meter-track
                      ></volt-meter>
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
  protected readonly site = inject(SiteLocaleService);
  protected readonly t = this.site.i18n.t;
  protected readonly facts = analyticsFacts;
  protected readonly ranges = analyticsRanges;
  protected readonly range = signal<AnalyticsRange>('7d');
  protected readonly data = computed(() => analyticsPreview[this.range()]);
  protected readonly change = computed(() => formatChange(this.data().change, this.site.locale()));
  private readonly numbers = computed(() => new Intl.NumberFormat(this.site.locale()));
  private readonly percents = computed(
    () => new Intl.NumberFormat(this.site.locale(), { style: 'percent' })
  );
  protected readonly number = (value: number): string => this.numbers().format(value);
  protected readonly percent = (value: number): string => this.percents().format(value);
  protected readonly shareLabel = (value: number): string => this.percent(Math.round(value) / 100);
  protected selectRange(values: readonly string[]): void {
    const next = this.ranges.find((option) => values.includes(option));
    if (next) this.range.set(next);
  }
  protected readonly grow = { opacity: [0, 1], transform: ['scaleY(0.15)', 'scaleY(1)'] };
}
