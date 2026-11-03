import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { injectT } from '@etyma/angular';
import { RouterLink } from '@angular/router';
import { MoveHoverDirective, MoveInViewDirective, MoveStaggerDirective } from 'angular-movement';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { LmnCheckIcon } from 'lumen-icons/check';
import { capabilityGroups } from '../landing-data';
import { bentoCards } from '../showcase-data';
import { i18n } from '../i18n/i18n';
import { SiteLocaleService } from '../i18n/site-locale.service';

/**
 * Spec 097: four product arguments with deliberately unequal weight, then the complete 1.0 surface as
 * quiet text (this replaces the old Architecture section; its Local API panel now lives in the story).
 * Cards lift on hover (mouse/pen only — Movement's `lift`), and get the same emphasis on
 * `:focus-within` in CSS, so keyboard and touch users lose nothing.
 */
@Component({
  selector: 'forge-cms-bento-section',
  standalone: true,
  imports: [
    RouterLink,
    MoveHoverDirective,
    MoveInViewDirective,
    MoveStaggerDirective,
    LmnArrowRightIcon,
    LmnCheckIcon
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="capabilities" class="forge-bento-section" aria-labelledby="bento-title">
      <div class="mx-auto w-full max-w-7xl px-5 py-20 md:px-8 md:py-28">
        <div class="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <p class="forge-section-mark">{{ t('bento.mark') }}</p>
            <h2 id="bento-title" class="forge-section-title mt-5">
              {{ t('bento.title') }}
            </h2>
          </div>
          <p class="max-w-[44ch] leading-7 text-muted-foreground">
            {{ t('bento.lede') }}
          </p>
        </div>

        <div class="forge-bento" moveStagger="90ms">
          <article
            class="forge-bento-card forge-bento-angular"
            [moveInView]="reveal"
            moveWhileHover="lift"
          >
            <h3>{{ t(cards.angular.title) }}</h3>
            <p>{{ t(cards.angular.body) }}</p>
            <div class="forge-bento-typeflow" [attr.aria-label]="t('bento.angular.typeFlow')">
              <code>services.ts</code><span aria-hidden="true">→</span><code>Schema</code
              ><span aria-hidden="true">→</span><code>collectionResource</code
              ><span aria-hidden="true">→</span><code>template</code>
            </div>
            <ul class="forge-bento-points">
              @for (point of cards.angular.points; track point) {
                <li><lmn-check [size]="14" /> {{ t(point) }}</li>
              }
            </ul>
            <a [routerLink]="site.docsPath('angular-quickstart')" class="forge-bento-link"
              >{{ t('bento.angular.link') }} <lmn-arrow-right [size]="14"
            /></a>
          </article>

          <article
            class="forge-bento-card forge-bento-client"
            [moveInView]="reveal"
            moveWhileHover="lift"
          >
            <h3>{{ t(cards.client.title) }}</h3>
            <p>{{ t(cards.client.body) }}</p>
            <ul class="forge-bento-stack">
              @for (point of cards.client.points; track point.id) {
                <li>
                  <span>{{ t(point.label) }}</span>
                  @if (point.id === 'analytics') {
                    <span class="forge-experimental-badge">{{ t('common.experimental') }}</span>
                  }
                </li>
              }
            </ul>
            <a [routerLink]="site.path('/demo')" class="forge-bento-link"
              >{{ t('bento.client.link') }} <lmn-arrow-right [size]="14"
            /></a>
          </article>

          <article
            class="forge-bento-card forge-bento-deploy"
            [moveInView]="reveal"
            moveWhileHover="lift"
          >
            <h3>{{ t(cards.deploy.title) }}</h3>
            <p>{{ t(cards.deploy.body) }}</p>
            <ul class="forge-bento-profiles">
              @for (point of cards.deploy.points; track point) {
                <li>{{ t(point) }}</li>
              }
            </ul>
            <a [routerLink]="site.docsPath('deployment')" class="forge-bento-link"
              >{{ t('bento.deploy.link') }} <lmn-arrow-right [size]="14"
            /></a>
          </article>

          <article
            class="forge-bento-card forge-bento-agent"
            [moveInView]="reveal"
            moveWhileHover="lift"
          >
            <h3>
              {{ t(cards.agent.title) }}
              <span class="forge-experimental-badge">{{ t('common.experimental') }}</span>
            </h3>
            <p>{{ t(cards.agent.body) }}</p>
            <ul class="forge-bento-points">
              @for (point of cards.agent.points; track point) {
                <li><lmn-check [size]="14" /> {{ t(point) }}</li>
              }
            </ul>
            <a href="#agent-kit" class="forge-bento-link"
              >{{ t('bento.agent.link') }} <lmn-arrow-right [size]="14"
            /></a>
          </article>
        </div>

        <div id="architecture" class="forge-surface-list" aria-labelledby="surface-title">
          <h3 id="surface-title">{{ t('bento.surface') }}</h3>
          <div class="forge-surface-grid">
            @for (group of groups; track group.id) {
              <div [attr.data-capability-group]="group.id">
                <h4>{{ t(group.title) }}</h4>
                <ul>
                  @for (item of group.items; track item) {
                    <li>{{ t(item) }}</li>
                  }
                </ul>
              </div>
            }
          </div>
        </div>
      </div>
    </section>
  `
})
export class BentoSectionComponent {
  protected readonly t = injectT(i18n);
  protected readonly site = inject(SiteLocaleService);
  protected readonly cards = bentoCards;
  protected readonly groups = capabilityGroups;
  protected readonly reveal = { opacity: [0, 1], y: [24, 0], scale: [0.98, 1] };
}
