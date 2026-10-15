import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VoltNativeButton } from '@voltui/components';
import { MoveInViewDirective, MoveStaggerDirective } from 'angular-movement';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { agentInstallCommand } from '../forge-release';
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
    LmnArrowRightIcon
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="agent-kit" class="forge-agent-section" aria-labelledby="agent-kit-title">
      <div class="mx-auto w-full max-w-7xl px-5 py-20 md:px-8 md:py-28">
        <div class="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          <div>
            <p class="forge-section-mark">
              Agent Kit <span class="forge-experimental-badge ml-1">Experimental</span>
            </p>
            <h2 id="agent-kit-title" class="forge-section-title mt-5">
              Your coding agent shouldn’t have to guess ForgeCMS.
            </h2>
            <p class="mt-5 max-w-[48ch] leading-7 text-muted-foreground">
              One command connects a local, read-only MCP server and the official skills for the
              exact version you installed. Development tooling around ForgeCMS; compatibility may
              evolve.
            </p>

            <dl class="forge-agent-roles">
              @for (item of roles; track item.name) {
                <div>
                  <dt>{{ item.name }}</dt>
                  <dd>{{ item.role }}</dd>
                </div>
              }
            </dl>

            <ul class="forge-agent-facts" aria-label="Agent Kit guarantees">
              <li>Local</li>
              <li>read-only</li>
              <li>No telemetry</li>
            </ul>

            <div class="mt-8 flex flex-wrap items-center gap-4">
              <a voltButton routerLink="/docs/agent-kit">
                Read Agent Kit docs
                <lmn-arrow-right [size]="16" />
              </a>
              @if (install) {
                <code class="forge-install-inline" aria-label="Agent Kit install command">{{
                  install
                }}</code>
              }
            </div>
            <p class="mt-4 text-sm text-muted-foreground" data-agent-availability>
              @if (install) {
                {{ availability }}
              } @else {
                Coming with the 1.0 release candidate
              }
            </p>
          </div>

          <figure class="forge-terminal" aria-labelledby="agent-terminal-caption">
            <div class="forge-terminal-bar" aria-hidden="true">
              <span></span><span></span><span></span>
              <p>your-angular-project</p>
            </div>
            <ol class="forge-terminal-body" moveStagger="110ms">
              @for (row of rows; track row.text) {
                <li [class]="'forge-terminal-row is-' + row.kind" [moveInView]="reveal">
                  @switch (row.kind) {
                    @case ('command') {
                      <span class="forge-terminal-sigil" aria-hidden="true">$</span>
                      <code>{{ row.text }}</code>
                    }
                    @case ('prompt') {
                      <span class="forge-terminal-label">You</span>
                      <span class="forge-terminal-prompt">“{{ row.text }}”</span>
                    }
                    @case ('result') {
                      <span class="forge-terminal-sigil" aria-hidden="true">→</span>
                      <span
                        ><strong>{{ row.text }}</strong>
                        <span class="forge-terminal-detail">{{ row.detail }}</span></span
                      >
                    }
                    @default {
                      <span class="forge-terminal-check" aria-hidden="true">✓</span>
                      <span class="sr-only">Done: </span>
                      <span
                        ><span [class.font-mono]="row.kind === 'tool'">{{ row.text }}</span>
                        @if (row.detail) {
                          <span class="forge-terminal-detail">{{ row.detail }}</span>
                        }
                      </span>
                    }
                  }
                </li>
              }
            </ol>
            <figcaption id="agent-terminal-caption" class="forge-terminal-caption">
              Illustrative · {{ install ? 'Candidate workflow.' : availability }} The MCP only
              reads; your agent edits the project with its own tools.
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
  protected readonly availability = agentAvailabilityNote();
  protected readonly reveal = { opacity: [0, 1], x: [-10, 0] };
}
