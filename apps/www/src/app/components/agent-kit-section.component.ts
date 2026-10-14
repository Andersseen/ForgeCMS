import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VoltNativeButton } from '@voltui/components';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { agentInstallCommand } from '../forge-release';
import { agentKit } from '../landing-data';

@Component({
  selector: 'forge-cms-agent-kit-section',
  standalone: true,
  imports: [RouterLink, VoltNativeButton, LmnArrowRightIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      id="agent-kit"
      class="mx-auto w-full max-w-7xl px-5 py-18 md:px-8 md:py-22"
      aria-labelledby="agent-kit-title"
    >
      <div class="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <div>
          <p class="forge-section-mark">
            Agent Kit <span class="forge-experimental-badge ml-1">Experimental</span>
          </p>
          <h2 id="agent-kit-title" class="forge-section-title mt-5">
            Your coding agent should not have to guess how ForgeCMS works.
          </h2>
          <p class="mt-5 max-w-[50ch] leading-7 text-muted-foreground">
            <code class="font-semibold text-foreground">&#64;forge-cms/agent</code> pairs a local
            MCP server with official skills and the documentation for the exact version you
            installed. Useful today; compatibility may evolve.
          </p>
          <ul class="mt-6 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            @for (fact of kit.facts; track fact) {
              <li class="flex gap-2.5">
                <span
                  class="mt-[0.55rem] size-1.5 shrink-0 rounded-full bg-primary"
                  aria-hidden="true"
                ></span>
                <span>{{ fact }}</span>
              </li>
            }
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
            } @else {
              <span class="text-sm text-muted-foreground" data-agent-availability>
                Coming with the 1.0 release candidate
              </span>
            }
          </div>
        </div>

        <figure
          class="forge-themed-panel m-0 rounded-[1.25rem] border border-border p-6 md:p-7"
          aria-label="Illustrative Agent Kit session"
        >
          <figcaption class="text-xs font-medium text-muted-foreground">
            Illustrative · the MCP only reads; the agent edits your project with its own tools
          </figcaption>
          <p class="mt-5 text-sm text-muted-foreground">Developer</p>
          <p class="mt-1 font-medium">“{{ kit.prompt }}”</p>
          <p class="mt-6 text-sm text-muted-foreground">Agent consults</p>
          <ul class="mt-2 space-y-2 font-mono text-[0.8rem]">
            @for (step of kit.steps; track step.call) {
              <li class="rounded-lg border border-border bg-background px-3 py-2">
                <span class="text-primary" aria-hidden="true">✓</span>
                <span class="sr-only">Done: </span>
                {{ step.call }}
                <span class="block pl-5 font-sans text-xs text-muted-foreground">{{
                  step.note
                }}</span>
              </li>
            }
          </ul>
          <p class="mt-5 text-sm leading-6">→ {{ kit.result }}</p>
        </figure>
      </div>
    </section>
  `
})
export class AgentKitSectionComponent {
  protected readonly kit = agentKit;
  protected readonly install = agentInstallCommand();
}
