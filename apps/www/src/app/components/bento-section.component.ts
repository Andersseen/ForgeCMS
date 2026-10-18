import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MoveHoverDirective, MoveInViewDirective, MoveStaggerDirective } from 'angular-movement';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { LmnCheckIcon } from 'lumen-icons/check';
import { capabilityGroups } from '../landing-data';
import { bentoCards } from '../showcase-data';

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
            <p class="forge-section-mark">Why ForgeCMS</p>
            <h2 id="bento-title" class="forge-section-title mt-5">
              A CMS that belongs in your Angular app.
            </h2>
          </div>
          <p class="max-w-[44ch] leading-7 text-muted-foreground">
            Code-first for the developer, comfortable for the client, and deployable on the edge or
            anywhere Node runs.
          </p>
        </div>

        <div class="forge-bento" moveStagger="90ms">
          <article
            class="forge-bento-card forge-bento-angular"
            [moveInView]="reveal"
            moveWhileHover="lift"
          >
            <h3>{{ cards.angular.title }}</h3>
            <p>{{ cards.angular.body }}</p>
            <div class="forge-bento-typeflow" aria-label="Types flow from schema to template">
              <code>services.ts</code><span aria-hidden="true">→</span><code>Schema</code
              ><span aria-hidden="true">→</span><code>collectionResource</code
              ><span aria-hidden="true">→</span><code>template</code>
            </div>
            <ul class="forge-bento-points">
              @for (point of cards.angular.points; track point) {
                <li><lmn-check [size]="14" /> {{ point }}</li>
              }
            </ul>
            <a routerLink="/docs/angular-quickstart" class="forge-bento-link"
              >Angular quickstart <lmn-arrow-right [size]="14"
            /></a>
          </article>

          <article
            class="forge-bento-card forge-bento-client"
            [moveInView]="reveal"
            moveWhileHover="lift"
          >
            <h3>{{ cards.client.title }}</h3>
            <p>{{ cards.client.body }}</p>
            <ul class="forge-bento-stack">
              @for (point of cards.client.points; track point) {
                <li>
                  <span>{{ point }}</span>
                  @if (point === 'Analytics') {
                    <span class="forge-experimental-badge">Experimental</span>
                  }
                </li>
              }
            </ul>
            <a routerLink="/demo" class="forge-bento-link"
              >Try the admin in the demo <lmn-arrow-right [size]="14"
            /></a>
          </article>

          <article
            class="forge-bento-card forge-bento-deploy"
            [moveInView]="reveal"
            moveWhileHover="lift"
          >
            <h3>{{ cards.deploy.title }}</h3>
            <p>{{ cards.deploy.body }}</p>
            <ul class="forge-bento-profiles">
              @for (point of cards.deploy.points; track point) {
                <li>{{ point }}</li>
              }
            </ul>
            <a routerLink="/docs/deployment" class="forge-bento-link"
              >Deployment profiles <lmn-arrow-right [size]="14"
            /></a>
          </article>

          <article
            class="forge-bento-card forge-bento-agent"
            [moveInView]="reveal"
            moveWhileHover="lift"
          >
            <h3>
              {{ cards.agent.title }} <span class="forge-experimental-badge">Experimental</span>
            </h3>
            <p>{{ cards.agent.body }}</p>
            <ul class="forge-bento-points">
              @for (point of cards.agent.points; track point) {
                <li><lmn-check [size]="14" /> {{ point }}</li>
              }
            </ul>
            <a href="#agent-kit" class="forge-bento-link"
              >See the Agent Kit <lmn-arrow-right [size]="14"
            /></a>
          </article>
        </div>

        <div id="architecture" class="forge-surface-list" aria-labelledby="surface-title">
          <h3 id="surface-title">The ForgeCMS 1.0 surface</h3>
          <div class="forge-surface-grid">
            @for (group of groups; track group.id) {
              <div [attr.data-capability-group]="group.id">
                <h4>{{ group.title }}</h4>
                <ul>
                  @for (item of group.items; track item) {
                    <li>{{ item }}</li>
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
  protected readonly cards = bentoCards;
  protected readonly groups = capabilityGroups;
  protected readonly reveal = { opacity: [0, 1], y: [24, 0], scale: [0.98, 1] };
}
