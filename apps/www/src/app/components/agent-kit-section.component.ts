import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { injectT } from '@etyma/angular';
import { RouterLink } from '@angular/router';
import { VoltNativeButton } from '@voltui/components';
import { MoveInViewDirective, MoveStaggerDirective } from 'angular-movement';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { CURRENT_FORGE_VERSION, agentInstallCommand } from '../forge-release';
import { i18n, textOf, type SiteText } from '../i18n/i18n';
import { SiteLocaleService } from '../i18n/site-locale.service';
import { RichMessageComponent } from './rich-message.component';
import { agentAvailabilityNote, agentRoles, agentTerminal } from '../showcase-data';

/**
 * Spec 097: the experimental Agent Kit as a terminal story — the spec 096 one-command `init`, then one
 * developer intent answered by read-only consultations. Rows reveal in order (Movement stagger) but
 * are all in the DOM from the start; under reduced motion they are simply there. The install command
 * appears only when `FORGE_CHANNELS` confirms the package is on the registry.
 */
@Component({
  selector: 'forge-cms-agent-kit-section',
  standalone: true,
  imports: [
    RouterLink,
    VoltNativeButton,
    MoveInViewDirective,
    MoveStaggerDirective,
    LmnArrowRightIcon,
    RichMessageComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="agent-kit" class="forge-agent-section" aria-labelledby="agent-kit-title">
      <div class="mx-auto w-full max-w-7xl px-5 py-20 md:px-8 md:py-28">
        <div class="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          <div>
            <p class="forge-section-mark">
              {{ t('agentKit.mark') }}
              <span class="forge-experimental-badge ml-1">{{ t('common.experimental') }}</span>
            </p>
            <h2 id="agent-kit-title" class="forge-section-title mt-5">
              {{ t('agentKit.title') }}
            </h2>
            <p class="mt-5 max-w-[48ch] leading-7 text-muted-foreground">
              {{ t('agentKit.lede') }}
            </p>

            <dl class="forge-agent-roles">
              @for (item of roles; track item.role) {
                <div>
                  <dt>{{ text(item.name) }}</dt>
                  <dd>{{ t(item.role) }}</dd>
                </div>
              }
            </dl>

            <ul class="forge-agent-facts" [attr.aria-label]="t('agentKit.guarantees')">
              <li>{{ t('agentKit.facts.0') }}</li>
              <li>{{ t('agentKit.facts.1') }}</li>
              <li>{{ t('agentKit.facts.2') }}</li>
            </ul>

            <div class="mt-8 flex flex-wrap items-center gap-4">
              <a voltButton [routerLink]="site.docsPath('agent-kit')">
                {{ t('agentKit.docs') }}
                <lmn-arrow-right [size]="16" />
              </a>
              @if (install) {
                <code
                  class="forge-install-inline"
                  [attr.aria-label]="t('agentKit.installCommand')"
                  >{{ install }}</code
                >
              }
            </div>
            <p class="mt-4 text-sm text-muted-foreground" data-agent-availability>
              @if (install) {
                <forge-cms-rich-message [parts]="availability()" />
              } @else {
                {{ t('agentKit.unpublished') }}
              }
            </p>
          </div>

          <figure class="forge-terminal" aria-labelledby="agent-terminal-caption">
            <div class="forge-terminal-bar" aria-hidden="true">
              <span></span><span></span><span></span>
              <p>your-angular-project</p>
            </div>
            <ol class="forge-terminal-body" moveStagger="110ms">
              @for (row of rows; track $index) {
                <li [class]="'forge-terminal-row is-' + row.kind" [moveInView]="reveal">
                  @switch (row.kind) {
                    @case ('command') {
                      <span class="forge-terminal-sigil" aria-hidden="true">$</span>
                      <code>{{ text(row.text) }}</code>
                    }
                    @case ('prompt') {
                      <span class="forge-terminal-label">{{ t('agentKit.you') }}</span>
                      <span class="forge-terminal-prompt">“{{ text(row.text) }}”</span>
                    }
                    @case ('result') {
                      <span class="forge-terminal-sigil" aria-hidden="true">→</span>
                      <span
                        ><strong>{{ text(row.text) }}</strong>
                        @if (row.detail; as detail) {
                          <span class="forge-terminal-detail">{{ text(detail) }}</span>
                        }
                      </span>
                    }
                    @default {
                      <span class="forge-terminal-check" aria-hidden="true">✓</span>
                      <span class="sr-only">{{ t('agentKit.done') }}&#32;</span>
                      <span
                        ><span [class.font-mono]="row.kind === 'tool'">{{ text(row.text) }}</span>
                        @if (row.detail; as detail) {
                          <span class="forge-terminal-detail">{{ text(detail) }}</span>
                        }
                      </span>
                    }
                  }
                </li>
              }
            </ol>
            <figcaption id="agent-terminal-caption" class="forge-terminal-caption">
              {{ t('agentKit.illustrative') }}
              @if (install) {
                {{ t('agentKit.candidateWorkflow') }}
              } @else {
                <forge-cms-rich-message [parts]="availability()" />
              }
              {{ t('agentKit.caption') }}
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  `
})
export class AgentKitSectionComponent {
  protected readonly rows = agentTerminal;
  protected readonly roles = agentRoles;
  protected readonly install = agentInstallCommand();
  protected readonly i18n = inject(SiteLocaleService).i18n;
  protected readonly t = injectT(i18n);
  protected readonly site = inject(SiteLocaleService);
  protected readonly text = (value: SiteText): string => textOf(this.t, value);
  /** Rendered as parts: the candidate note marks the package name as code. */
  protected readonly availability = () =>
    this.i18n.parts(agentAvailabilityNote(), { version: CURRENT_FORGE_VERSION });
  protected readonly reveal = { opacity: [0, 1], x: [-10, 0] };
}
