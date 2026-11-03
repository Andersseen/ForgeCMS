import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { injectT } from '@etyma/angular';
import { RouterLink } from '@angular/router';
import {
  VoltNativeButton,
  VoltTabs,
  VoltTabsContent,
  VoltTabsList,
  VoltTabsTrigger
} from '@voltui/components';
import { MoveAnimateDirective } from 'angular-movement';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import {
  adminRows,
  clientRole,
  developerRole,
  swapSnippets,
  swapStates,
  type SwapStateId
} from '../showcase-data';
import { i18n } from '../i18n/i18n';
import { SiteLocaleService } from '../i18n/site-locale.service';

/**
 * Spec 097: developer ↔ client. Three user-chosen states pair what the developer writes with what the
 * client sees. In "Publish" the client acts first, so the columns swap sides. Nothing auto-rotates;
 * each panel is complete and readable without its entrance animation.
 */
@Component({
  selector: 'forge-cms-client-flow-section',
  standalone: true,
  imports: [
    RouterLink,
    VoltNativeButton,
    VoltTabs,
    VoltTabsContent,
    VoltTabsList,
    VoltTabsTrigger,
    MoveAnimateDirective,
    LmnArrowRightIcon
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="client-site" class="forge-swap-section" aria-labelledby="client-flow-title">
      <div class="mx-auto w-full max-w-7xl px-5 py-20 md:px-8 md:py-28">
        <div class="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p class="forge-section-mark">{{ t('flow.mark') }}</p>
            <h2 id="client-flow-title" class="forge-section-title mt-5">
              {{ t('flow.title') }}
            </h2>
          </div>
          <a voltButton variant="outline" class="w-fit" [routerLink]="site.path('/demo')">
            {{ t('flow.cta') }}
            <lmn-arrow-right [size]="16" />
          </a>
        </div>

        <volt-tabs class="forge-swap" [value]="selected()" (valueChange)="select($event)">
          <volt-tabs-list [attr.aria-label]="t('flow.views')" class="forge-swap-tabs">
            @for (state of states; track state.id) {
              <volt-tabs-trigger [value]="state.id">{{ t(state.tab) }}</volt-tabs-trigger>
            }
          </volt-tabs-list>

          @for (state of states; track state.id) {
            <volt-tabs-content [value]="state.id">
              @if (selected() === state.id) {
                <div class="forge-swap-stage" [class.is-client-first]="state.lead === 'client'">
                  <div
                    class="forge-swap-col forge-swap-dev"
                    [move]="state.lead === 'client' ? fromRight : fromLeft"
                    moveDuration="380ms"
                  >
                    <p class="forge-swap-role">{{ t(state.developer) }}</p>
                    <pre
                      class="forge-story-code"
                      tabindex="0"
                    ><code>{{ snippets[state.id] }}</code></pre>
                  </div>

                  <div class="forge-swap-arrow" aria-hidden="true">
                    <span>{{ state.lead === 'client' ? '←' : '→' }}</span>
                  </div>

                  <div
                    class="forge-swap-col forge-swap-client"
                    [move]="state.lead === 'client' ? fromLeft : fromRight"
                    moveDuration="380ms"
                  >
                    <p class="forge-swap-role">{{ t(state.client) }}</p>
                    @switch (state.id) {
                      @case ('model') {
                        <div
                          class="forge-swap-form"
                          role="group"
                          [attr.aria-label]="t('flow.form.label')"
                        >
                          <div class="forge-swap-form-head">
                            <span>{{ t('flow.form.service') }}</span
                            ><span class="forge-locale-chip">ES</span>
                          </div>
                          <div class="forge-swap-field">
                            <span>{{ t('flow.form.title') }}</span>
                            <span class="forge-swap-input">Tratamientos faciales</span>
                          </div>
                          <div class="forge-swap-field">
                            <span>{{ t('flow.form.summary') }}</span>
                            <span class="forge-swap-input"
                              >Cuida tu piel con resultados naturales.</span
                            >
                          </div>
                          <div class="forge-swap-field">
                            <span>{{ t('flow.form.image') }}</span>
                            <span class="forge-swap-input is-file">facial.jpg</span>
                          </div>
                          <div class="forge-swap-form-foot">
                            <span>{{ t('flow.form.draftSaved') }}</span
                            ><span class="forge-swap-button">{{ t('flow.form.publish') }}</span>
                          </div>
                        </div>
                      }
                      @case ('build') {
                        <div
                          class="forge-swap-adminnav"
                          role="group"
                          [attr.aria-label]="t('flow.adminLabel')"
                        >
                          <p><img src="/logo.svg" alt="" width="16" height="16" /> Forge Admin</p>
                          <ul>
                            <li>{{ t('flow.adminNav.content') }}</li>
                            <li>{{ t('flow.adminNav.media') }}</li>
                            <li>
                              {{ t('flow.adminNav.analytics') }}
                              <span class="forge-experimental-badge">{{
                                t('common.experimental')
                              }}</span>
                            </li>
                            <li>{{ t('flow.adminNav.users') }}</li>
                          </ul>
                        </div>
                      }
                      @case ('publish') {
                        <div
                          class="forge-swap-publish"
                          role="group"
                          [attr.aria-label]="t('flow.publishLabel')"
                        >
                          @for (row of rows; track row.title) {
                            <div>
                              <span>{{ t(row.title) }}</span>
                              <span
                                class="forge-status"
                                [class.is-draft]="row.status === 'draft'"
                                >{{
                                  t(row.status === 'draft' ? 'sample.draft' : 'sample.published')
                                }}</span
                              >
                            </div>
                          }
                          <p>
                            {{ t('sample.consultation') }} →
                            <strong>{{ t('flow.form.publish') }}</strong>
                          </p>
                        </div>
                      }
                    }
                  </div>
                </div>
                <p class="forge-swap-caption">{{ t(state.caption) }}</p>
              }
            </volt-tabs-content>
          }
        </volt-tabs>

        <div class="forge-swap-roles">
          <div>
            <h3>{{ t('flow.developer') }}</h3>
            <ul>
              @for (item of developer; track item) {
                <li>{{ t(item) }}</li>
              }
            </ul>
          </div>
          <div>
            <h3>{{ t('flow.client') }}</h3>
            <ul>
              @for (item of client; track item.id) {
                <li>
                  {{ t(item.label) }}
                  @if (item.id === 'analytics') {
                    <span class="forge-experimental-badge ml-1">{{
                      t('common.experimental')
                    }}</span>
                  }
                </li>
              }
            </ul>
          </div>
          <p class="forge-swap-note">
            {{ t('flow.note') }}
          </p>
        </div>
      </div>
    </section>
  `
})
export class ClientFlowSectionComponent {
  protected readonly states = swapStates;
  protected readonly snippets = swapSnippets;
  protected readonly rows = adminRows;
  protected readonly developer = developerRole;
  protected readonly client = clientRole;
  protected readonly selected = signal<SwapStateId>('model');
  protected readonly fromLeft = { opacity: [0, 1], x: [-24, 0] };
  protected readonly fromRight = { opacity: [0, 1], x: [24, 0] };
  protected readonly t = injectT(i18n);
  protected readonly site = inject(SiteLocaleService);

  protected select(value: string | undefined): void {
    const state = swapStates.find((s) => s.id === value);
    if (state) this.selected.set(state.id);
  }
}
