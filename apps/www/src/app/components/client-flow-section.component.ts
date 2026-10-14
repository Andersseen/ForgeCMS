import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VoltNativeButton } from '@voltui/components';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { clientFlow } from '../landing-data';

@Component({
  selector: 'forge-cms-client-flow-section',
  standalone: true,
  imports: [RouterLink, VoltNativeButton, LmnArrowRightIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      id="client-site"
      class="border-y border-border bg-background"
      aria-labelledby="client-flow-title"
    >
      <div class="mx-auto w-full max-w-7xl px-5 py-18 md:px-8 md:py-22">
        <div class="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <div>
            <p class="forge-section-mark">Build a client site</p>
            <h2 id="client-flow-title" class="forge-section-title mt-5">
              You build the site. They run the content.
            </h2>
            <p class="mt-5 max-w-[48ch] leading-7 text-muted-foreground">
              You own the Angular components, layout and design. Your client gets the Forge admin
              for content, languages and uploads. They never build arbitrary UI, and you never
              hand-write an admin.
            </p>
            <a voltButton variant="outline" class="mt-7" routerLink="/demo">
              See it on a real clinic site
              <lmn-arrow-right [size]="16" />
            </a>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <div class="forge-flow-card">
              <p class="forge-flow-role">Developer</p>
              <ol class="forge-flow-steps">
                @for (step of flow.developer; track step) {
                  <li>{{ step }}</li>
                }
              </ol>
            </div>
            <div class="forge-flow-card">
              <p class="forge-flow-role">Client · Forge admin</p>
              <ul class="forge-flow-steps">
                @for (step of flow.client; track step) {
                  <li>
                    {{ step }}
                    @if (step === 'Analytics') {
                      <span class="forge-experimental-badge ml-2">Experimental</span>
                    }
                  </li>
                }
              </ul>
            </div>
            <div class="forge-flow-card sm:col-span-2 forge-flow-card-secondary">
              <p class="forge-flow-role">Developer + coding agent · optional tooling</p>
              <p class="mt-3 text-sm leading-6 text-muted-foreground">
                {{ flow.agent.join(' and ') }} help an agent build against the supported Forge API.
                ForgeCMS is not an AI CMS: this is developer tooling.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  `
})
export class ClientFlowSectionComponent {
  protected readonly flow = clientFlow;
}
